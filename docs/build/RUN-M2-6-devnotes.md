# RUN M2-6 — Bulk 13F corpus (filer universe · quarter-bounded ingest seam · first real inst publish) — Dev Notes

Implementation of the APPROVED `plan-v1` ([RUN-M2-6-plan.md](RUN-M2-6-plan.md)). All
canonical gates green; changes left in the working tree (no commit/branch/push). Here is
the canonical Dev Notes.

---

## Detected Stack

Python 3.12, `uv` frozen-lockfile, `pytest -q`, `click`, SQLite/JSON1, `httpx` **only** via
`SecClient`. Gates: `make test` (`uv sync --frozen` + full suite), `make security`
(`scripts/dep_guard.py`), plus the new synchronous `make accept-m2-6`. Publish/serve via
`populus.publish.build` + `populus.client.snapshot` + `populus.mcp_server`. No new stack
element, no new dependency, no second HTTP client.

## Requirement and Task Completion

| Req | Status | Evidence |
|---|---|---|
| R1 Form-index discovery via `SecClient` only | complete | `discover_universe`/`_form_index_url`; `test_discover_universe_fetches_the_form_index_url`, `test_inst_bulk_imports_no_http_library` |
| R2 Quarter-bounded enumeration + complete-lineage targets | complete | `parse_form_index`, period filter in `rank_universe`, `lineage`; `test_full_lineage_target_avoids_amendment_unlinked` |
| R3 Ranking value matches `v_default` survivor semantics | complete | `_restatement_survivors`/`_out_orders`; six `test_ranking_value_matches_v_default_survivor_set` cases |
| R4 Truthful arithmetic; bounded N | complete | Locked Decision 3 arithmetic; N=1000 CLI default; `select_top_n` |
| R5 Resumable coordinator over one shared `SecClient` | complete | `run_bulk_ingest`; `test_resume_after_breaker_completes_the_run` |
| R6 Total per-accession outcome map; locked completeness rule | complete | `_per_accession_map`/`_classify_disposition`; absent/period_mismatch/partial_lineage tests |
| R7 Gate re-measure + publish admission, measured only | complete | acceptance builds/publishes; `inst in manifest = True` (gate/threshold unedited) |
| R8 `make accept-m2-6` synchronous hermetic; never skips | complete | `scripts/accept_m2_6.py` exit 0; `test_accept_m2_6` |
| R9 Hermetic tests; behavioural fixes mutation-verified | complete | autouse guard; seven mutation checks re-run under a bytecode-safe harness (7/7 killed) |
| R10 Gates + reconciliation | complete | `make test` 1586→1645 (no regression; +15 in the review-remediation round), `make security` clean, Changed Files == `git status` |
| R11 Operation planned not performed; runbook | complete | CLI `inst-bulk`; runbook in Rollout; no live fetch in Dev/QA |
| R12 SEC UA correctness preserved | complete | `_live_bulk_client` → `sec_contact()` warning + `SecClient` |
| R13 Per-document no-refetch resume; checkpoint-before-bytes | complete | `_obtain_resumable`/`_commit_checkpoint`; five boundary tests + corrupt/self-heal |
| R14 Measured operational metrics | complete | `CountingTransport`, `_metrics_snapshot`; metrics-across-resume test |
| R15 Serving-lifecycle acceptance | complete | acceptance install→serve, `inst_health` `published-snapshot`, aggregate query with build_id |
| R16 Deferral seam + benchmark | complete | `finalize_inst_ingest`; `test_finalize_runs_each_global_pass_once_regardless_of_n` |
| R17 Two versioned journals with distinct bindings | complete | `write_journal`/`load_journal`, `refs_sha256`/`universe_sha256`; parametrized negatives |

All 10 implementation tasks complete.

## Changed Files

