# RUN M1-B — Dev Notes (dev-notes-v1)

Implementation record for the approved plan `docs/build/RUN-M1-B-plan.md` (R1 … R20).
The Phase A **measured figures** and the owner decision live in
`docs/build/RUN-M1-B-phase-a.md`; the doer's free-form build narrative lives in
`docs/build/RUN-M1-B-devnotes.md`. This document is the canonical artifact and
supersedes both where they disagree — every disagreement found is stated
explicitly below rather than absorbed.

## Detected Stack

- **Language/runtime:** Python 3.12, `uv`-managed (`pyproject.toml`, `.python-version`); frozen lockfile (`uv sync --frozen`).
- **Store:** SQLite canonical corpus; published artifacts are the API (DR-3/DR-4).
- **Tests:** `pytest` via `uv run pytest -q` (`Makefile:22`); `testpaths=["tests"]`; `jsonschema` (dev) for `stats.json` validation; autouse socket guard `tests/conftest.py::_no_network`.
- **Security gate:** bespoke stdlib `scripts/dep_guard.py` (paid-vendor denylist, G1) — not bandit/pip-audit.
- **Ingest libs:** `httpx` (only `ingest/house.py`, `ingest/senate.py`), `lxml`, `pdfplumber`/`pypdf` (`parse/house_ptr.py`), CLI `click`.
- **Publication:** `populus.publish.build` (`run_build`/`run_publish`/`run_verify`, `LocalDirBackend`), `atomic_write_bytes`.
- **Gates:** `make test`, `make security`, and the new `make accept-m1-b` (added this run, depends on `sync`).
- **Unchanged by this run:** no new dependency, no DB schema migration, no parser change (`src/populus/parse/` does not appear in `git status`).

## Requirement and Task Completion

Every R-id from the plan's Requirements section is enumerated literally.
Status vocabulary: **complete** (shipped and evidenced); **complete hermetically,
live measurement blocked** (code and tests done, the real-world measurement did not
happen for a stated external reason). Gate figures marked *(coordinator)* were run
independently by the coordinating session against this tree, not by the doer.

### R1 — Lift checkpoint-before-bytes primitives into a shared module

**Status: complete.** `src/populus/ingest/checkpoint.py` (new, 120 lines) exposes
`read_checkpoint` / `commit_checkpoint` / `sha256_hex`, plus `archive_verified`
(the R3 predicate, placed here because it is the same primitive family).
`src/populus/ingest/inst13f.py` shrinks by 83 net lines, imports the shared
functions and keeps the `_read_checkpoint` / `_commit_checkpoint` / `_sha256`
back-compat aliases. **Evidence:** `tests/test_checkpoint.py` (7 tests — round-trip,
named slots without sibling clobber, absent/unreadable sidecar, full-rehash rather
than size check, directory-in-slot); `tests/test_inst13f_seam.py` now spies
`populus.ingest.checkpoint.atomic_write_bytes` as well as inst13f's own writer, so
the crash-ordering test still observes both durable writes after the lift.

### R2 — Resumable House PTR fetch with per-document provenance sidecars

**Status: complete.** Checkpoint written atomically before bytes; cache-first
resume; §5.1 fields (`source_url`, `response_hash`, `retrieved_at`); index sidecar
gains `response_hash`; a non-200 is never checkpointed or archived.
**Evidence (tests, `tests/test_house_ingest.py`):**
`test_live_fetch_writes_the_provenance_sidecar_checkpoint_first`,
`test_the_checkpoint_is_written_before_the_bytes`,
`test_a_crash_between_the_checkpoint_and_the_bytes_refetches_exactly_once`,
`test_a_non_200_ptr_is_never_checkpointed_or_archived`,
`test_cache_mode_writes_no_sidecar`.
**Evidence (live):** `ops/m1-b/raw/house/pdfs/2015/` holds one
`<DocID>.pdf.fetch-meta.json` beside every archived PDF, and
`ops/m1-b/raw/house/2015FD.zip.meta.json` is present.

### R3 — Settled eligibility depends on verified bytes, not on a database row

**Status: complete.** The `raw_path IS NOT NULL` skip in `_ingest_year` is replaced
by `raw_path` + `response_hash` present + archive exists + recomputed SHA-256
equals the stored hash; anything else falls through and refetches exactly once.
`settled_verified` / `settled_reobtained` counters were added to `YearReport` and
the summary. **Evidence (tests):**
`test_missing_and_corrupt_archives_each_refetch_exactly_once_on_the_same_db`,
`test_fresh_database_over_a_verified_archive_makes_zero_ptr_transport`,
`test_an_archive_row_whose_response_hash_is_null_is_not_settled`,
`test_settled_counters_appear_in_the_summary`.
**Evidence (live, `ops/m1-b/house-2015-resume.log`):** the resume pass over the
real 2015 archive verified 727 documents, reobtained 0, and cost **2 requests /
0.9 s** against 301.8 s for the first pass.

### R4 — Per-era gate evaluator with two independent censuses

**Status: complete.** `src/populus/parse_gate.py` (new, 404 lines);
`GATE_THRESHOLD = 0.97` at `parse_gate.py:51`; measurable requires
`parse_status != 'failed'` **and** a positive integer `row_count`; any unmeasurable
filing forces `unmeasurable`; `no_efile_filings` requires an exactly-zero census.
**Evidence (tests, `tests/test_parse_gate.py`, 16 tests):**
`test_row_rate_is_judged_at_the_threshold_on_a_fully_measurable_era`,
`test_complete_failure_era_is_unmeasurable_not_n_a`,
`test_mixed_failure_era_is_unmeasurable_even_at_100_percent_surviving_rows`,
`test_a_single_unknown_filing_in_two_hundred_still_blocks_the_era`,
`test_null_or_zero_row_count_counts_as_an_unknown_denominator`,
`test_no_efile_filings_is_the_only_n_a_status_and_needs_a_zero_census`,
`test_needs_ocr_and_kadoa_are_excluded_from_both_censuses`,
`test_clean_is_decided_by_has_parse_defect_not_a_second_sql_flag_list`,
`test_the_threshold_constant_is_the_2026_baseline_ruler`.
**Evidence (live):** the rule fired for real. The first House run left one filing
with an unknown denominator (a 403 fetch) and the era read
`house 2015 | e-file rows 3952/4039 = 97.8% (floor) … measurable 390, unmeasurable 1 … status unmeasurable`
(`ops/m1-b/house-2015.log`) — a row rate above 0.97 that the gate still refused to
certify. After the resume refetched that one document it classified as paper, left
both censuses, and the era moved to `pass` with `unmeasurable 0`
(`ops/m1-b/gate-report.log`).

### R5 — Gate-miss surfacing, non-silent, severity-ranked

**Status: complete.** `format_gate_decision` emits the `OWNER DECISION REQUIRED`
block; the row rate is labelled a floor when the denominator is unknown; the three
options print verbatim; eras are severity-ranked and none suppressed.
**Evidence (tests):** `test_surfacing_names_the_era_the_options_and_labels_a_floor`,
`test_severity_ranks_the_worst_era_first_and_suppresses_none`,
`test_every_era_line_prints_its_unmeasurable_count_whatever_its_status`,
`test_a_passing_corpus_surfaces_no_decision`.
**Evidence (live, `ops/m1-b/house-2015.log`):** the real banner named the era, the
floor label, `unmeasurable e-file filings 1/391 (0.3% of the era)`, options
(a)/(b)/(c), and the closing line that the tooling never proceeds past the
decision, weakens the gate, or selects an option on the owner's behalf.

