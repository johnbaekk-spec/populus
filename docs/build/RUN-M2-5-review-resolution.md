# RUN M2-5 — external code review, round 1 resolution

Target: the ten BLOCKER findings F1–F10 in `.codex-review/code-1.codex.last.txt`
(verdict CHANGES_REQUESTED). All ten are addressed in the working tree; nothing
was committed, pushed, or branched.

This map documents **what fixed each finding**, not who fixed it. Part of the
round was applied by an earlier orchestrated fix pass whose findings list used a
different numbering; where its work already satisfied a finding's remediation
line, that is recorded as-is and the guard test is named. Everything was
re-verified by reading the current code and running the guard — nothing is
credited on the strength of a comment claiming it.

**Mutation verification.** Seven defects were reintroduced one at a time into the
current tree, the guard test run, and the source restored byte-exactly (harness:
`scratchpad/mutate.py`). **7 / 7 mutants killed** — no guard is vacuous. Results
are quoted per finding below.

---

## Round 1 resolution map

### F1 — cross-format substrate omits the option-asterisk flag
- **Changed:** `src/populus/parse/list13f.py:97-117` — `RawRow` is now
  `(cusip, issuer_name, security_class, status_flag, has_listed_option)`; the
  option asterisk is populated from text column 9 and, on the PDF side, from a
  lone `*` in the CUSIP column (`_list13f_row_mapper`, `:706-741`).
  `assert_cross_format_identity` (`:796`) therefore compares it row-for-row.
- **Guard:** `tests/test_list13f_parse.py::test_cross_format_gate_catches_a_dropped_option_asterisk`
  — flips **only** `has_listed_option` on one PDF row and requires the gate to raise.
- **Mutation:** forcing `has_listed_option=False` into the `RawRow` substrate →
  **KILLED** (1 failed).
- **Deviation from plan:** Locked Decision 5 described the tuple as
  `(cusip, name, class, flags)`. It now carries two explicit flag fields. This is
  what R5's "and all flags" requires. The text-only trailing status letter is
  deliberately *not* in the tuple — the PDF renders no counterpart column, so it
  is domain-validated in the text parser instead (F4).

### F2 — the R5 cross-format gate was conditional, not mandatory
- **Changed:** `src/populus/ingest/list13f.py:57` `_CROSS_FORMAT_REQUIRED_QUARTERS`
  + the both-present guard at `:374-380`; a dual-format quarter missing either
  variant is refused before parsing. `_LiveSource._obtain` (`:297-313`) also makes
  any non-200 other than a historical-text 404 a hard error, so a live
  text-200/PDF-fail race cannot seed unvalidated text.
- **Guards:** `test_text_only_cache_for_the_dual_format_quarter_is_refused`
  (missing PDF), `test_pdf_only_cache_for_the_dual_format_quarter_is_refused`
  (missing text — **added this round**, the finding requires both directions),
  `test_both_formats_present_for_the_dual_format_quarter_passes_the_gate`
  (positive control asserting `cross_format_checked is True`),
  `test_live_text_200_but_pdf_failure_is_a_hard_error`.

### F3 — parse coverage measured but never enforced
- **Changed:** `src/populus/ingest/list13f.py:61` `PARSE_COVERAGE_FLOOR = 0.999`
  enforced by `_validate_parse` (`:162-198`), called for both variants inside
  `_load_quarter` — i.e. before any `LoadedQuarter` can reach the seeder. It also
  rejects a zero-data-row parse (a cover+legend-only PDF scored 1.0 before) and a
  `Total Count` trailer that disagrees with the rows parsed.
- **Guards:** `test_parse_coverage_below_the_floor_is_refused` (below),
  `test_parse_coverage_exactly_at_the_floor_is_accepted` (**added** — 999/1000 =
  0.999 exactly must PASS, the case an off-by-one in the comparison operator
  breaks), `test_parse_coverage_above_the_floor_is_accepted` (**added** — passing),
  plus `test_pdf_with_no_data_region_is_refused`.
- **Mutation:** `if coverage < PARSE_COVERAGE_FLOOR:` → `if False:` → **KILLED**.

### F4 — unknown STATUS token silently became "continuing"
- **Changed:** `src/populus/parse/list13f.py:85-91` — documented domains for the
  STATUS cell (`*A*`/`*D*`/blank), the option cell (`*`/space) and the trailing
  status letter (`E`); violations set `field_ok=False` (`:575-579`) and land in
  the new counted `rejected_bad_field` bucket (`:190`), which also lowers
  `parse_coverage` (`:229`) so F3's floor sees them. The PDF side validates its
  own vocabulary (`:732`): an unrecognized STATUS word is a counted reject, not a
  silent blank.
