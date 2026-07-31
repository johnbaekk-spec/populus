All tasks complete and all three gates green. Here is the canonical Dev Notes.

---

## Detected Stack

Python 3.12, `uv` + hatchling, SQLite/JSON1, Click, `httpx` (behind `SecClient`), `pdfplumber` + `pypdf` (already declared), FastMCP, pytest. **No new dependency** — R4's PDF parsing reuses the declared `pdfplumber`/`pypdf`; `uv.lock` stays frozen and `make security` (dep_guard) is exit 0. Canonical gates: `make test`, `make security`, and the new `make accept-m2-5`.

## Requirement and Task Completion

| ID | Status | Evidence |
|---|---|---|
| **R1** register + counsel flag | complete | `sec-13f-list` entry in `licenses.json` with `counsel_flags:["cusip-redistribution"]` and the verbatim CGS/ABA notice; `counsel_flags()` helper + optional-field validation in `licenses.py`; rendered into `DATA-LICENSE.md`/`NOTICE`; ARCHITECTURE.md §15/§17 name it; `tests/test_licenses.py` (incl. malformed-flag rejection). |
| **R2** fetcher via SecClient | complete | `_LiveSource`/`_CacheSource` in `ingest/list13f.py` through `SecClient.get` only; sidecar `{source_url,http_status,bytes,sha256,retrieved_at,user_agent}` with sha256==content; transport required; `tests/test_list13f_ingest.py`. |
| **R3** text parser | complete | `parse_list13f_text` on the fixture-pinned 80-char layout (`_TextLayout` constants cite the verified offsets); golden round-trip; `tests/test_list13f_parse.py`. |
| **R4** PDF parser + legend | complete | `parse_list13f_pdf` reuses generic `extract_positioned`/`_column_of` + new `_list13f_anchors`/`_list13f_row_mapper` (3-token CUSIP re-join); `parse_list13f_legend` asserts ADDED/DELETED/asterisk from page 1 and fails loud on drift; ≥99.9% parse-coverage. |
| **R5** cross-format gate | complete | `assert_cross_format_identity` (full raw_rows: count/order/multiplicity/tuples); hermetic excerpt test + perturbation/drop mutations; **full-file 25,333-row identity in `make accept-m2-5`**. |
| **R6** CUSIP validation | complete | `cusip_check_digit_ok` scoped to non-option; option-vs-non-option invariant mutation-verified; duplicate dedup-with-count; disposition buckets partition `rows_read`. |
| **R7** registry seeding | complete | `security_list_intervals` table; `bootstrap_13f_list` seeds `[quarter_start,next_start)` intersected with authority windows; precedence-aware fail-closed `resolve_cusip`; `resolve_security_name`; replay-zero + different-sha error + `--replace-quarter`; migration recut with bit-identical seed↔revise convergence; `tests/test_list13f_seed.py` + `test_identity_migration.py`. |
| **R8** backfill scope | complete | `select_backfill_quarters` (period-covering default + `--list13f-start-quarter` override); archive range recorded in the register entry. |
| **R9** gate re-measurement | complete | `compute_period_coverage`; **`make accept-m2-5`: 0.9996 corpus-wide, ≥0.9988 per covered period, on both rollout paths** (measured, in Tests Run below). |
| **R10** end-to-end publish | complete | `test_publish.py::test_r10_full_lifecycle_...`: gate passes via the list → `inst` admitted → real `_resolve_snapshot()` → `build_server(**resolved)` → `inst_filer_holdings`/`inst_ticker_holders` return real data with `published-snapshot` provenance; withheld-path tests still green. |
| **R11** honest degradation | complete | Uncovered quarter keeps bit-for-bit FTD-only arithmetic (valid-FTD-no-list test = 0.90, not zero); `uncovered_quarters` named on `inst_withheld`; mutation-verified. |
| **R12** no regressions | complete | `make test` **1578 passed / 8 skipped / 0 failed** (M2-4 baseline 1475 → 1532 first pass → 1578 after review round 1); `make security` exit 0; truth-table/agreement suites untouched; every behavioural fix mutation-verified (round 1: 7/7 mutants killed). |

## Changed Files