### R6 — Additive `stats.json` per-year extensions

**Status: complete.** `src/populus/stats.py` (+35 lines) adds
`efile_parse_gate_by_chamber_year_including_excluded` and
`member_join_primary_by_chamber_year_including_excluded`;
`tests/schemas/stats.schema.json` (+59 lines) updated in lockstep.
**Evidence (tests, `tests/test_stats.py`, 7 added):**
`test_efile_parse_gate_key_is_published_per_chamber_year`,
`test_member_join_key_is_published_per_chamber_year`,
`test_the_published_gate_figures_are_the_same_computation_as_the_summary`,
`test_the_existing_per_year_key_is_untouched_by_the_additive_keys`,
`test_stats_with_the_new_keys_validate_and_render_byte_stably`,
`test_an_unmeasurable_era_is_published_as_such_not_hidden`,
`test_the_schema_requires_each_per_year_key` (parametrised).

### R7 — `needs_ocr` counted per §5.2

**Status: complete.** **Evidence (test):**
`test_2015_paper_is_needs_ocr_retained_counted_and_out_of_both_censuses`.
**Evidence (live):** 2015-filed paper **300 / 690 = 43.5%**; paper across the whole
2015 index **338 / 728 = 46.4%**; e-file filings 390. Paper is retained with its
document link, counted in dispositions, and excluded from both e-file censuses. No
OCR was performed (non-goal honored).

### R8 — `parser_version` discipline, archive-only reparse, no parser change

**Status: complete (readiness verified; deliberately not exercised live).**
**Evidence (test):**
`test_reparse_by_parser_version_restamps_historical_filings_without_transport`
pins the no-transport property. **Evidence that no parser changed:** no file under
`src/populus/parse/` appears in `git status --short`. The path was not run on the
real corpus because it was measurably unnecessary — 2015 parses at 97.8% with the
existing parser. The follow-up sequence (bump `PARSER_VERSION`, then
`populus reparse congress-house --parser-version <previous-stamp>`, archive-only,
no refetch) is recorded in `docs/build/RUN-M1-B-devnotes.md` §6.

### R9 — Member-join coverage over the historical era via temporal aliases

**Status: complete.** **Evidence (tests, `tests/test_members.py`, +118 lines):**
`test_historical_era_joins_via_a_temporal_alias_and_unjoined_stay_visible`,
`test_a_2015_filing_does_not_resolve_through_a_modern_only_alias`.
**Evidence (live, `ops/m1-b/gate-report.log`):** house 2015 filings joined
**684 / 690** (6 unjoined), rows joined **4,015 / 4,039 = 99.4%**; the six unjoined
filers are named in the report, retained, flagged NULL, and counted.

### R10 — Cross-year Senate amendment-pair behaviour

**Status: complete hermetically; live measurement blocked by an upstream outage.**
**Evidence (test):**
`test_cross_year_amendment_pair_links_flags_both_sides_and_excludes_original`
(`tests/test_senate_ingest.py`) over the new committed fixture
`tests/fixtures/senate/hist-ptr-index.json` (2015-12 original, 2016-01 amendment):
`supersedes` set, both sides flagged, `v_default_transactions` excludes the
original. **Live pair count: NOT MEASURED** — the Senate window was never ingested
(eFD HTTP 503, see R17). Stated as unmeasured wherever the figure would otherwise
appear. No amendment-semantics change was made (non-goal honored).

### R11 — `make accept-m1-b`, synchronous, hermetic, never skips

**Status: complete.** `scripts/accept_m1_b.py` (new, 942 lines),
`tests/test_accept_m1_b.py` (new, 6 tests), `Makefile` gains `accept-m1-b: sync`
plus the `.PHONY` entry. **Evidence (coordinator):** `make accept-m1-b` →
**ACCEPTANCE PASSED**, driving the full chain and reporting **18 qualifying slices
with 2015 rows** and **24 published files inside budget**.
**Evidence (tests):** `test_acceptance_passes_and_prints_measured_figures`,
`test_the_hermetic_gate_reads_only_committed_fixtures`,
`test_the_operational_mode_shares_the_hermetic_assertion_body`.

### R12 — Phase B planned and sized, gated behind the recorded decision

**Status: complete (documentation requirement).** The sizing in
`docs/build/RUN-M1-B-devnotes.md` §4 **replaces** the plan's ~1 s/request prior
with the measured **301.8 s / 729 requests = 0.414 s/request**, giving ~1.1–1.2 h
for the ~10,000-request House remainder against a ~42 min politeness floor, and
~0.9 GB of archive (727 PTRs = 65 MB measured). `N_win` (the Phase A Senate
window) and `N_sen` (the Phase B Senate remainder) are stated as
measured-at-operation and are **not** fabricated. The authorization condition is
explicit: Phase B begins only under the owner's decision recorded in
`docs/build/RUN-M1-B-phase-a.md` §8 — including under a clean gate pass, because
the brief makes the decision itself the gate. **Evidence that nothing of Phase B
ran:** `ops/m1-b/` contains only 2015-era logs and archive; no other House year and
no Senate window were fetched.

### R13 — Gates green, mutations verified, Changed Files reconciled

**Status: complete, with one doer figure corrected.**
**Evidence (coordinator, independent re-run against this tree):**
`make test` → **`1728 passed in 426.01s`**; `make security` → **dep_guard OK**;
`make accept-m1-b` → **ACCEPTANCE PASSED** (full chain incl. feed latest-500
equality, 18 qualifying slices with 2015 rows, 24 published files inside budget).
Baseline 1645 → **1728 = +83**, zero regressions.
**Correction:** the free-form notes state "1,727 passed … +82". The measured
collection on this tree is `1728 tests collected`
(`uv run pytest --collect-only -q`), matching the coordinator's `1728 passed`. The
doer's count is off by one; the coordinator's figure is authoritative.
**Mutation verification:** 20 behavioural mutations applied and reverted, each
turning a test red (table in `docs/build/RUN-M1-B-devnotes.md` §3). Four (write
ordering, a schema key, feed containment vs exactness, the budget assertion) were
**not** caught on the first pass; each gap was closed with a test that fails under
the mutation, and the misses are recorded rather than quietly fixed. These 20
experiments are the doer's own record and were **not** re-applied by the
coordinating session.
Changed Files reconciled against `git status --short` below (28 entries).

### R14 — Senate submitted-date window seam, default-inert

**Status: complete.** `submitted_start_date` / `submitted_end_date` threaded
through `_index_post_body` → `discover` → `run_senate_ingest`
(`src/populus/ingest/senate.py`, +120 lines); `--submitted-start` /
`--submitted-end` on `populus ingest congress-senate` (`src/populus/cli.py`, +51
lines). **Evidence (tests, `tests/test_senate_ingest.py`):**
`test_default_body_is_byte_identical_to_the_watermark_behaviour`,
`test_an_explicit_start_bound_is_sent`, `test_an_explicit_end_bound_is_sent`,
`test_both_bounds_select_exactly_the_window`,
`test_a_historical_insert_cannot_regress_the_derived_watermark`,
`test_cli_accepts_the_window_options_for_senate`,
`test_cli_rejects_the_window_options_for_other_jobs`,
`test_cli_rejects_a_malformed_window_bound`.
**Evidence (live):** the bounded window was genuinely requested — the handshake
succeeded (home 200, agreement 302) and the bounded POST was issued on every
attempt; the source answered 503. The seam ran; the source did not.
**Deviation:** the CLI scoping tests landed in `tests/test_senate_ingest.py` rather
than the planned `tests/test_cli.py` (see Plan Deviations).

