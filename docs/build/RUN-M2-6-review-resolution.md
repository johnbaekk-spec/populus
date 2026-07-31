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

## M2-6 plan review — round 3→4 resolution

**F2 [BLOCKER] (round 3) — crash window between byte write and checkpoint write
caused a refetch of a complete document.** Adopted, resolved by protocol change,
not by narrowing the test: the plan now states **presence implies completeness**
— `atomic_write_bytes` (temp + rename) makes the rename the durability commit
point, so a present byte file can never be partial and is NEVER refetched. The
checkpoint is derived metadata: missing/stale → regenerated from on-disk bytes
(self-healing, zero transport); hash mismatch vs on-disk bytes → corruption →
refetch; absent bytes → fetch. Testing Strategy now has FOUR interruption
boundaries including exactly-after-rename/before-checkpoint with a
zero-transport assertion, plus dedicated absent-bytes and corrupted-bytes
refetch tests; the mutation check asserts boundary (c) fails if presence-trust
is removed. Amended: R13, Architecture seam, Locked Decision 6, Testing
Strategy, mutation checks.

## M2-6 plan review — round 4→5 resolution

**F2 [BLOCKER] (round 4) — the corruption-replacement path re-created the
two-write ambiguity: new bytes renamed, crash before the old mismatching
checkpoint was replaced → durable replacement refetched.** Adopted, using the
reviewer's own remediation: **checkpoint-before-bytes, always** — the
expected-hash checkpoint entry commits BEFORE the byte rename on first write
and replacement alike. A durable rename is therefore always preceded by its
matching checkpoint: mismatch on resume can only mean corrupt-at-rest or
superseded-in-flight (non-durable) bytes → refetch is correct; absent bytes →
at most one fetch of a never-durable document; duplicate SEC requests for
durable bytes are impossible by ordering. Five interruption boundaries now
include the reviewer's exact case: start from a mismatching checkpoint,
refetch, crash after the replacement rename → resume = zero transport.
Mutation check: inverting the write order fails boundary (d). Amended: R13,
Architecture seam, Locked Decision 6, Testing Strategy, mutation checks.

---

# M2-6 code review — round 1 resolution map

Target: the four BLOCKER findings F1–F4 in
`.codex-review/m26code-3.codex.last.txt` (verdict CHANGES_REQUESTED). All four
are fixed in the working tree of the `Populus-m25` worktree, branch
`feat/run-m2-6-bulk-13f-corpus-filer-universe-20260730-210233`. Nothing was
committed, pushed, branched, or checked out; no test opens a socket.

**Mutation verification.** Seven defects were reintroduced one at a time, the
guard test run, and every touched file restored byte-exactly (harness:
`scratchpad/mutate.py`). **7 / 7 mutants killed** — no guard is vacuous.

**Bytecode-hygiene note (a real trap hit during this round).** The F3 mutation is
a pure statement SWAP, so the mutant file has the *same size* as the original;
restoring it within the same mtime second left a `.pyc` whose
`(source_mtime, size)` still validated, and CPython then reused the **mutant
bytecode** for every subsequent run — silently reproducing the "defect" long
after the source was clean, and failing the two new F3 guards in a full
`make test`. Any same-size mutation "verified" before that discovery is
potentially vacuous. Remedy, now built into the harness: clear `__pycache__`
before and after every swap and run pytest with `PYTHONDONTWRITEBYTECODE=1`.
**All seven mutation checks in this round were re-run under that harness** — the
results below are the bytecode-safe ones, not the earlier suspect run.

## F1 [BLOCKER] — non-200 responses accepted as document content

*Remediation: require an acceptable status before decoding/parsing, propagate
retryable transport failures without journaling them, add hermetic 403/404/5xx
discovery and ranking-resume tests.*

**What changed** — `src/populus/inst_bulk.py`:
- `:87-115` new `SecStatusError` + `_ACCEPTABLE_STATUS = 200` + `_require_document`.
  200 is the complete acceptable set: `SecClient` collapses an in-memory cache
  hit and a 304 revalidation back to the cached 200, so everything else that
  reaches a caller (403 below the breaker threshold, 404, a 5xx that exhausted
  the backoff schedule) is a retryable transport failure.