**New source**
- `src/populus/parse/list13f.py` — text + PDF parsers, legend parser, CUSIP check-digit, counted `Disposition13f`, `RawRow`/`List13fRecord`/`ParsedList13f`, `assert_cross_format_identity`, pure quarter helpers.
- `src/populus/ingest/list13f.py` — `_LiveSource`/`_CacheSource`, `quarter_from_url`, `select_backfill_quarters`, `prepare_list13f_quarters`, `LoadedQuarter`.
- `src/populus/identity/list13f_seed.py` — `bootstrap_13f_list` (quarter interval × authority-window cut, replay/replace policy) + provenance constants.
- `scripts/accept_m2_5.py` — the mandatory R5/R9 acceptance command (fresh + populated paths).

**Modified source**
- `src/populus/registry.sql` — `security_list_intervals` table + indexes (full §5.1 provenance on the fact row, incl. the `source_row` verbatim source line added in review round 1); `security_list_seed_ledger` (quarter-level replay/replacement key, written even for a zero-record quarter).
- `src/populus/identity/registry.py` — `IDENTITY_SOURCE_PRECEDENCE`, precedence-aware `resolve_cusip`, `resolve_security_name`, `list_interval_raw`, overlap-check extension, `SECURITY_ID_REFERENCING_TABLES`/`_CUT_TABLES` additions, `reconcile_identity_registry` list-interval recut + `_reconcile_list_review_state`. Round 1 added the set-based write path (`list_interval_row` + `insert_list_intervals`, with `upsert_list_interval` reduced to a single-row wrapper) and replaced the migration's hard-coded tuple indices with the derived `_LI` index map.
- `src/populus/identity/bootstrap.py` — 5 `list_intervals_*` + 2 `list_seed_ledger_*` `Mutations` fields + units + `LIST13F_MUTATION_FIELDS`; `run_identity_bootstrap` list wiring (single transaction); `BootstrapReport.list13f`; summary section.
- `src/populus/ingest/inst13f.py` — `compute_period_coverage`/`PeriodCoverage` (reporting only; `compute_coverage` unchanged).
- `src/populus/publish/build.py` — `uncovered_quarters` on the withheld reason + `inst_period_coverage` on the report (typed-reason set and 0.95 threshold unchanged).
- `src/populus/cli.py` — `identity bootstrap` gains `--list13f-cache`/`--list13f`/`--list13f-start-quarter`/`--replace-quarter`; per-period + uncovered-quarter output.
- `src/populus/licenses.py` — optional `counsel_flags` validation + `counsel_flags()` helper + rendering.
- `src/populus/licenses.json` — `sec-13f-list` entry. `DATA-LICENSE.md`, `NOTICE` — regenerated. `ARCHITECTURE.md` — §15.2 row + §15.3/§17 counsel-flag text. `Makefile` — `accept-m2-5` target.

**Tests** — new: `tests/test_list13f_{parse,ingest,seed,coverage}.py`, `tests/test_list13f_split_holdings.py` (authority-split repointing of persisted `inst_holdings` as-of each filing period), `tests/test_accept_m2_5.py`. Modified: `tests/test_licenses.py` (register set/dates + counsel-flag tests), `tests/test_identity.py` (FK tuple, `REGISTRY_TABLES`, resolver enumeration), `tests/test_identity_migration.py` (list-interval convergence + post-migration replay-zero), `tests/test_identity_bootstrap.py` (CLI list path), `tests/test_publish.py` (R10 E2E driven by the real cached Berkshire corpus + R11 build), `tests/test_inst_ingest.py` (golden one-to-one scoped to CIK goldens).

**Fixtures/docs** — `tests/fixtures/inst/13flist/` (2026q2 txt+pdf excerpts, 2025q1–2026q1 pdf excerpts, `PROVENANCE.md`), `tests/fixtures/inst/expected/list13f-2026q2.expected.json` (regenerated in round 1 to carry `raw_source`), `docs/build/RUN-M2-5-devnotes.md`, `.codex-review/RESOLUTION-NOTES.md` (round-1 map; `.codex-review/` is excluded via `.git/info/exclude`, so it does not appear in `git status`).