### R15 — Per-`(chamber, year)` member-join coverage

**Status: complete.** `compute_join_coverage` in `parse_gate.py`, surfaced in the
gate report and additively in `stats.json` (R6); the read-only cross-check query is
recorded in the runbook. **Evidence (tests):**
`test_join_coverage_is_measured_per_era_so_modern_rows_cannot_mask_it`,
`test_join_coverage_excludes_kadoa_and_reports_in_the_gate_report`,
`test_join_row_counts_read_the_default_view_not_raw_transactions`, plus
`test_member_join_key_is_published_per_chamber_year`.
**Evidence (live):** the `congress-legislators` historical inputs were verified and
era term coverage asserted non-zero for both chambers **before** the era join —
**house 484 / senate 126** members with terms overlapping 2015. Per-era figures as
under R9. The value of measuring per era is visible in the same report: house 2026
and senate 2026 both read 100% joined while house 2015 sat at 99.4% with six named
unresolved filers — exactly the masking the aggregate rate would have hidden.

### R16 — Acceptance extended to publication, consumer-contract-aware

**Status: complete.** The chain continues through `run_build` → `run_publish` →
`run_verify` on a `LocalDirBackend`; `feed_matches_contract` is exact list equality
(same ids, same order), never containment; `within_file_budget` is a hard
`<= 4000` cap. **Evidence (tests):**
`test_the_feed_contract_check_is_exact_not_containment`,
`test_the_file_budget_is_a_hard_cap`,
`test_an_over_budget_corpus_fails_the_acceptance_end_to_end`.
**Evidence (coordinator, hermetic):** feed latest-500 equality asserted, **18**
qualifying slices carrying 2015 rows, **24** published files inside budget.
**Evidence (live, `ops/m1-b/accept-operational.log`):** feed equals the DB's
expected latest 500 (500 rows, same ids, same order); **997** qualifying slices
(66 member / 932 ticker entities whose latest-200 window reaches the era);
`verify: ok`, 1,603 artifacts checked.

### R17 — Live operational Phase A on an explicitly resolved database

**Status: complete for the House era; the Senate half did not execute — upstream
source outage, unmeasured.** `scripts/phase_a_snapshot.py` (new, 268 lines) +
`tests/test_phase_a_snapshot.py` (new, 8 tests: pointer → manifest → asset
resolution; tampered asset refused before any copy; size mismatch refused; a
missing pointer, manifest, or asset is a hard stop and never a fresh database; a
manifest without a `congress.db` entry is a hard stop; counts disagreeing with the
published stats are a hard stop; a locator escaping the data repo is refused).
**Evidence (live):** corpus resolved from published build **`20260724.3`**,
`congress.db` sha256
`a2c38f24670d38a94324906e49d53437cc5b56bed44487e16eee4d028f78f918`
(26,447,872 bytes), copied through SQLite's backup API to `ops/m1-b/phase-a.db`,
`PRAGMA integrity_check` = `ok`, pre-ingest counts asserted equal to the
manifest-listed stats: filings **1,469**, transactions **4,765**,
`v_default_transactions` **3,911**. House 2015 ingested: **728 index PTRs**, 729
attempts, 0 retries, status mix `200:728, 403:1`, 0.0 s backoff, **301.8 s
elapsed**. **Senate `01/01/2015 → 03/31/2016`: NOT INGESTED.** Three attempts
across ~40 minutes each reached `POST /search/report/data/` and received **503**
four times (`attempts 6 | retries 3 | status mix 200:1, 302:1, 503:4 |
backoff_sleep_s 14.0`). Nothing persisted: 0 filings, 0 rows, watermark unchanged.
The 503 was reproduced outside Populus code with both the bounded body and the
unchanged open-ended default body, so it is a source-side outage, not the seam and
not a protocol regression (a CSRF or protocol fault would present as 403 and trip
the consecutive-403 breaker; it did not). No production database was mutated — the
canonical corpus and the published data repo were never written to; rollback is
`rm -rf ops/m1-b`.

### R18 — The same acceptance, re-run against the real Phase A database

**Status: complete.** One shared `assert_corpus` body, two entry points.
**Evidence (test):** `test_the_operational_mode_shares_the_hermetic_assertion_body`.
**Evidence (live, `ops/m1-b/accept-operational.log`):** **ACCEPTANCE PASSED
(operational)** — corpus filings **2,197** (from 1,469), transactions **8,804**
(from 4,765), `v_default_transactions` **7,950** (from 3,911), build `20260731.1`,
`verify: ok` over **1,603** artifacts, feed equals the expected latest 500, **997**
qualifying slices, member pages **166** (§9.10 assumed ~700), ticker pages
**1,431** (~2,500 assumed), published files **1,603 / 4,000** — 40% of the hard M1
budget after the era doubled the corpus.

### R19 — The Phase A stop point

**Status: complete.** `docs/build/RUN-M1-B-phase-a.md` opens with the halt
statement, records the gate report and options (a)/(b)/(c), names the artifact and
rollback, and poses the two decision questions. **Evidence that no Phase B work
occurred:** `ops/m1-b/` holds only 2015-era logs and archive; no non-2015 House
year and no Senate window were fetched. The run explicitly does **not** treat the
clean 2015 gate pass as authorization.

### R20 — Request / retry / wall-clock instrumentation on both polite fetchers

**Status: complete.** A shared frozen `FetchMetrics` dataclass in
`src/populus/ingest/__init__.py` (+41 lines) carries `attempts`, `retries`,
`backoff_sleep_s`, `status_counts`, and renders the one summary line both chambers
print; the counters increment inside `_PoliteFetcher` and `_PoliteSession`, and
`elapsed_s` comes from the already-injected `monotonic` (`None` in cache mode).
Politeness spacing is explicitly excluded from `backoff_sleep_s`, so a retry is
countable as distinct from a spaced request.
**Evidence (tests):** `test_retry_path_counts_two_attempts_one_retry_and_one_backoff`,
`test_no_retry_path_counts_one_attempt_per_request_and_no_backoff`,
`test_elapsed_comes_from_the_injected_monotonic_and_is_none_in_cache_mode`
(House); `test_senate_retry_path_counts_two_attempts_one_retry_and_one_backoff`,
`test_senate_no_retry_path_counts_no_retries_and_no_backoff`,
`test_senate_elapsed_comes_from_the_injected_monotonic_and_is_none_in_cache_mode`,
`test_a_tripped_breaker_still_reports_what_the_session_actually_did` (Senate).
**Evidence (live):** the figures under R17, plus the resume run's
`attempts 2 | status mix 200:1, 304:1 | elapsed 0.9s`. These measurements are what
re-derived the Phase B arithmetic under R12.
**Deviation:** `FetchMetrics` was placed in the shared `ingest/__init__.py` rather
than duplicated per fetcher; that file was not in Planned Files (see Plan
Deviations).

## Changed Files

Reconciled entry by entry against `git status --short` in
`/Users/johnbaek/projects/Populus-m25`. **29 entries: 15 modified, 14 untracked.**
The root `PLAN.md`, `DEV-NOTES.md`, and `QA-REPORT.md` are git-excluded workflow
artifacts and are correctly absent from that listing, as are
`.codex-review-m1bcode/` and `ops/`.

**One entry was added after the original reconciliation** — the count held at 28
through review rounds 1 and 2, every fix landing in a file the run already
touched. Round 3 adds exactly one file, `docs/build/M1-B-provenance-boundary-spec.md`,
under the owner's spec-first authorization.

### Modified (15)