- `src/populus/ingest/inst13f.py` (EDIT, backward-compatible) — `_read_checkpoint`/`_commit_checkpoint`; resume-aware `_LiveSource` (checkpoint-before-bytes, cache-first, non-200 never archived); `accessions`/`report_period`/`run_passes`/`resume` params on `run_inst13f_ingest`/`_run`; `period_mismatched` report field; `FinalizeReport` + `finalize_inst_ingest`. All new params default-inert.
- `src/populus/inst_bulk.py` (NEW) — discovery, ranking (survivor-matched value + lineage targets), `Universe` write/load, two journal helpers, `CountingTransport`, `run_bulk_ingest`, `format_bulk_summary`. Code-review round 1 added `SecStatusError`/`_require_document` (an acceptable HTTP status is required before any decode or parse, at discovery and at cover ranking; a transport failure propagates and is never journaled) and the strict `parse_form_index` accounting (form identified before the four-column check; exact `fullmatch` on the index filename).
- `src/populus/cli.py` (EDIT) — `inst-bulk` group (`discover`/`ingest`); `_live_bulk_client` (live `SecClient` over `CountingTransport`, UA warning).
- `Makefile` (EDIT) — `accept-m2-6: sync` target + `.PHONY` (the `sync` prerequisite added in code-review round 1, per implementation task 7).
- `scripts/accept_m2_6.py` (NEW) — hermetic discover→rank→drive→finalize→build→publish→install→serve + R13 resume sub-proof.
- `scripts/gen_m2_6_fixtures.py` (NEW) — regenerates the static `form.idx` from the corpus spec.
- `tests/bulk_corpus.py` (NEW) — committed synthetic single-period corpus builder + form.idx text + URL map.
- `tests/fixtures/inst/bulk/full-index/2026/QTR3/form.idx` (NEW) — committed static parser fixture.
- `tests/test_inst_bulk.py`, `tests/test_inst13f_seam.py`, `tests/test_accept_m2_6.py` (NEW) — 59 tests (44 at first implementation; code-review round 1 added 14 transport-status/parser cases and replaced one weak corruption-replacement test with two mid-replacement interruption boundaries, net +1).
- `docs/build/RUN-M2-6-devnotes.md` (NEW, this doc) — the durable Dev Notes record.

Reconciled against `git status`. Per-finding detail for the code-review round:
`.codex-review/RESOLUTION-NOTES.md` and `DEV-NOTES.md`.

## Reuse / Duplication Check

The coordinator drives the existing M2-2 chain (`run_inst13f_ingest`) — the same chain the
federated plane already reuses — never a forked amendment/merge implementation. Ranking is
*validated against* `v_default_inst_filings` (agreement tests), not a second merge. Durable
writes reuse `publish.atomic_write_bytes` (no new primitive). Discovery uses `SecClient.get`
only. Install→serve reuses `SnapshotClient`/`LocalRepoFetcher`/`build_server`/
`_inst_watermarks`. Checkpoint sidecars ARE the existing provenance sidecars
(submissions-meta/fetch-meta), so `_CacheSource` reads unchanged. No duplicate HTTP client;
`dep_guard` clean.

## Simplicity Audit

One parameterized ingest path, default-inert. Global post-passes collapse to a single
`finalize_inst_ingest` (structurally O(1) in N, benchmarked). Two small journals, each bound
to source-truth available when written. Deliberately not built: page-budget enforcement, a
discovery cache-source mode, a bespoke durability primitive, affiliation dedup at ranking
(accepted selection-time approximation per brief §4). The corpus builder emits no files
(returns a URL map), keeping the committed fixture surface to one `form.idx`.

## Tech Debt Introduced

- **TD-M2-6-3** — `form.idx` token parse (robust for the used fields; `master.idx` fallback documented). Bounded by strict parser tests. Owner: M2-6; removal: only if SEC index format changes.
- **TD-M2-6-4** — single-filing-quarter bound: late amendments filed in a later quarter are outside this run's index (counted limitation, not silent). Owner: follow-on run.
- **TD-M2-6-5** — affiliation over-count at ranking (stage-2 dedup not applied when selecting top-N; the *published* corpus stays correct because `v_default` applies it after ingest). Bounded and declared.
- Minor: the rank journal is rewritten every `flush_every` covers (default 25) via full-file `atomic_write_bytes` — accepted operational write cost, no new primitive.

No hidden debt.

## Memory Touch-Points

Consistent with [[populus-project]] and [[john-baek-profile]] (verified-primary-source,
measured figures, view-anchored ranking rather than a parallel implementation). Applied
[[specify-before-rewriting]] and [[verify-against-a-frozen-tree]] — a mutation-check
`git checkout` on the tracked `inst13f.py` silently reverted in-progress seam work; caught
by an import failure and fully re-applied and re-verified before finishing. Project memory
earmarked by the plan (M2-6 = default-inert seam extension + view-matched ranking +
two-journal resume through install→serve) is deferred to the docs/QA phase.

## Failure-Mode Sweep