- **Guards:** `test_unknown_text_status_is_a_counted_reject_not_blank`,
  `test_unknown_option_cell_is_a_counted_reject_not_false`,
  `test_bad_trailing_status_letter_is_a_counted_reject`, and
  `test_unknown_pdf_status_word_is_a_counted_reject_not_blank` (**added** — the
  PDF vocabulary was untested; it drives the real `_list13f_row_mapper` with real
  page anchors re-pointed so a non-status word lands in the status column).
- **Mutations:** text `field_ok = structural_ok` → **KILLED** (3 failed);
  PDF `field_ok = True` → **KILLED** (1 failed).

### F5 — `_CacheSource` accepted a raw list with no metadata sidecar
- **Changed:** `src/populus/ingest/list13f.py:102-144` `_verify_sidecar` — all six
  §5.1 fields required, and `sha256`/`bytes` recomputed and checked against the
  file, `http_status` must be 200, `source_url` must be the canonical endpoint.
  `_read` (`:254-290`) makes an absent sidecar a hard error. **Added this round:**
  malformed JSON and non-object sidecars now raise the typed `List13fIngestError`
  instead of leaking `json.JSONDecodeError` out of the ingest layer — the
  finding's "malformed sidecar" case was the one still unguarded.
- **Guards:** `test_cache_sidecar_is_required` (missing),
  `test_cache_sidecar_sha_mismatch_is_refused` (stale),
  `test_cache_sidecar_malformed_json_is_a_typed_error` (**added**),
  `test_cache_sidecar_that_is_not_an_object_is_refused` (**added**),
  `test_every_required_sidecar_field_is_enforced` (**added**, parametrized over
  all six fields so dropping one field's enforcement is still caught),
  `test_cache_sidecar_byte_count_mismatch_is_refused` (**added**).

### F6 — conflicting same-CUSIP metadata resolved first-wins
- **Changed:** `src/populus/parse/list13f.py:484-496` — a CUSIP's seed-worthy rows
  must share one definition `(issuer_name, security_class, is_option,
  has_listed_option)`; if they disagree the WHOLE CUSIP goes to the new counted
  `rejected_definition_conflict` bucket and seeds nothing. Order-independence is
  achieved by **rejecting**, not by picking a winner — as required.
- **Preserved:** status is deliberately *not* part of the definition, so Locked
  Decision 4's continuing+ADDED pairing still collapses to one record
  (`test_continuing_plus_added_seeds_once_as_continuing`,
  `test_byte_identical_rows_still_collapse_to_one_record`).
- **Guards:** `test_same_cusip_conflicting_definitions_seed_neither`,
  `test_definition_conflict_outcome_is_order_independent` (**added**,
  parametrized over BOTH orderings — the finding's explicit requirement; the old
  first-wins rule produced ALPHA vs BETA depending on order),
  `test_conflicting_option_flag_alone_is_a_definition_conflict` (**added**).
- **Mutation:** `if len(definitions) > 1:` → `if False:` → **KILLED** (4 failed).

### F7 — the R10 "full lifecycle" test inserted rows via helpers
- **Changed:** `tests/test_publish.py:4110-4245` — `_seed_identity_via_list` now
  runs the production chain end to end: identity bootstrap (tickers + FTD + the
  13(f) lists), then the real `run_inst13f_ingest` over the **tracked cached
  filings** at `tests/fixtures/inst/real/CIK0001067983`. No filer, filing or
  holding is inserted by a helper, and no `security_id` is hand-set — all 314
  holdings across the corpus's three periods are stamped by `resolve_cusip`
  inside the ingest. `_write_berkshire_inst_cache` (a hand-authored single-holding
  filing an earlier pass had introduced) is deleted.
- **Measured, not asserted:** the helper returns the figures it measured from the
  database and the test compares the SERVED totals against them. The previously
  hard-coded `total_value_usd == 2000` is gone; the served 2026-03-31 total is
  263,095,703,570 — which independently equals the `accept-m2-5` numerator for
  that period, confirming both paths read the same real bytes.
- **List provenance (stated as a deviation):** the definitional list rows for the
  hermetic test are derived from the corpus's own `form13fInfoTable` CUSIPs
  (`_corpus_quarters_and_rows`), because the real SEC list files are gitignored
  and cannot live in the test suite. The test therefore proves the LIFECYCLE
  (seed → ingest → build → publish → real `_resolve_snapshot()` → both inst
  tools); the coverage MEASUREMENT against the genuine SEC lists remains the
  `make accept-m2-5` evidence, per the plan's Testing Strategy.
- **Kept:** every pre-existing build/publish/client/server assertion, including
  `inst` in the manifest, `inst_from_published_manifest is True` from the real
  resolver, `build_server(**resolved)` unmodified, and the no-"UNVERIFIED SOURCE"
  checks on both tool envelopes.

### F8 — acceptance stopped at coverage and never built
- **Changed:** `scripts/accept_m2_5.py:107-126` `_build_and_publish` runs the real
  `run_build` + `run_publish` over a `LocalDirBackend` for **both** rollout
  databases and reads back the published manifest; `measure` (`:163-183`) returns
  `inst_in_manifest`, and `_report_path` (`:186-212`) fails the path unless `inst`
  was admitted. Existing output lines are retained and the admission result is
  printed on the corpus-wide line (`| inst in published manifest: yes`).
- **Guard:** `tests/test_accept_m2_5.py` (missing-input nonzero exit, and the
  cache-gated full run), plus the gate output quoted in DEV-NOTES.

### F9 — the fact-row `raw` carried no source representation
- **Changed (this round — was untouched):**
  - `src/populus/parse/list13f.py` — `_Candidate.source_row` / `_Parsed.source_row`
    / `List13fRecord.raw_source`; the text parser stores the **verbatim 80-char
    line** and the PDF parser the row reconstructed from its positioned words in
    reading order.
  - `src/populus/registry.sql:114-123` — new `source_row TEXT` column on
    `security_list_intervals`.
  - `src/populus/identity/registry.py` — `source_row` added to
    `_LIST_INTERVAL_COLUMNS` and to `list_interval_raw`'s canonical JSON.
  - `src/populus/identity/list13f_seed.py` — `record.raw_source` carried into
    every seeded row.
- **Migration determinism:** the recut in `reconcile_identity_registry`
  (`registry.py:1603-1640`) copies `source_row` verbatim onto every cut piece and
  recomputes `raw` as a pure function of it plus the piece's interval. The
  hard-coded tuple indices (`0/3/4/11/12/21`) that made this fragile are replaced
  by the derived `_LI` index map, so adding a column can no longer silently
  desync the migration.
- **Guards:** `tests/test_list13f_seed.py::test_seeded_row_persists_the_verbatim_source_line`,
  `::test_source_row_survives_an_authority_revision_recut`,
  `::test_recut_raw_is_deterministic_across_seed_then_revise_orders`, plus
  `tests/test_list13f_parse.py::test_text_record_carries_its_verbatim_source_line`,
  `::test_record_raw_source_is_the_representative_row_from_the_real_excerpt`,
  `::test_pdf_record_carries_its_reconstructed_source_row`.
- **Mutation:** dropping `"source_row"` from the `raw` canonical JSON → **KILLED**
  (2 failed).
- **Note:** the golden `tests/fixtures/inst/expected/list13f-2026q2.expected.json`
  was regenerated (`UPDATE_GOLDENS=1`) to carry `raw_source`; and
  `test_pdf_reproduces_the_text_records_via_x_anchored_columns` now compares the
  eight identity/flag fields exactly and asserts `raw_source` separately, since
  that field is legitimately format-specific. That is the only relaxation — record
  count, ordering and every other field are still compared exactly.

### F10 — per-row SQL for a high-cardinality backfill
- **Changed (this round — was untouched; the Dev Notes' `executemany` claim was
  false):** `src/populus/identity/list13f_seed.py:138-201` is now two phases —
  a pure phase that resolves owner pieces and builds every bind tuple in memory,
  then a set-based phase that writes the whole quarter in **two `executemany`
  batches** (securities, then intervals). `src/populus/identity/registry.py`
  gains `list_interval_row` (pure tuple builder) and `insert_list_intervals`
  (the batch writer); `upsert_list_interval` is retained as a thin single-row
  wrapper so both paths share one statement and one bind order.
- **Accounting preserved:** insert counts come from `total_changes` deltas rather
  than `rowcount` (undefined per-statement across an `executemany` with a DO
  NOTHING conflict clause), so a skipped duplicate is not counted and an identical
  replay still reports zero writes. `replace_quarter` semantics and the seed
  ledger are untouched.
- **Guards:** `tests/test_list13f_seed.py::test_seeding_is_set_based_not_per_row`
  (**added**) measures statement CALLS via a delegating connection proxy for a
  5-row and a 60-row quarter and requires them EQUAL — sqlite3's trace callback
  fires once per parameter set and so cannot tell `executemany` from a loop, which
  is exactly the distinction under test; it also pins `executemany_calls == 2`.
  `::test_batched_seeding_preserves_replay_zero_and_counts` (**added**) and the
  pre-existing `::test_same_sha_reseed_is_replay_zero`,
  `::test_replace_quarter_supersedes_transactionally` pin the accounting.
- **Mutation:** replacing the `executemany` with a per-row `conn.execute` loop →
  **KILLED**.

---

## Constraints honoured

- The 0.95 threshold, `compute_coverage`, the M2-4 serving lifecycle, the FTD
  write path, and replay-zero/determinism are unchanged. F6 achieves
  order-independence by rejecting conflicts, never by picking a winner.
- No test opens a socket; the autouse guard stands and the fetcher is exercised
  only through injected transports.
- No `git commit` / `push` / `checkout` / branch creation. Working tree only.