| Path | Change | R-ids |
|---|---|---|
| `Makefile` | `accept-m1-b: sync` target + `.PHONY`, with its rationale comment | R11, R13 |
| `src/populus/cli.py` | `--submitted-start` / `--submitted-end`, scoped to `congress-senate`, MM/DD/YYYY shape validation | R14 |
| `src/populus/ingest/__init__.py` | **Unplanned.** Shared frozen `FetchMetrics` + `format_line` for both chambers | R20 |
| `src/populus/ingest/house.py` | Checkpoint-first PTR fetch + sidecar, verified-settled eligibility + counters, fetcher instrumentation, gate line and surfacing banner in `format_summary`. **Round 1 (F1):** verify-or-refetch in `_obtain_document`. **Round 2 (F1):** the settled pre-pass also requires a sidecar. **Round 3 (F1):** the rule is specified and both boundaries now evaluate the ONE predicate `_checkpoint_is_complete`, which validates the full §5.1 set against the canonical URL | R2, R3, R5, R20 |
| `src/populus/ingest/inst13f.py` | Imports the shared primitives, keeps `_`-aliases, call sites repointed (net −83 lines) | R1 |
| `src/populus/ingest/senate.py` | Default-inert window seam, `_PoliteSession` counters + `elapsed_s`, gate line/banner reuse | R5, R14, R20 |
| `src/populus/publish/build.py` | **Unplanned.** The inst-presence probe identifies an M1-only database by checking `sqlite_master` for the `inst_filings` table, so a published `congress.db` rebuilds instead of raising — while a genuine SQLite fault over a *present* table still propagates. *(Rewritten in code-review round 1, F3: the first version wrapped the probe in `except sqlite3.OperationalError` and read every fault as "inst absent".)* | enabler for R17, R18 |
| `src/populus/stats.py` | Two additive per-year `totals` keys sourced from `parse_gate` | R6, R15 |
| `tests/schemas/stats.schema.json` | Both keys added in lockstep (`additionalProperties:false` respected) | R6 |
| `tests/test_house_ingest.py` | 35 added tests: sidecar ordering, non-200 guard, missing/corrupt/fresh-DB resume, paper counting, reparse, instrumentation, **+2 round 1 (F1)**, **+4 round 2 (F1)**, **+15 round 3 (F1)** — the provenance-boundary spec's named tests: hash-only checkpoint, every §5.1 field missing in turn at *both* boundaries, blank/whitespace `retrieved_at`, a wrong `source_url`, the fresh-DB negative, the shared-predicate proof, and the predicate's own rejection set | R2, R3, R7, R8, R20 |
| `tests/test_inst13f_seam.py` | **Unplanned.** Spies the shared checkpoint writer so the crash-ordering test still sees both durable writes after the R1 lift | R1 |
| `tests/test_members.py` | 2 added tests: historical alias join; a 2015 filing must not resolve through a modern-only alias | R9 |
| `tests/test_publish.py` | **Unplanned.** 3 tests pinning the `build.py` probe above: the M1-only build, **+2 in code-review round 1 (F3)** proving a broken inst schema and a malformed inst view each FAIL the build rather than reading as "inst absent" | R17, R18 |
| `tests/test_senate_ingest.py` | 13 added tests: window seam (4), watermark non-regression, CLI scoping (3), cross-year pair, instrumentation (4) | R10, R14, R20 |
| `tests/test_stats.py` | 7 added tests: both keys, same computation as the summary, existing key untouched, byte-stable render, unmeasurable era published, schema-`required` per key | R6, R15 |

### New / untracked (14)

| Path | Contents | R-ids |
|---|---|---|
| `src/populus/ingest/checkpoint.py` | Shared `read_checkpoint` / `commit_checkpoint` / `sha256_hex` / `archive_verified`, plus `read_provenance` **(round 3, F1)** — the single sidecar parser, with `read_checkpoint` reimplemented on top of it | R1, R2, R3 |
| `src/populus/parse_gate.py` | `compute_parse_gate`, `compute_join_coverage`, era dataclasses, `format_gate_decision`, `GATE_THRESHOLD = 0.97`, plus `ParseGateConsistencyError` + `_assert_census_consistency` **(code-review round 1, F2)** — the row census now draws from exactly the measurable population the filing census defines | R4, R5, R15 |
| `scripts/accept_m1_b.py` | One assertion body, hermetic and operational entry points, through build → publish → verify + budgets | R11, R16, R18 |
| `scripts/phase_a_snapshot.py` | Manifest-resolved, sha256/size-verified, backup-API copy + integrity and count assertions. **Round 1 (F4):** all three expected counts required and integer-validated, and `congress/stats.json` itself sha256/size-verified. **Round 2 (F2):** the manifest now goes through the canonical `validate_manifest` + `pointer_manifest_identity_error` boundary before any dereference, which also makes both size comparisons unconditional | R17 |
| `tests/test_accept_m1_b.py` | 6 tests incl. the feed-exactness and hard-budget properties | R11, R16 |
| `tests/test_checkpoint.py` | 7 tests: round-trip, ordering, full rehash, non-durable bytes | R1, R2 |
| `tests/test_parse_gate.py` | 25 collected: both censuses, the no-tolerance rule, exclusions, surfacing, severity, per-era join, **+6 in code-review round 1 (F2)** — failed and NULL/zero-`row_count` filings' rows excluded from the floor, an all-unmeasurable era reports no floor rows, and the consistency invariant driven directly | R4, R5, R15 |
| `tests/test_phase_a_snapshot.py` | 20 collected: resolution plus tamper / size / count / locator hard stops, **+8 in round 1 (F4)**, **+4 in round 2 (F2)** — invalid manifest, artifact entry with no `bytes`, pointer/manifest cross-build binding, and the containment proof driven directly. The `data_repo` fixture was rebuilt on the **real `run_build` → `run_publish` path**, because the hand-rolled manifest it used was not in fact canonical | R17 |
| `tests/fixtures/house/2015FD.index.xml` | Committed minimal 2015 index | R11 |
| `tests/fixtures/senate/hist-ptr-index.json` | Committed historical index with the cross-year pair | R10, R11 |
| `docs/build/RUN-M1-B-plan.md` | **Unplanned as a file entry.** The approved plan, committed alongside the run | — |
| `docs/build/RUN-M1-B-devnotes.md` | The doer's free-form build narrative, Phase B sizing, runbook as executed | R12, R17 |
| `docs/build/RUN-M1-B-phase-a.md` | The Phase A decision record — measured figures, options, stop point | R17, R18, R19 |
| `docs/build/M1-B-provenance-boundary-spec.md` | **NEW in review round 3, owner-authorized spec-first.** Normative statement of the House archive durability rule: the domain, the ONE rule, the three boundaries that answer it, seven invariants with named tests, and the three-round history that made a spec necessary | R2, LD3 |

**Planned but not changed:** `tests/test_cli.py` — the CLI option-scoping tests
were written into `tests/test_senate_ingest.py` instead (see Plan Deviations).

**Outside version control, not published:** `ops/m1-b/` — external operational
state (the Phase A database, 728 archived PTRs + 728 sidecars, the run logs, the
local data repo). Safe to delete; that is the rollback.

## Reuse / Duplication Check

- **One checkpoint implementation, two callers.** The primitives were lifted out of
  `inst13f` rather than copied into `house`; `inst13f` keeps `_`-aliases so no
  caller broke. `house` imports the shared module and never `inst13f`, so the
  congressional module stays uncoupled from the SEC/parse stack.