- `:223` `discover_universe` requires the status **before** `.decode(...)` — a
  failed index fetch can no longer become an empty universe.
- `:352` `_fetch_cover_facts` requires the status **before** `parse_cover` — a
  transport failure can no longer become a terminal `cover_failed`.
- `:409-418` `rank_universe` flushes the covers that *did* parse and then lets the
  failure propagate; **nothing is journaled for the failed accession**, so a
  resumed sweep refetches it instead of trusting a frozen result.

**Guarding tests** — `tests/test_inst_bulk.py`:
- `test_discovery_propagates_transport_failure_instead_of_an_empty_universe`
  (403/404/500/503).
- `test_ranking_propagates_a_transport_failed_cover_and_journals_nothing_for_it`
  (403/404/500/503) — asserts the failed accession is absent from the journal and
  the earlier parsed covers are present (`flush_every=25`, so the flush is real).
- `test_rank_resume_refetches_a_transport_failed_cover` — the resume proof: a
  second sweep over the same journal **refetches** the transport-failed cover, does
  **not** refetch the journaled ones, ranks the filer at its true survivor value,
  and reports `rank_failed == ()`.
- Hermetic throughout: `_FakeTransport` gained a `statuses` map; no socket.

**Mutation verification** — 3 mutants, all killed:
| mutant | result |
|---|---|
| discovery status check removed | 4 failed (403/404/500/503) |
| cover-ranking status check removed | 5 failed |
| parsed covers not flushed before propagating | 5 failed |

**Scope note (stated, not hidden).** The finding names *discovery and cover
ranking*; both are fixed. The ingest seam's own document path already refuses to
checkpoint or archive a non-200 (`inst13f.py:387-397`), but a filing that fails
because its documents 404 still lands as a terminal `failed:<kind>` filer
disposition that a resumed bulk run skips. That is the pre-existing M2-2 filing
outcome model, outside F1's remediation line, and was deliberately **not**
changed here — touching it would alter the disposition state table and the
journal's terminal-prefix semantics this round is required to preserve.

## F2 [BLOCKER] — silent skip of short 13F rows; unanchored filename search

*Remediation: identify the form before the minimum-token check, classify
malformed 13F rows as rejected, replace the regex search with an exact full
match, add tests for short rows plus prefixed/suffixed filenames.*

**What changed** — `src/populus/inst_bulk.py` `parse_form_index`:
- `:180-187` the form is read from `tokens[0]` **first**; a non-13F row is dropped
  as out of scope, and only then is the four-column invariant checked — a 13F row
  that fails it is appended to `rejected`. Previously `len(tokens) < 4` short-
  circuited ahead of the form check, so a corrupt 13F row vanished from the
  accounting entirely.
- `:190-191` `_INDEX_FILENAME_RE.fullmatch(filename)` replaces `.search(...)`;
  the module constant `:62-67` documents why the anchor is load-bearing.

**Guarding tests** — `tests/test_inst_bulk.py`:
- `test_parse_form_index_counts_short_13f_rows_as_rejected` — two truncated 13F
  rows are counted; a truncated non-13F row is still out of scope.
- `test_parse_form_index_rejects_prefixed_or_suffixed_filenames` — 4 params:
  `Xedgar/…`, `/Archives/edgar/…`, `….txt.bak`, `….txt.gz`.

**Mutation verification** — 2 mutants, both killed:
| mutant | result |
|---|---|
| min-token check restored before form identification | 1 failed |
| `fullmatch` reverted to `search` | 4 failed |

## F3 [BLOCKER] — the corruption-replacement test could not observe the write order

*Remediation: interrupt between the two atomic writes (or immediately after the
replacement byte rename), resume from that actual intermediate state, and
mutation-test the reversed ordering.*