**Reconciled against `git status --short` (31 entries: 18 modified, 13 untracked) at the end of review round 1 — not from memory.**

## Reuse / Duplication Check

Extended repository primitives, no parallel implementations: HTTP through the single `SecClient` (no second client); PDF via the generic `extract_positioned`/`_column_of` only (House's `_header_anchors`/`_Segmenter` untouched — a small 13F adapter was added instead); the `Disposition`/`bootstrap_ftd` accounting-and-seeding shape mirrored; `owner_windows`/`cut_interval`/`ensure_security`/`target_for`/`applicable_value` reused verbatim so seeder and migration cannot diverge; `compute_coverage` reused unchanged for the PASS/FAIL decision. Quarter helpers were placed in `parse/list13f.py` (a pure home both `ingest` and `identity` import) rather than duplicated — see Plan Deviations.

## Simplicity Audit

Four new files, the rest additive edits to existing extension points. Every new public symbol is load-bearing: the two parser entry points keep the R5 gate's two independent sides; `raw_rows` (pre-dedup) is the cardinality-preserving R5 substrate a bare accepted-list can't express; `LegendSemantics` encodes the R4 "read from the document" rule; the dedicated `security_list_intervals` table + precedence branch avoid the resolver-ambiguity/provenance-clobber that reusing the FTD union would cause (rejected alternative); `compute_period_coverage` is read-only reporting beside the frozen gate. No provenance-union rewrite, no per-period gate engine, no new PDF dependency, no `security_names` table, no serving-layer change, no `NAME_SOURCE_PRECEDENCE` constant.

## Tech Debt Introduced

- **TD-M2-5-1** — the recorded canonical name (`resolve_security_name`) is not yet consumed by `inst_agg._issuer_key`'s `name` tier. *Impact:* cross-filer keying not yet strengthened by the canonical name. *Owner:* Populus. *Removal:* wire `resolve_security_name` into `_issuer_key` in a future aggregate revision. (The R7 name *contract* itself is delivered — this is downstream consumption only.)
- **TD-M2-5-2** — `security_list_intervals` stores one row per (CUSIP, quarter); contiguity holds at *resolution* but rows aren't physically merged. *Impact:* more rows; a spanning-interval consumer must union at read time. *Owner:* Populus. *Removal:* an optional read-time union view if needed.

**RESOLVED this round — TD-M2-5-3 (was undeclared, and that omission was itself the finding).** The seeder issued per-record SQL for a ~22,000-row-per-quarter backfill while the Failure-Mode Sweep asserted `executemany` batching. External review caught it as F10: an undeclared performance debt hidden behind an inaccurate claim. It is now **fixed rather than declared** — seeding is set-based (two `executemany` batches per quarter) and guarded by `test_seeding_is_set_based_not_per_row`. Recorded here rather than dropped silently, because the honest history is that the debt existed undocumented for a round.

Carried, not introduced: TD-M2-1-1 (FTD sparsity), TD-M2-4-1..3. None dropped. No remaining hidden debt.

## Memory Touch-Points

- `populus-project.md` — Populus redistributes publicly, so the CGS/ABA CUSIP IP notice is recorded verbatim and flagged (`counsel_flags`), and no vendor source is admitted (SEC primary only). Drove R1.
- `john-baek-profile.md` — the verified-primary-source bar: quarter identity, check-digit scoping (non-option 100%, verified 2026-07-30), legend semantics, and the full-file R5 identity were all verified against the cached bytes before coding, not assumed.
- `specify-before-rewriting.md` — the `rewrite_identifier_intervals` provenance-clobber risk was designed around up front (dedicated table + additive precedence branch), not patched after.
- `orchestrate-devnotes-fluke.md` — process note only; no code impact.

No memory file needs updating; nothing here contradicts an existing memory.

## Failure-Mode Sweep

- **verify-don't-assume (F0)** — every layout/semantic fact derived from `data-cache/13flist/` bytes and the legend page; the record count reconciles exactly (23,277 − 742 DELETED-only − 14 conflict = 22,521).
- **behavioural-test-validity (F2)** — mutation-verified: check-digit option scoping, status-conflict order-independence, cross-format perturbation/drop, replay-zero, uncovered-quarter naming, disputed/ambiguous precedence fail-closed, legend-drift fail-loud. Review round 1 added seven more, all killed: option-flag in the R5 tuple, parse-coverage floor, text and PDF flag-domain validation, definition-conflict rejection, `raw` source-row provenance, set-based seeding.
- **gate-list-completeness / full-tree gate (F1/F2)** — standing gate is `make test` AND `make security` AND `make accept-m2-5`, all run synchronously; the dep_guard false-positive on the word "socket" in a docstring was caught by `make test` and fixed.
- **units + NULL/awaiting contract (F1)** — intervals half-open `[from,to)` dates; `resolve_cusip` returns `None` fail-closed; `covered_by_list` an explicit boolean; a missing `security_list_intervals` table degrades to covered-by-list=False (guard).
- **no-print-secrets (F0)** — sidecars carry only public SEC URLs/hashes/UA; secret scan of new files clean.
- **prod-write/auth, pooler/RLS** — non-applicable (SQLite only; no auth surface, no Postgres/pooling).
- **bulk-SQL (F2)** — APPLICABLE, and initially VIOLATED. The first implementation seeded per-record (one `ensure_security` + one `upsert_list_interval` per row) while this section already claimed `executemany` batching. That claim was false and was caught as external-review F10. **It is now true:** `bootstrap_13f_list` resolves owner pieces and builds every bind tuple in pure Python, then writes each quarter in exactly TWO `executemany` batches (securities, then intervals) through `registry.insert_list_intervals`. Pinned by `tests/test_list13f_seed.py::test_seeding_is_set_based_not_per_row`, which measures statement CALLS for a 5-row and a 60-row quarter and requires them equal.

## Tests Run

Figures below are from the post-review-round-1 tree (all ten external blockers resolved).

- `make test` → **1578 passed, 8 skipped, 0 failed** in 258.58s (frozen-lockfile install + full tree). Progression: M2-4 baseline 1475 → first M2-5 pass 1532 → **1578** after the review round (+46 tests, no regressions, nothing removed). The 8 skips are the pre-existing cache-gated congress suites.
- `make security` → `dep_guard: OK — no denylisted vendor dependencies or imports` (exit 0).
- **Mutation verification (round 1)** → **7 / 7 mutants killed**. Each defect was reintroduced into the current tree, its guard test run, and the source restored byte-exactly: F1 option-flag dropped from the R5 substrate; F3 coverage floor not enforced; F4 text fixed-cell domains bypassed; F4 PDF STATUS vocabulary bypassed; F6 conflicting metadata picks a winner; F9 `raw` drops the source row; F10 per-row SQL restored. No guard is vacuous.
- `make accept-m2-5` → exit 0, verbatim. **The per-period figures are byte-identical to the pre-review run** — F1 (option flag in the R5 tuple) and F6 (definition-conflict rejection) did not move the measured coverage, because the real 2026Q2 file carries no same-CUSIP definition conflict and the PDF asterisk was already read correctly. The new lines are F8's build/manifest admission:
```
RUN M2-5 acceptance — real Berkshire corpus, lists 2025q1, 2025q2, 2025q3, 2025q4, 2026q1
R5 FULL-FILE cross-format identity PASSED: 25333 rows (text == pdf, count/order/multiplicity/tuples)

=== FRESH (seed → ingest → measure → build → publish) ===
corpus-wide value coverage: 796747370023/797063485143 = 0.9996
  certifiable(measurable): yes | inflated filings: 0 | meets_threshold(gate): yes | inst in published manifest: yes
  2025-03-31 [LIST]: 259491579752/259807694872 = 0.9988
  2025-12-31 [LIST]: 274160086701/274160086701 = 1.0000
  2026-03-31 [LIST]: 263095703570/263095703570 = 1.0000

=== POPULATED (ingest → seed → re-ingest → measure → build → publish) ===
corpus-wide value coverage: 796747370023/797063485143 = 0.9996
  certifiable(measurable): yes | inflated filings: 0 | meets_threshold(gate): yes | inst in published manifest: yes
  2025-03-31 [LIST]: 259491579752/259807694872 = 0.9988
  2025-12-31 [LIST]: 274160086701/274160086701 = 1.0000
  2026-03-31 [LIST]: 263095703570/263095703570 = 1.0000

ACCEPTANCE PASSED: corpus-wide meets_threshold, certifiable, every period list-covered and ≥0.95, and inst admitted to the published manifest — on BOTH rollout orders.
```

## Plan Deviations

All refinements below preserve every requirement, locked decision, and canonical command; none change scope or risk posture.

1. **Quarter helpers placement.** `parse_quarter`/`quarter_bounds` live in `parse/list13f.py` (pure, no deps) instead of `ingest/list13f.py`, so the identity seeder can import them without an ingest→identity layering inversion / import cycle; `quarter_from_url` still wraps them in `ingest`. Functionally identical.
2. **`run_list13f_ingest` shape.** The T6 "run_list13f_ingest" orchestrator is realized as `prepare_list13f_quarters` (load/parse/R5, before the transaction) + `run_identity_bootstrap`'s in-transaction seeding — honoring Locked Decision 9 (one `BEGIN IMMEDIATE`) instead of duplicating audit-row/transaction logic in a second entry point.
3. **`render_licenses.py` unchanged.** The counsel-flag rendering lives in `licenses.py`'s render functions (which `render_licenses.py` calls), so the script needed no edit; `DATA-LICENSE.md`/`NOTICE` were regenerated and are drift-guarded green.
4. **`List13fRecord` fields.** Added `has_listed_option` (the verified underlying-asterisk), `row_ordinal` and — in review round 1 — `raw_source` (§5.1 source-line provenance) beyond the plan's illustrative tuple.
5. **R10 envelope assertion.** `inst_from_published_manifest=True` is surfaced by the inst data tools as the `inst_health` provenance `"published-snapshot"` and the absence of the "UNVERIFIED SOURCE" note (there is no raw boolean key in the data envelope); the test asserts via those plus `resolved["inst_from_published_manifest"] is True` from the real `_resolve_snapshot()`.

**Added in external review round 1** (see `.codex-review/RESOLUTION-NOTES.md` for the full map):

6. **`raw_rows` tuple shape (F1).** Locked Decision 5 wrote the R5 substrate as `(cusip, name, class, flags)`; it is now `(cusip, issuer_name, security_class, status_flag, has_listed_option)` — two explicit flag fields, which is what R5's "row-for-row identity over … and all flags" actually requires. The text-only trailing status letter is deliberately NOT in the tuple (the PDF renders no counterpart column) and is domain-validated in the text parser instead.
7. **New counted disposition buckets (F4, F6).** `rejected_bad_field` (a fixed-position cell outside its documented domain) and `rejected_definition_conflict` (same-CUSIP rows disagreeing on issuer/class/option) join the T2 bucket list. Both still partition `rows_read` under the sum-assert; `rejected_bad_field` also lowers `parse_coverage` so R6's floor sees it. Status is deliberately excluded from the "definition", preserving Locked Decision 4's continuing+ADDED dedupe.
8. **`security_list_intervals.source_row` column (F9).** The plan's T7 column list did not include a verbatim source line; without it a published fact could not be audited against its exact source row once the gitignored cache was gone. Carried verbatim through the authority-revision recut so migration stays byte-deterministic.
9. **R10 list provenance (F7).** The lifecycle test drives the real `run_inst13f_ingest` over the TRACKED cached Berkshire filings, but its definitional list rows are derived from that corpus's own CUSIPs, because the real SEC list files are gitignored and cannot live in the test suite. The test therefore proves the LIFECYCLE; the coverage MEASUREMENT against the genuine SEC lists remains the `make accept-m2-5` evidence — the division the plan's Testing Strategy already draws.

## Model Provenance

Requested model: **claude-opus-4-8** (Opus 4.8) for the DEV implementation phase.
- Harness requested model: opus
- Harness primary observed model: claude-opus-4-8
- Harness complete observed modelUsage: `[{"model":"claude-opus-4-8","input_tokens":573,"output_tokens":357382},{"model":"claude-haiku-4-5-20251001","input_tokens":19902,"output_tokens":19}]`
- Harness fallback reason: `null`