- **One acceptance body, two modes.** `assert_corpus` is shared verbatim between
  the hermetic gate and the real-corpus run; the modes differ only in how the
  connection, archive root, and data repo are obtained. There is no second, weaker
  script to drift.
- **One definition of "clean".** The gate metric calls `has_parse_defect` in
  Python; the flag taxonomy is not reimplemented in SQL. Pinned by
  `test_clean_is_decided_by_has_parse_defect_not_a_second_sql_flag_list`.
- **One stored hash.** Verified-settled reuses the existing `filings.response_hash`
  column — no new column, no new sidecar format, no journal.
- **One counter shape.** `FetchMetrics` follows the established
  `inst_bulk.CountingTransport` semantics (attempts = every request that left the
  process) and lives in the shared `ingest` package so both chambers' summaries
  mean the same thing.
- **Existing skeletons reused:** the `accept_m2_6` trio shape and its
  `_build_and_publish` / `LocalDirBackend` pattern; the fresh-database
  zero-transport proof shape; the synthetic-index-plus-committed-pages fixture
  pattern for the cross-year pair (no new page HTML authored); `render_stats`
  byte-stability; the SQLite backup API the build already uses.
- **Deliberately not reused:** the `inst_bulk` per-filer journal envelope. The
  per-year index plus verified-settled eligibility plus per-document sidecars
  already give run- and byte-level resume; a coordinator journal would be scope.

## Simplicity Audit

- The Senate change is two optional parameters and one CLI pair; with neither
  option the request body is byte-identical to today, proven by a dedicated test.
  Reverting the seam cannot change incremental behaviour.
- `stats.json` grows by two additive keys; the existing per-year key auto-extends
  by year with no code change, and its shape is asserted untouched.
- The gate adds a dimension, not a second threshold: still exactly one constant
  (`0.97`), still applied only to the row rate. The filing census is two counts
  feeding one boolean.
- `phase_a_snapshot.py` is a resolver, not a subsystem: it reads artifacts the
  publish path already writes and calls the backup API the build already uses.
- The fetcher counters are four fields and one formatter — no wrapper layer, no I/O
  in the hot loop, no politeness constant touched.
- Stage B added **no** ingest code: it is the merged tooling driven by the
  documented CLI plus that one resolver.
- The one place simplicity was traded away deliberately: verified-settled re-hashes
  every candidate archive on every run (~65 MB per 2015 re-run) rather than
  checking size or mtime, because same-length corruption is precisely the failure
  mode the requirement exists to catch.

## Tech Debt Introduced

| Item | Severity | Note |
|---|---|---|
| Back-compat `_`-aliases in `inst13f` for the lifted primitives | Low | Thin shim; removable once nothing references the private names. |
| Verified-settled re-hashes every candidate archive per run | Low, deliberate | ~65 MB per 2015 re-run; ~0.9 GB across a full Phase B pass. If it ever becomes hot the fix is a cached digest sidecar, never a weaker check. |
| The unknown-denominator rule is strict by design | Low, deliberate | One unparseable document blocks an era until the owner rules. Historical eras will surface decisions more often than the 2026 baseline; severity ranking keeps the report readable. Validated in production on the first House run. |
| `hist-ptr-index.json` and `2015FD.index.xml` are crafted fixtures | Low | Consistent with the existing crafted-fixture convention. |
| `ops/m1-b/` external operational state | Low | Never published, never committed, safe to delete; it is the rollback. |
| Per-document sidecar duplicates `filings.response_hash` | None (intentional) | Filesystem-independent provenance per §5.1; it is what makes both resume and verification possible. |
| ~~The `build.py` inst probe catches a broad `sqlite3.OperationalError`~~ | **Retired — no longer debt** | This row described the round-1 implementation and is stale as of the round-1 F3 remediation: the broad catch is **gone**. The "tighter fix" it proposed — a `sqlite_master` lookup for `inst_filings` — is exactly what shipped, and the probe over a present table is now unguarded, so genuine faults propagate. Pinned by three tests (M1-only build, broken schema, malformed view). *(Corrected in code-review round 2, F3.)* |
| The House settled pre-pass re-reads a sidecar per candidate | Low, deliberate | Round-2 F1 added a sidecar read + parse alongside the existing per-candidate rehash. Negligible beside the rehash it sits next to, and it is what makes a settled skip mean "provenance intact" rather than "bytes intact". |
| The Senate historical era carries no live measurement | Medium, external | Not code debt: `N_win`, the live cross-year pair count, and the Senate per-request cost stay unmeasured until eFD serves the window. One command recovers them. |
| Pre-existing, unchanged | — | House ingest covers `FilingType == 'P'` only (no annual-FD path); House PTR amendments carry no `supersedes` linkage. Both are explicit non-goals, restated as caveats. |

## Memory Touch-Points

- **[[populus-project]]** — advances M1 corpus depth under ARCHITECTURE §9; the
  congressional module now has a measurable, resumable historical backfill and a
  published per-era gate. The 2015 era doubled the corpus (1,469 → 2,197 filings)
  and the published-file count still sits at 40% of the hard M1 budget.
- **[[verify-against-a-frozen-tree]]** — directly exercised. The doer's own
  "1,727 passed" did not match this tree; the coordinating session re-ran the gates
  independently, measured 1728, and this artifact records the coordinator's figure
  with the discrepancy named rather than silently adopting either number.
- **[[specify-before-rewriting]]** — the gate arithmetic and the settled predicate
  were pinned as specs in the plan (LD1, LD9, LD10) precisely because plan review
  round 1 showed them churning; neither needed a rewrite during dev.
- **[[orchestrate-devnotes-fluke]]** — reconfirmed and refined: the orchestrated
  dev phase produced correct work and was rejected on a model-provenance false
  positive, so this artifact was authored from the tree by the coordinating
  session. Budget the artifact-only recovery, not a re-run of the work.
- **[[orchestrate-worktree-isolation]]** — the run executed in the `Populus-m25`
  worktree, keeping the main checkout free.
- **John Baek profile** — measured-never-asserted discipline: every live figure
  here traces to a file under `ops/m1-b/`, and everything not measured is labelled
  unmeasured.

## Failure-Mode Sweep

- **A row claiming an archive that is gone or corrupt.** Closed by the re-hash
  predicate; proven with missing and corrupt bytes on the same database (one
  refetch each, no second) and a fresh-database zero-transport resume.
- **A "zero transport" proof that never exercises resume.** Avoided: the
  zero-transport assertion runs on a *fresh* database over the verified archive, so
  it cannot pass by simply skipping settled rows.
- **A non-200 freezing as a durable empty file.** Closed by the guard, and
  **observed in production**: the single 403 was never checkpointed or archived,
  its `raw_path` and `response_hash` stayed NULL, it remained refetch-eligible, and
  the resume refetched exactly it.
- **A historical template that parses nothing reading as n/a or pass.** Closed by
  the independent filing census; `no_efile_filings` requires an exactly-zero census
  and is tested as the only n/a status.
- **A percentage of filings used to bound row coverage.** Rejected in plan review
  round 2 and never implemented;
  `test_a_single_unknown_filing_in_two_hundred_still_blocks_the_era` is the guard,
  and the tolerance-band mutation turned it red.
- **Banner fatigue from strict unmeasurability.** Answered by severity ranking and
  by printing the unmeasurable count on every era line; ranking is presentation
  only and no era can be suppressed.
- **A consumer assertion a correct real corpus must fail.** Avoided: the feed is
  asserted to equal the DB's expected latest 500 exactly and is never required to
  contain an era row; era evidence comes from the stats keys plus DB-selected
  qualifying slices, which held on both the fixture corpus (18 slices) and the
  enlarged real corpus (997 slices).