**Root cause of the weak guard.** The old
`test_boundary_replacement_then_resume_reads_from_disk_zero_transport`
(`tests/test_inst13f_seam.py:301` in the reviewed tree) let the replacement pass
complete BOTH writes and the whole ingest before resuming, so the end state was
identical under either ordering — and the refetched bytes were byte-identical to
the pre-corruption ones, so even the hashes matched. It could not fail.

**What changed** — `tests/test_inst13f_seam.py:329-403`, replacing that test with
two boundary tests that interrupt MID-replacement by spying on the two
`atomic_write_bytes` calls (`_replace_until`, `:355-375`) and resuming from the
ACTUAL intermediate archive state:
- `test_replacement_crash_between_checkpoint_and_byte_rename_refetches_once` —
  crash right after the checkpoint write. Asserts `order == ["fetch-meta.json"]`,
  the bytes on disk are still the corrupt ones, and the resume performs **exactly
  one** fetch (the cover) with clean rows.
- `test_replacement_crash_after_byte_rename_resumes_with_zero_transport` —
  crash right after the byte rename. Asserts
  `order == ["fetch-meta.json", "primary_doc.xml"]`, the committed checkpoint
  already matches the new bytes, and the resume makes **ZERO** transport calls.
- `_replacement_map()` (`:339-352`) serves a cover that is *byte-different* but
  semantically identical to the archived one, so the new checkpoint hash differs
  from the old one and the two orderings are genuinely distinguishable — without
  that, both orders converge on the same state and no assertion can separate them.

Production code is unchanged: `inst13f.py:398-405` already commits the checkpoint
before the byte rename. This finding was a test-strength defect.

**Mutation verification** — reversing the production write order
(`atomic_write_bytes(target, content)` before `_commit_checkpoint(...)`):
| mutant | result |
|---|---|
| write order reversed | **2 failed** — both new boundary tests |
| write order reversed, with the direct `order ==` / checkpoint-hash assertions neutralised | **2 failed** — the purely BEHAVIOURAL resume assertions (`attempts == 1`, `attempts == 0`) catch it on their own |

The second run is the one that matters: the guards are not passing on a
write-order assertion alone; the *resume behaviour* itself changes.

## F4 [BLOCKER] — `accept-m2-6` did not depend on `sync`

*Remediation: change the target to `accept-m2-6: sync` and verify the Make target
itself.*

**What changed** — `Makefile:43-49`: `accept-m2-6: sync`, with a comment stating
why (the acceptance gate must run in the same frozen-lockfile environment as
`make test`). `.PHONY` already listed it.

**Guard + verification** — the Make target itself was run, not only the pytest
wrapper:
- `make -n accept-m2-6` → `uv sync --frozen` then `uv run python scripts/accept_m2_6.py`.
- Mutation: with the `sync` prerequisite removed, `make -n accept-m2-6` emits only
  the script line — the dependency is genuinely load-bearing.
- `make accept-m2-6` executed end to end, exit **0**.

## Gate evidence (this round)

- `make test` → **1645 passed in 431.84s** (round-8 baseline 1630; **+15** = the
  14 new `test_inst_bulk.py` cases and the net +1 in `test_inst13f_seam.py`
  where one weak test became two). **No regressions.**
- `make security` → `dep_guard: OK — no denylisted vendor dependencies or imports`.
- `make accept-m2-6` → exit **0**; coverage `2070000000/2070000000 = 1.0000`,
  `inst` admitted, `inst_health` provenance `published-snapshot`, resume
  re-read every durable document with ZERO transport.

## Invariants preserved

- The 0.95 coverage gate, `compute_coverage`, the M2-4 serving lifecycle, the
  M2-5 identity paths, and replay-zero / journal semantics are untouched.
- `_TERMINAL_PREFIXES` and the disposition state table are unchanged; F1 removes
  results from the RANK journal path only, never adds a terminal one.
- Every new test runs under the autouse no-network guard through injected
  transports. No socket is opened.
- No `git commit` / `push` / `checkout` / branch. Working tree only, one worktree.