Malformed/non-13F index lines (counted `rejected` vs out-of-scope skip); wrong
`period_of_report` dropped at ranking and `period_mismatch` at load; restatement /
NEW_HOLDINGS before-or-after / mixed survivor values agreement-tested; unparseable cover →
filer `rank_failed`; crash at every resume boundary (submissions-durable / some-docs /
checkpoint-present-bytes-absent / corrupt-at-rest / replacement / self-heal) → zero
transport for durable docs, exactly one fetch for a never-durable one; **non-200 responses
never archived as durable** (bug found and fixed during testing — a 403/404 was being
checkpointed as empty durable bytes); breaker trip → `circuit_open` STOP + `pending`,
resumes cleanly; unexpected exception → `ingest_error:<type>` persisted, run continues,
flips `ok`; journal corrupt/unknown-version/duplicate/mismatch rejected; hidden socket →
autouse guard. Coverage below 0.95 auto-withholds `inst`.

## Tests Run

- `make test` (canonical) → **1645 passed in 431.84s** after code-review round 1. Baseline collected **1586**; +44 at first implementation = 1630; +15 in code-review round 1 = 1645. **No regression** at either step.
- `make security` → `dep_guard: OK — no denylisted vendor dependencies or imports`.
- `make accept-m2-6` → exit 0 (the target now runs `uv sync --frozen` first); measured: 13 refs, ranking matches v_default oracle, top-5 selected, 5/5 filers loaded / 11 holdings, coverage 2070000000/2070000000 = 1.0000 meets gate, inst admitted, served `published-snapshot` (filers 5, build 20260930.1), aggregate query returns data with the snapshot build_id, resume re-read every durable document with ZERO transport.
- Mutation checks (applied then reverted): break survivor ordering → 4 agreement cases fail; treat hash-mismatch as reusable → corrupt-at-rest boundary fails; `loaded` on partial lineage → totality tests fail. All caught.
- Code-review round 1 mutation checks → **7 / 7 mutants killed**, re-run under a bytecode-safe harness (`__pycache__` cleared around every swap, `PYTHONDONTWRITEBYTECODE=1`) after a same-size statement swap was found to survive in a stale `.pyc`. Table in `DEV-NOTES.md`.

## Plan Deviations

- **Fixture shape (minor, within plan intent).** The plan lists committed static filer
  trees under `tests/fixtures/inst/bulk/`; the filer bodies are built via a committed
  shared builder `tests/bulk_corpus.py` returning an in-memory URL map (served through the
  fake transport), with the static `form.idx` committed as the R1 parser fixture. DRY across
  the unit tests, the acceptance, and the fixture generator; matches the existing
  `test_inst_agg` programmatic-corpus precedent. No requirement affected.
- No scope/architecture deviations otherwise. Ranking is anchored to `v_default_inst_filings`
  exactly as Locked Decision 5 requires; the gate/threshold/serving contract is untouched.

## Model Provenance

Requested model: `claude-opus-4-8`.

## Operational runbook (post-merge — NOT performed in Dev/QA)

Report period 2026-06-30, filing quarter 2026q3:
1. `export POPULUS_CONTACT=johnbaekk@gmail.com`.
2. `populus inst-bulk discover --filing-quarter 2026q3 --report-period 2026-06-30 --out ops/m2-6 --top-n 1000` → `universe-2026-06-30.json` + rank journal (~53 min; resumable, bound to `refs_sha256`).
3. **Seed identity coverage first:** `populus identity bootstrap --db populus.db --from-cache data-cache/inst/registry --list13f-cache data-cache/13flist --list13f-start-quarter 2026q2`; **assert seeded-quarter count > 0** before ingest (a fresh DB otherwise seeds zero quarters, `list13f.py:459`).
4. `populus inst-bulk ingest --db populus.db --universe ops/m2-6/universe-2026-06-30.json --raw-root data-cache/inst/raw --out ops/m2-6` → resumable, per-document cache-first ingest of the complete lineage (~38 min). Re-run to resume after any breaker STOP.
5. `populus build --db populus.db --data-repo ../populus-data` → gate passes → `inst` admitted; `populus publish …`.
6. **Install → serve:** refresh installs the published snapshot; confirm `inst_health` provenance `published-snapshot` and one aggregate query returns corpus data.
7. Record measured figures (filers ranked/selected/loaded, holdings, per-period coverage, publish result, breaker events, wall-clock, request counts) — measured, never asserted.

**Rollback:** additive and idempotent. Journals + universe are external state (never
published). Below-threshold coverage auto-withholds `inst` (`build.py:1708`); a bad publish
reverts via §13.5 `publish --rollback-to`. Code rollback = revert the single feature commit;
the seam extension is default-inert so reverting cannot break M2-2.