- **The enlarged corpus blowing the page budget.** Measured, not assumed: 1,603 of
  4,000 published files on the real Phase A corpus; the budget assertion is a hard
  cap with an end-to-end over-budget test.
- **A torn or mismatched Phase A copy.** SQLite backup API, then
  `PRAGMA integrity_check` and count reconciliation against the manifest-listed
  stats, all before any ingestion write.
- **Stage B starting from an unresolved database.** Closed by manifest resolution
  with sha256 and size verification; tampered asset, size mismatch, missing
  pointer/manifest/asset, missing artifact entry, count disagreement, and a locator
  escaping the data repo are each a tested hard stop, never a fresh-database
  substitution.
- **The Senate run running away to a full backfill.** Closed by the seam plus the
  verified copy of the current corpus; the bounded window is what actually went on
  the wire.
- **A historical insert regressing the incremental watermark.** Tested directly; it
  cannot, and the 503 run persisted nothing in any case.
- **Schema drift.** `stats.schema.json` is `additionalProperties:false` and the
  per-key `required` test is the guard; the mutation pass exposed that this guard
  was initially missing, and it was added.
- **An M1-only published database failing to rebuild.** Discovered during stage B:
  a published `congress.db` carries the congress module only, so the inst-presence
  probe raised instead of answering "absent". Fixed and pinned by an end-to-end
  test. Without it, no published corpus could be rebuilt from.
- **Politeness drift under a live operational stage.** The floors are code
  constants and are untouched; the runbook adds no concurrency and no override. The
  measured 0.414 s/request against a 0.25 s floor confirms the floor held.
- **An upstream source outage mid-stage.** Realised, not hypothetical. Handled by
  reporting it as unmeasured everywhere the figure would appear, verifying the
  cause independently of Populus code, confirming nothing was persisted and the
  watermark could not have regressed, and recording a one-command recovery.
- **Residual, unresolved:** the live Senate era, the live cross-year pair count,
  and the Senate per-request cost are unmeasured. Any Phase B Senate sizing that
  quotes a number before that command is re-run would be fabricating it.

## Tests Run

### Gates — coordinator's independent run against this tree

| Gate | Command | Result |
|---|---|---|
| Tests | `make test` | **`1728 passed in 426.01s`** |
| Security | `make security` | **dep_guard OK** — no new dependency |
| Acceptance | `make accept-m1-b` | **ACCEPTANCE PASSED** — full chain incl. feed latest-500 equality, **18 qualifying slices with 2015 rows**, **24 published files inside budget** |

Baseline 1645 → **1728 (+83)**, zero regressions. Independently corroborated:
`uv run pytest --collect-only -q` → `1728 tests collected`.

### Gates — the doer's own figures, for comparison

| Gate | Doer's recorded result |
|---|---|
| `make test` | 1,727 passed (baseline 1,645, "+82") — **one short of the measured 1728; the coordinator's figure stands** |
| `make security` | `dep_guard: OK` |
| `make accept-m1-b` | exit 0, hermetic, never skips |
| `scripts/accept_m1_b.py --db …` (real corpus) | PASSED |

### Gates — re-run after each code-review remediation round

| Round | `make test` | `make security` | `make accept-m1-b` |
|---|---|---|---|
| 1 | **`1746 passed in 413.17s`** (1728 → 1746, **+18**) | dep_guard OK | ACCEPTANCE PASSED |
| 2 | **`1754 passed in 406.24s`** (1746 → 1754, **+8**) | dep_guard OK | ACCEPTANCE PASSED |
| 3 | **`1769 passed in 433.98s`** (1754 → 1769, **+15**) | dep_guard OK | ACCEPTANCE PASSED |

Zero regressions in any round, and every delta reconciles exactly against
per-file collection:

- **Round 1 (+18):** `test_house_ingest` 98→100, `test_publish` 170→172,
  `test_parse_gate` 19→25, `test_phase_a_snapshot` 8→16.
- **Round 2 (+8):** `test_house_ingest` 100→104, `test_phase_a_snapshot` 16→20.
- **Round 3 (+15):** `test_house_ingest` 104→119.

Cumulative **1728 → 1769 (+41)**. That the round-1 arithmetic closes on 1728 is
independent corroboration of the **coordinator's** baseline figure over the
doer's 1727 — the discrepancy recorded below resolves in the coordinator's
favour. Acceptance output was identical in all three rounds (feed latest-500
equality at 26 rows, 18 qualifying slices, 24 published files inside the 4,000
budget).

### New and extended test coverage (all inside the 1728)

`tests/test_checkpoint.py` 7 · `tests/test_parse_gate.py` 16 ·
`tests/test_phase_a_snapshot.py` 8 · `tests/test_accept_m1_b.py` 6 ·
`tests/test_house_ingest.py` +14 · `tests/test_senate_ingest.py` +13 ·
`tests/test_stats.py` +7 · `tests/test_members.py` +2 ·
`tests/test_publish.py` +1 · `tests/test_inst13f_seam.py` (spy extended).

### Mutation verification (doer-run, not re-executed by the coordinator)

20 behavioural mutations applied and reverted, each turning a test red. Four were
not caught on the first pass — write ordering, a `stats.json` schema key, feed
containment vs exactness, and the file-budget assertion — and each gap was closed
with a test that fails under the mutation. The misses are recorded, not hidden.

### Phase A live execution — measured, not a test

Every gate stayed socket-free; the live stage is an operator-run CLI sequence
outside pytest.

| Step | Outcome |
|---|---|
| Resolve + sha256-verify + backup-copy the published corpus | **done**, build `20260724.3`, integrity `ok`, pre-ingest counts 1,469 / 4,765 / 3,911 |
| Verify legislators inputs + era term coverage | **done** — house **484**, senate **126** members with terms overlapping 2015 |
| House **2015** live ingest | **done** — 728 PTRs, 729 attempts, 0 retries, `200:728, 403:1`, **301.8 s** |
| House 2015 resume pass | **done** — 727 verified, 0 reobtained, **2 requests / 0.9 s** |
| Senate **01/01/2015 → 03/31/2016** live ingest | **NOT COMPLETED — eFD HTTP 503**, three attempts, `200:1, 302:1, 503:4` each, 14.0 s backoff, ~21–23 s per attempt; **0 filings, 0 rows persisted; watermark unchanged; era unmeasured** |
| Member join over the enlarged corpus | **done** — house 2015 684/690 filings, 4,015/4,039 rows = 99.4% |
| `populus stats` + gate report | **done** — house 2015 `pass` at 97.8% (3,952/4,039), unmeasurable 0 |
| Same acceptance re-run on the real corpus | **done — ACCEPTANCE PASSED**, build `20260731.1`, `verify: ok` over 1,603 artifacts, 1,603/4,000 files |

**Evidence-retention caveat.** `ops/m1-b/` retains two Senate attempt logs
(`senate-2015.log` at 21.8 s, `senate-2015-attempt3.log` at 21.2 s). The Phase A
record's first attempt (22.7 s) has no surviving log under that directory, so that
one row is not independently reproducible from retained evidence. The 503 outcome
itself is corroborated by the two retained logs, which agree exactly on
`attempts 6 | retries 3 | status mix 200:1, 302:1, 503:4 | backoff_sleep_s 14.0`.

**Counter-state caveat — now corrected in the artifact.** The Phase A record's
resume table read "727 archived PTR documents / 727 sidecars", which is the state
*before* the resume refetched the previously-403 document. The archive on disk
holds **728 PDFs and 728 sidecars**, consistent with that document having been
refetched and archived — it then classified as paper, which is why the era's
e-file filing census fell from 391 to 390 and `needs_ocr` rose from 299 to 300
between the two gate reports. Code-review round 1 (F5) raised the same
discrepancy from the operational tree; `docs/build/RUN-M1-B-phase-a.md` §4 now
carries **both snapshots, explicitly labelled**, so the artifact and this caveat
agree.

### Code-review round 1 remediation (external review, uncommitted)

Findings file: `.codex-review-m1bcode/m1bcode-1.codex.last.txt`
(VERDICT CHANGES_REQUESTED — 4 blockers + 1 nit). Per-finding detail, evidence,
and mutation results: `.codex-review-m1bcode/RESOLUTION-NOTES.md`.

All four blockers were **fail-open** defects that the green gates could not see —
each lived on a branch no test exercised. That is the pattern worth recording: a
1,728-test suite at three green gates still shipped four untested
"absent/skip/trust" branches, because a fail-open branch produces a *plausible*
result rather than an error.

| ID | Defect | Resolution |
|---|---|---|
| F1 | The live House path trusted archived bytes with no checkpoint, minted a sidecar from them with a null `retrieved_at`, and reported zero transport | Self-heal branch removed; **verify-or-refetch**. No checkpoint ⇒ fetch-required |
| F2 | The e-file ROW census counted rows of failed / NULL / zero-`row_count` filings the FILING census calls unmeasurable | Row census draws era keys from the filing census's measurable set; `_assert_census_consistency` added |
| F3 | Every `sqlite3.OperationalError` probing the institutional view read as "institutional data absent" | Absence decided by `sqlite_master`; the probe is unguarded so real faults propagate |
| F4 | A missing expected count was skipped, then reported as matching `stats.json` | All three counts required + integer-validated; the stats artifact is itself hash/size-verified |
| F5 | Stale Phase A inventory (727 vs 728; "three" Senate logs) | Both snapshots labelled; **2 of 3** logs retained, identified by elapsed time as attempts **2 and 3** |

**Mutation-verified, each behavioural fix:** F1 restore self-heal → 2 red; F2
restore the old row-census query → 5 red; F3 restore the broad `except` → 2 red
(and the pre-existing M1-only test stays green, which is precisely why the
defect survived review); F4 two separate mutations → 7 red and 1 red. Every
mutation was reverted and the clean source re-verified green.

**Two honest notes on the remediation itself:**

1. The F4 tamper test **passed under its own mutant** on the first attempt — the
   size check was catching the tamper before the hash check could. The test was
   rewritten to use a same-length edit so it pins the sha256 comparison
   specifically. A mutation check that passes is a defective test, not a proven
   fix.
2. A mid-run stall interrupted a restore, leaving an `if False:` mutant live in
   `scripts/phase_a_snapshot.py` on disk. It was found by re-reading the file,
   restored, `__pycache__` purged, and the clean source re-verified at 16/16.
   Nothing else was mutated at the time.

**Scope discipline:** no file entered the change set. `git status --porcelain`
is still **28 entries (15 modified, 13 untracked)**, byte-identical in membership
to the pre-review listing — every fix landed in a file the run already touched.
`.codex-review-m1bcode/` and `ops/` are git-excluded, so the new
`RESOLUTION-NOTES.md` is correctly absent from that listing. No `ops/` artifact
was modified: F5 measured the live tree read-only and corrected only the
documentation.

### Code-review round 2 remediation

Findings file: `.codex-review-m1bcode/m1bcode-2.codex.last.txt`
(CHANGES_REQUESTED — 2 residual blockers + 1 nit). The round-2 audit confirmed
round-1 **F2, F3, and F5 genuinely resolved**, and found round-1 **F1 and F4
incompletely remediated**. Both residuals share one shape, and it is the lesson
of this round: **a fix applied at one boundary does not hold if a second
boundary can reach the same outcome without it.**

| ID | Defect | Resolution |
|---|---|---|
| R2-F1 | The settled pre-pass skipped an intact archive on the DB hash alone, *bypassing* the checkpoint requirement round 1 had just added to `_obtain_document` | A settled skip now also requires a present, readable, agreeing sidecar (live mode only) |
| R2-F2 | The snapshot dereferenced the manifest with ad-hoc `.get()` reads instead of the canonical validation + pointer-identity boundary | `validate_manifest` + `pointer_manifest_identity_error` called before `find_artifact`; both size checks now unconditional |
| R2-F3 | A stale Tech Debt row still described the removed broad `except sqlite3.OperationalError` | Row retired and marked corrected; the matching Plan-Deviation prose refreshed too |

**Two competing resume boundaries (R2-F1).** Round 1 hardened
`_obtain_document`, but `_ingest_year`'s settled pre-pass runs *first* and
answered the same question — "may this document be skipped?" — using only the
database hash. Deleting a sidecar while leaving matching bytes therefore
destroyed that document's `source_url` and `retrieved_at` permanently: zero
transport on every later run, and no path that could restore them. The fix
brings the pre-pass under the same rule. **Cache mode is deliberately exempt**
(it writes no sidecar by contract and has no transport with which to make one)
and that exemption is now pinned by its own test rather than left implicit.

**A second, weaker validator (R2-F2).** The snapshot maintained its own idea of
what a manifest is, beside the one the client, monitor, and verifier share. Two
concrete holes closed with it: a valid manifest for a *different* build could be
dereferenced and reported under `latest.json`'s build id; and an artifact entry
missing `bytes` bypassed size verification entirely, because the check read
`if expected_bytes is not None` — absent evidence treated as "nothing to check",
the identical fail-open shape as round-1 F4.

**A test-fidelity problem this exposed, worth stating plainly.** Wiring in the
canonical validator turned all 16 snapshot tests red: the `data_repo` fixture's
hand-rolled `manifest.json` **was not a valid manifest** (no `watermarks`, no
`schema_version`, a non-conforming `publisher`). Those tests had been passing
against a manifest the real client would reject. The fixture is now produced by
the actual `run_build` → `run_publish` path, so the manifest under test is the
shape production emits. Two existing tests also changed their observable
failure *message* — the canonical validator rejects a traversal locator and a
missing `congress.db` entry earlier than the script's own checks — so those
assertions were updated, and a direct test of the now-unreachable containment
guard was added so it cannot rot unnoticed.

**Mutation-verified:** R2-F1 drop the sidecar guard → 3 red (cache-mode test
stays green); R2-F2 neutralize `validate_manifest` → 4 red; neutralize
`pointer_manifest_identity_error` → 1 red. Each reverted and re-verified green
in the same tool call, after a round-1 stall once left a mutant on disk.

### Code-review round 3 remediation — spec-first (owner-authorized)

Findings file: `.codex-review-m1bcode/m1bcode-3.codex.last.txt`
(CHANGES_REQUESTED — 1 residual blocker + 1 nit). R2-F2 confirmed resolved;
R2-F3 resolved in these Dev Notes but not propagated to QA; **R2-F1 still
incomplete on the fresh-database obtain boundary**.

**This was the third consecutive residual in one boundary, so the owner
authorized SPEC FIRST.** That is the whole point of this round, and the
arithmetic justifies it: three rounds, three fixes, three residuals — each round
repaired the boundary the reviewer happened to be standing on.

| Round | Boundary found weak | The weaker rule it enforced |
|---|---|---|
| 1 | `_obtain_document` | *bytes present* ⇒ durable (self-heal a sidecar from them) |
| 2 | `_ingest_year` settled pre-pass | *bytes match the DB hash* ⇒ durable |
| 3 | `_obtain_document` again | *a checkpoint exists whose hash matches* ⇒ durable |

**The diagnostic is not "three bugs" — it is one rule, multiple boundaries, each
hand-rolled.** The rule lived in nobody's custody, so hardening one call site
said nothing about the others. Round 2's own notes even named the shape ("two
competing resume boundaries") and still fixed only one of them. That is the
signature the specify-before-rewriting threshold exists to catch.

**New:** `docs/build/M1-B-provenance-boundary-spec.md`, in the invariant style
of `M2-7-cover-tolerance-spec.md`. It states the rule **once** — a document is
durable iff its checkpoint carries the complete §5.1 set (`response_hash`,
`retrieved_at`, `source_url`, the URL matching the canonical one) **and** its
bytes re-hash to that `response_hash`; anything less is fetch-required — then
tables the **three** boundaries that answer the durability question, each mapped
to the rule and to its guarding test, plus seven invariants and the round-by-round
history above.

**Fix:** one predicate, `house._checkpoint_is_complete`, is now the only place
the rule is evaluated; **both** boundaries call it and neither re-derives
"complete" from field reads of its own (spec I1). `_obtain_document` previously
ignored the timestamp and could not inspect the source URL at all, so the
canonical URL is now threaded in from the caller — the sidecar can never be the
authority on its own provenance (I3). `checkpoint.read_provenance` was added as
the single sidecar parser, with `read_checkpoint` reimplemented on top of it.

**Boundary 3 is why the earlier fixes were insufficient.** On a fresh database
the settled pre-pass has no rows and cannot fire, so `_obtain_document` is the
*only* thing between an incomplete sidecar and a zero-transport reuse. Round 2
hardened boundary 1 and left boundary 2 accepting a hash-only checkpoint.

**Mutation-verified, one per field check:** drop the `retrieved_at` check → 6
red; drop the `source_url` check → 4 red; drop the `response_hash` presence
check → **initially GREEN**. Reported rather than hidden: that line is
*redundant by construction*, because a checkpoint with no hash is independently
rejected downstream (`sha256_hex(bytes)` can never equal `None`). It is kept as
an explicit statement of the "complete set" reading and is now pinned by a
direct predicate test, which does die under the mutation. A line no test can
kill is exactly what a reviewer should flag next round; better to pin it now.

**Nit (R3-F2):** `QA-REPORT.md` still described the removed broad
`sqlite3.OperationalError` catch. The finding asked for the security,
coverage-gap, **and** tech-debt statements — all three are refreshed, struck
through and annotated inline rather than deleted so the report still reads as
the record of what QA actually saw, plus a supersession header pointing at the
resolution notes and the new spec.

## Plan Deviations

1. **`tests/test_cli.py` was not modified.** The plan listed it MOD for the R14
   option-scoping tests. Those tests were instead written into
   `tests/test_senate_ingest.py`
   (`test_cli_accepts_the_window_options_for_senate`,
   `test_cli_rejects_the_window_options_for_other_jobs`,
   `test_cli_rejects_a_malformed_window_bound`). The coverage the plan asked for
   exists in full; only its file placement differs. Defensible — those tests use
   the Senate cache fixtures already in that module — but it is a deviation, not an
   equivalence, and is stated rather than absorbed.
2. **`src/populus/ingest/__init__.py` modified, unplanned.** `FetchMetrics` and its
   summary formatter were placed in the shared `ingest` package instead of being
   written twice. Stronger than the plan (one shape, two callers, the same
   reasoning that puts `TransportResponse` there), but the file was not in Planned
   Files.
3. **`src/populus/publish/build.py` + `tests/test_publish.py` modified, unplanned.**
   Stage B surfaced a real defect the plan did not anticipate: a published
   `congress.db` carries the congress module only, `ensure_views` applies the inst
   view DDL unconditionally, and probing `v_default_inst_filings` therefore raised
   `sqlite3.OperationalError` instead of answering "inst absent". The probe now
   identifies absence **positively**, by looking `inst_filings` up in
   `sqlite_master`, and produces the byte-identical M1 build the guard already
   promised — while any fault over a table that *is* present propagates as a
   visible publication failure. Without this, R18 could not have run against the
   real corpus at all. Scope-expanding but load-bearing, and pinned by three
   tests. *(The first implementation caught the exception broadly; corrected in
   code-review round 1, F3.)*
4. **`tests/test_inst13f_seam.py` modified, unplanned.** After the R1 lift the
   crash-ordering test was spying only inst13f's own writer and would have stopped
   observing the sidecar write. The spy now covers the shared primitive too. A
   direct consequence of R1; without it, R1 would have silently weakened an
   existing guard.
5. **`archive_verified` lives in `ingest/checkpoint.py`.** The plan named three
   lifted functions; a fourth was added there because the R3 predicate is the same
   primitive family and belongs beside them rather than inside `house.py`.
6. **`docs/build/RUN-M1-B-plan.md` appears as an untracked file.** The plan itself
   was written into the repo; it was not listed in its own Planned Files.
7. **The Senate half of the live Phase A did not execute.** Plan Rollout stage B
   step 4 could not complete: three attempts, each a source-side HTTP 503 on
   `POST /search/report/data/` after a healthy handshake, reproduced outside
   Populus code with both the bounded and the unchanged default request body. The
   plan's failure-mode sweep anticipated an interrupted stage B and the deviation
   is handled exactly as prescribed — nothing persisted, watermark intact, era
   reported as unmeasured, one-command recovery recorded. The plan did **not**
   anticipate reaching the stop point with a *partial* Phase A, and the run did so;
   that is surfaced as the second of the two owner questions rather than papered
   over.
8. **The test-count figure in the free-form notes is wrong by one** (1,727 vs the
   measured 1728). Corrected here; the coordinator's independent run is
   authoritative.
9. **No Phase B work, exactly as planned.** Not a deviation — recorded because R19
   makes the absence itself a deliverable.

## Model Provenance

- **Requested for the dev phase:** `claude-opus-5`, effort `max`.
- **Observed for the dev phase:** the orchestrated dev phase ran on
  `claude-opus-5` at effort `max`. Orchestrate nonetheless **REJECTED** the dev
  artifact on a **model-provenance false positive**: `modelUsage` also carried
  **25 output tokens attributed to `claude-haiku-4-5`**, emitted by CLI-internal
  machinery rather than by the dev reasoning, and the provenance check reads any
  non-requested model in `modelUsage` as a fallback. The implementation work itself
  was unaffected — the rejection is an artifact-gate outcome, not a statement about
  the code.
- **Recovery path for this document:** the work was **verified from the tree** and
  the gates were **re-run independently by the coordinating session**, not taken on
  the doer's word. Concretely: `git status --short` reconciled entry by entry;
  `git diff` read for every modified file; the new modules, tests, and fixtures read
  directly; the live evidence read from the `ops/m1-b/` logs and the on-disk
  archive; `uv run pytest --collect-only -q` re-run to corroborate the test count;
  and the three gate results quoted verbatim from the coordinator's own runs.
- **Author of this artifact:** the coordinating session (`claude-opus-5`), from the
  frozen tree and the independently produced gate evidence. Where the doer's
  free-form notes conflict with the tree, the tree wins and the conflict is named
  (see Plan Deviations 8 and the two caveats under Tests Run).
- **Not verified by this session:** the 20 mutation experiments were not re-applied;
  they are reported as the doer's record and labelled as such.
