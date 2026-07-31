I now have the authoritative source of truth: `v_default_inst_filings` (views.sql:55–81) — restatement-survivor stage 1 (a RESTATEMENT supersedes everything it out-orders; base + NEW_HOLDINGS union otherwise) then affiliation stage 2. This lets me define the ranking rule to *provably match* the view and lock the four remaining gaps. Here is the fully revised plan.

---

# plan-v1: RUN M2-6 — Bulk 13F corpus (filer universe · quarter-bounded ingest seam · first real inst publish)

## Goal and Success Criteria

Give the merged M2 pipeline its first real institutional corpus for one explicitly budgeted quarter. Today the loaded corpus is the M2-2 sample (4 Berkshire filings, 314 holdings under `tests/fixtures/inst/real/CIK0001067983`) and there is no filer-universe mechanism — the CLI ingests one `--cik` at a time (`src/populus/cli.py:254`), and that path iterates **every** recent 13F accession for the filer (`src/populus/ingest/inst13f.py:1284`).

This run adds, as CODE only: (1) filer-universe discovery from the EDGAR quarterly form index through the existing `SecClient`; (2) effective-cover-value ranking whose value **provably matches** the authoritative `v_default_inst_filings` survivor set (views.sql:55), selecting top-N and carrying each filer's **complete period lineage** as ingestion targets; (3) a **default-inert extension of the M2-2 ingest seam** — accession allowlist + report-period assertion, **per-document hash-checkpointed cache-first resume**, and a deferred-post-pass finalize — plus a resumable coordinator with a **total per-accession outcome map** and measured metrics; (4) a synchronous hermetic `make accept-m2-6` proving discover→rank→drive→ingest→measure→build-admission→install→serve on committed fixtures. The operational overnight ingest runs **after** this code merges — planned and sized here, never executed in Dev/QA.

Success:
- `make test` green with **no regression** vs the baseline measured at run start (STATUS.md records 1578; the tree currently collects 1586 — Dev re-measures and reports the exact figure). Existing M2-2 tests stay green because the seam extension is default-inert.
- `make security` (`scripts/dep_guard.py`) clean — no new dependency, no second HTTP client.
- `make accept-m2-6` exits 0, printing measured figures (filers ranked, top-N selected, filings/holdings loaded, per-period value-coverage ≥0.95, `inst` admitted, snapshot installed, `inst_health` provenance `published-snapshot`, one aggregate query returning corpus data) — committed fixtures, zero sockets.
- Every hermetic test runs under the autouse no-network guard (`tests/conftest.py:14`); every behavioural branch mutation-verified; Changed Files reconciled against `git status`; deviations stated.

## Requirements

- **R1 — Form-index discovery via `SecClient` only.** Fetch the EDGAR quarterly form index through `SecClient` (`net/sec_client.py:263`). No second HTTP client; no new dependency/source/register entry.
- **R2 — Quarter-bounded enumeration + complete-lineage targets.** Parse the index for the **filing quarter**, keep form ∈ {`13F-HR`,`13F-HR/A`}, and (via covers) keep only filings whose `period_of_report` equals the locked **report period**. The universe carries, per selected filer, the **complete period lineage** (base `13F-HR` + every `13F-HR/A` for the period) as ingestion targets. *(F1 target set)*
- **R3 — Ranking value that matches `v_default` survivor semantics.** The effective cover value equals Σ `table_value_total` over the restatement-survivor set exactly as `v_default_inst_filings` stage 1 defines it (RESTATEMENT supersedes by later `filed_date`→`amendment_no`→`accession`; NEW_HOLDINGS + base union otherwise), converted to USD — with an **agreement test** asserting the pre-ingest ranking value equals the post-ingest `v_default` value for base-only, NEW_HOLDINGS-only, restatement, NEW_HOLDINGS-before-restatement, NEW_HOLDINGS-after-restatement, and mixed cases. No divergent merge implementation. *(F1)*
- **R4 — Truthful arithmetic; bounded N.** State filers × requests × floor → wall-clock, distinguishing filing-index quarter from report period, including amendments and every request stage. N fits the ≤1,500-filer-page budget (ARCHITECTURE.md:682) and an overnight window; N is a Locked Decision.
- **R5 — Resumable coordinator over one shared `SecClient`** (client-wide floor + breaker; resume across crash/breaker).
- **R6 — Total per-accession outcome map; locked completeness rule.** Persist, per filer, an outcome for **every** target accession (`parsed`/`partial`/`failed(kind)`/`absent`/`period_mismatch`). A filer is `loaded` **only** when every target accession is observed and succeeded (parsed/partial); otherwise a typed filer failure carrying the partial counts. `targets − observed` is classified `absent`, never silently dropped. Members reconcile to |universe| on full and partial runs (`pending` for unreached). *(F3)*
- **R7 — Gate re-measure + publish admission, measured only.** Gate/threshold/serving lifecycle unchanged.
- **R8 — `make accept-m2-6` synchronous hermetic acceptance**; never skips.
- **R9 — Hermetic tests**; behavioural fixes mutation-verified.
- **R10 — Gates + reconciliation.** `make test` no-regression, `make security` clean; Changed Files == `git status`; deviations stated.
- **R11 — Operation planned, not performed; runbook reaches published serving** with correct identity-coverage seeding. Non-goals honored.
- **R12 — SEC UA correctness preserved** via `SecClient`.
- **R13 — Per-document, no-refetch resume; checkpoint-before-bytes, always.** For EVERY document write — first write and corruption replacement alike — the expected-hash checkpoint entry is committed first (`atomic_write_bytes` on the meta file), then the document bytes are atomically renamed into place. A byte rename is therefore always preceded by its matching checkpoint, so **a durably archived document can never resume into a mismatch and is NEVER refetched**. Resume rules: bytes present + hash matches checkpoint → read from disk, zero transport; bytes present + hash mismatch → the bytes are corrupt-at-rest or a superseded-in-flight replacement (both non-durable states) → refetch; bytes absent → fetch (at most one request, and only for a document that never became durable); bytes present + checkpoint entry absent (defensive; unreachable under the ordering) → self-heal the entry from on-disk bytes, zero transport. Asserted at five interruption boundaries including first-write crash between checkpoint and rename, and replacement crash after the new-bytes rename starting from a mismatching checkpoint. *(F2, rounds 2–4)*
- **R14 — Measured operational metrics** — counting transport (attempts, retries, 304s vs cache hits) + injected monotonic timing; per-session and cumulative across resume.
- **R15 — Serving-lifecycle acceptance** — install the published snapshot and assert `inst_health` provenance `published-snapshot` + ≥1 aggregate query returning corpus data with the snapshot `build_id`.
- **R16 — Deferral seam + representative benchmark** — per-CIK loads use the existing filing path; global post-passes run once at finalization; a cardinality test evidences pass-count independence from N.
- **R17 — Two versioned journals, each bound to source-truth available when written, reusing `atomic_write_bytes`.** The **rank journal** binds to `refs_sha256` (canonical digest of the discovered filing references + ranking params — available at sweep time). The **ingest journal** binds to `universe_sha256` (the finalized universe). Load rejects corrupt/unknown-version/duplicate/mismatched entries; separate mismatch tests for each envelope. No new durability primitive. *(F4)*

## Scope

A **narrow, default-inert extension of the M2-2 ingest seam** plus a thin coordinator around it — not a divergent orchestration state machine, not a forked amendment implementation.

1. `src/populus/ingest/inst13f.py` (EDIT, backward-compatible) — `run_inst13f_ingest`/`_run` gain `accessions` allowlist, `report_period` assertion, `run_passes` deferral, and per-document cache-first resume on the live source; export `finalize_inst_ingest(conn)`. New params default to today's behavior.
2. `src/populus/inst_bulk.py` (NEW) — discovery, ranking (survivor-matched value + complete-lineage targets), coordinator (`run_bulk_ingest`), `CountingTransport`, two journal-envelope read/write+validate helpers.
3. Wiring: `populus inst-bulk` CLI group (`discover`, `ingest`); `accept-m2-6` Makefile target; `scripts/accept_m2_6.py`; tests + committed fixtures.

## Non-goals

- No new data sources / register entries; no second HTTP client; no new runtime dependency.
- No change to the coverage gate, its 0.95 threshold, or the M2-4 serving lifecycle contract.
- No dashboard pages / page-budget enforcement in code (≤1,500 budget bounds N as a selection limit only).
- No multi-quarter backfill beyond the one budgeted report period; late amendments filed in later filing quarters are a documented, counted limitation revisited by a follow-on run.
- No execution of the live overnight ingest in Dev/QA.
- No fork of M2-2 parse/normalize/merge logic; ranking reads only declared cover totals + amendment types and is agreement-tested against `v_default`.
- **Affiliation dedup is NOT applied at ranking** — per brief §4 the affiliated-filer over-count is an accepted selection-time approximation (stated); `v_default` stage-2 affiliation still governs the *published* corpus after ingest.

## Constraints

- **`SecClient` is the only network path**, wrapped by one `CountingTransport`; new code imports no HTTP library. One shared client so floor + breaker are client-wide.
- **Library reads no wall clock / randomness** — injected `now`/`run_id`/`host`/`sleep`/`monotonic`.
- **Seam extension is default-inert** — `accessions=None`, `run_passes=True`, `resume=False` reproduce today's behavior; all M2-2 tests pass unchanged.
- **Filing quarter ≠ report period** — both locked in the universe and journals.
- **Durable resume = the raw archive + per-document hash checkpoints**, not `SecClient`'s per-process cache (`net/sec_client.py:291`).
- **`v_default_inst_filings` is the ranking source of truth** — the ranking rule is written to match it and corrected to it if the agreement test diverges.
- **`dep_guard` scope** — paid-vendor denylist only; "no second HTTP client" stays true by adding none.
- Hermeticity: all tests + acceptance run under the autouse socket guard; the acceptance drives the whole chain via a `_FakeSecTransport` over a real `SecClient` + `LocalDirBackend`/`LocalRepoFetcher`.

## Current State

- **Per-CIK ingest is unbounded by quarter.** `_run` loops `for entry in discovery.entries` (`inst13f.py:1284`) over all 13F accessions; no period/accession filter. Post-passes run at the tail (:1303–1307) on every call.
- **The live source always fetches.** `_LiveSource._obtain` (:227) calls `SecClient.get` before writing/using bytes; the accession `fetch-meta.json` is written once at accession end — so a crash mid-accession forces refetch of all its docs, and `submissions.json` is refetched on any resumed CIK.
- **Authoritative amendment semantics (source of truth):** `v_default_inst_filings` (views.sql:55–81) = **stage 1** restatement-survivors (a RESTATEMENT supersedes any filing it out-orders by `filed_date`→`amendment_no`→`accession`; a NEW_HOLDINGS amendment is *not* a supersede, so base + NEW_HOLDINGS survive and their **union is the merge**, comment :49–50) then **stage 2** affiliation dedup over survivors. `link_inst_amendments` (:814) links each amendment to the **unique non-amendment base** for the `(cik, period)`; a missing base → `amendment_unlinked` (:855).
- **No EDGAR full-index handling exists** (only an unrelated `full_index` member-name symbol). R1–R3 are new.
- **The ingest chain is already reused, not forked** — `mcp_server/inst_queries.py` imports `discover`/`evaluate_filing`/`_Doc`/`_archive_base` for the federated plane (precedent for the seam extension).
- **Coverage + publish + serving are built and tested** — gate `publish/build.py:1686`–1747, manifest inject :1808–1827, `test_inst_gate_publishes_both_modules_when_covered` (`tests/test_publish.py:2159`); install via `SnapshotClient`/`LocalRepoFetcher`, `build_server(inst_from_published_manifest=True)` (`mcp_server/server.py:176`), `inst_health` (:850), published-provenance asserted at `tests/test_mcp_server_inst.py:453`,:1100.
- **Primitives:** `atomic_write_bytes` (`publish/__init__.py:20`); list-quarter selection returns `[]` on a fresh DB unless `--list13f-start-quarter` is given (`ingest/list13f.py:459`–461).
- **M2-5 merged (this tree):** 0.9996 corpus-wide; `scripts/accept_m2_5.py` + `make accept-m2-5` template.

## Detected Stack

Python 3.12, `uv` frozen-lockfile, `pytest -q`, `click`, SQLite/JSON1, httpx **only** via `SecClient`. Gates: `make test`, `make security`, `make check`; new synchronous `make accept-m2-6`. Publish/serve via `populus.publish.build` + `populus.client.snapshot` + `populus.mcp_server`. No new stack elements.

## Reuse Map

| Need | Reuse (path) | Note |
|---|---|---|
| All network I/O | `SecClient.get` (`net/sec_client.py:302`); `.cache_hits`/`.coalesced` (:295) | one shared instance under `CountingTransport` |
| Ingest chain (extended) | `discover`,`evaluate_filing`,`upsert_inst_filing`,`_run` (`inst13f.py:330`,:460,:1284,:1222) | add allowlist + `run_passes` + resume |
| Post-passes (run once) | `link_inst_amendments`,`mark_affiliated_coverage`,`inst_pair_invariant_errors`,`compute_coverage` (:814,:859,:915,:970) | new `finalize_inst_ingest` |
| **Ranking source of truth** | `v_default_inst_filings`/`v_default_holdings` (views.sql:55,:86); survivor ordering (:65–70) | agreement test target |
| Cover parse + amendment type | `parse_cover`→`table_value_total`,`is_amendment`,`amendment_type` (`parse/inst13f.py:288`,:252) | ranking value + lineage |
| USD normalization | `unit_basis_for`+`UNIT_MULTIPLIER` (`normalize_inst.py:98`,:32) | era-correct value |
| Durable writes | `publish.atomic_write_bytes` (`publish/__init__.py:20`) | journals + per-doc checkpoints (no new primitive) |
| Path containment | `archive_path` (`ingest/__init__.py:34`) | cache-first reads |
| Build + admit inst | `run_build`/`run_publish`+`LocalDirBackend` (`publish/build.py`) | acceptance + operation |
| Install + serve | `SnapshotClient`/`LocalRepoFetcher`, `build_server(inst_from_published_manifest=True)`, `inst_health` (`mcp_server/server.py:176`,:850) | F6 acceptance |
| List seeding | `run_identity_bootstrap` + `--list13f-start-quarter` (`cli.py:365`, `list13f.py:459`) | runbook coverage seed |
| Journal/reconciliation precedent | `run_backfill_ingest`/`BackfillReport.reconciled` (`backfill.py:232`,:223) | disposition shape |
| Acceptance shape | `scripts/accept_m2_5.py` + `tests/test_accept_m2_5.py` | importlib load, `run_acceptance(out=sink)` |
| Test doubles | `_FakeSecTransport`/`_crafted_url_map` (`tests/test_inst_ingest.py:592`), `_seed_cusip` (:472), `make_client` (`tests/test_sec_client.py:81`) | hermetic wiring |

## Architecture

**Two locked keys:** `filing_quarter` (which full-index) and `report_period` (which filings to keep), both carried in the universe and journals.

**Discovery (R1/R2/R12).** `parse_form_index(text)`: skip header to the dashed rule; per data line tokenize on whitespace — `form=tokens[0]`, `filename=tokens[-1]`, `filed=tokens[-2]`; keep `13F-HR`/`…A`; derive `(cik,accession)` with strict regexes; malformed → counted `rejected`. `discover_universe(client, filing_quarter)` fetches `.../full-index/<yyyy>/QTR<n>/form.idx`.

**Ranking (R3/R2/R4) — matches `v_default` stage 1, no fork.** `rank_universe(client, refs, report_period, *, journal, now)`: fetch each candidate cover, `parse_cover`; **drop covers with `period_of_report ≠ report_period`**. Group surviving filings by CIK; compute the **restatement-survivor set** with the *identical* ordering to views.sql:65–70:
- Survivors = filings not superseded by any RESTATEMENT that out-orders them (`filed_date` > , then `amendment_no` > , then `accession` >).
- With no restatement → base + all NEW_HOLDINGS amendments survive (union = merge). With restatement(s) → the top-ordered RESTATEMENT + every filing it does *not* out-order (i.e., NEW_HOLDINGS filed after it) survive; the base and pre-restatement amendments are superseded.
- **Effective value = Σ `table_value_total` over the survivor set**, converted to USD (`unit_basis_for`).

Rank ↓, take top-N. The universe stores, per filer: rank, cik, effective USD value, **and the complete period lineage** (base + every amendment) as the ingestion target set — because M2-2's `link_inst_amendments` requires the base present or a restatement becomes `amendment_unlinked` (:855). An **agreement test** asserts the pre-ingest effective value equals Σ `table_value_total_usd` over `v_default_inst_filings` for that `(cik, period)` after ingesting the full lineage, across all six amendment cases (R3); on divergence the ranking rule is corrected to the view. *(Affiliation stage-2 dedup is not applied at ranking — accepted selection over-count, brief §4.)* The sweep appends each cover result to the rank journal bound to `refs_sha256` (R17).

**Seam extension (R13/R16/R2), in `inst13f.py`, default-inert:**
- `accessions: frozenset[str] | None` + `report_period: str | None` → filter `discovery.entries` to the target set and **assert each loaded filing's `period_of_report == report_period`**, recording `period_mismatch` for any that differ (never silently loaded).
- `run_passes: bool = True` → when `False`, skip the tail post-passes.
- **Per-document cache-first resume (checkpoint-before-bytes):** for every document, the live source first commits the expected-hash checkpoint entry (`submissions.json`↔`submissions-meta.json`; accession docs into `fetch-meta.json`, each update via `atomic_write_bytes`), and only then atomically renames the document bytes into place — on first write AND on corruption replacement. The generation question is thereby closed: at resume, matching hash → zero transport; mismatching hash → the on-disk bytes are corrupt or a superseded in-flight replacement (never a durable new document, because a durable rename is always preceded by its own checkpoint) → refetch; absent bytes → fetch, at most one request, only for a never-durable document; present bytes with no entry (defensive) → self-heal from disk, zero transport. A crash in ANY window — after checkpoint before rename (first write or replacement), or after rename — produces either one legitimate fetch of a non-durable document or zero transport; a duplicate SEC request for durably archived bytes is impossible by ordering (F2, rounds 2–4).
- New `finalize_inst_ingest(conn) -> FinalizeReport` runs `link_inst_amendments`+`mark_affiliated_coverage`+`inst_pair_invariant_errors`+`compute_coverage` **once**.

**Coordinator `run_bulk_ingest` (R5/R6/R14/R17).** One shared `SecClient` over a `CountingTransport`; load+validate the ingest journal against `universe_sha256`. For each universe CIK in rank order, call `run_inst13f_ingest(ciks=[cik], accessions=<lineage>, report_period=…, run_passes=False, resume=True, client, raw_root)` and build a **total per-accession outcome map** from the returned report — every target accession classified `parsed`/`partial`/`failed(kind)`/`absent` (in `targets − observed`)/`period_mismatch`. **Locked completeness rule:** disposition = `loaded` **iff** every target accession is `parsed`/`partial`; else `failed(kind=partial_lineage|<dominant>)` with the partial counts persisted. Plus `already-done` (journal skip), `circuit_open` (breaker → STOP; unreached → `pending`), `ingest_error:<type>` (unexpected exception, persisted, continue). After each CIK the journal (per-accession map + metrics: attempts/retries/304s/cache-hits/elapsed/breaker-events/sessions) is written via `atomic_write_bytes`. After the loop (unless circuit-stopped) `finalize_inst_ingest` runs once. Reconcile `Σ dispositions == |universe|`; set `ok`; `format_bulk_summary` prints reconciliation + metrics.

**Acceptance chain (R7/R8/R15).** `scripts/accept_m2_6.py`: one `SecClient` over `_FakeSecTransport` (committed `form.idx` + crafted trees→URLs); seed CUSIP→`security_id` bindings (definitional-coverage double); discover→rank→select→drive→finalize→measure→`run_build`/`run_publish` (`LocalDirBackend`) → assert `inst ∈ manifest.modules`; **install** via `SnapshotClient(LocalRepoFetcher(repo), module="inst").refresh()`; `build_server(inst_from_published_manifest=True)` → assert `inst_health` provenance `published-snapshot` + a `filer_snapshot`/`filer_registry_stats` query returns corpus data with the snapshot `build_id`; plus a resume sub-proof. `run_acceptance(out=print)`→0/1.

## Locked Decisions

1. **Index endpoint = `form.idx`** for the filing quarter; token-based parse; `master.idx` recorded as fallback.
2. **N = 1,000** for this first run — below the ≤1,500 filer-page budget.
3. **Request arithmetic (report period 2026-06-30 / filing quarter 2026q3; D ≈ 6,000 base + ~300 amendments):** discovery **1** req; ranking cover sweep ≈ **6,300 × 0.5 s ≈ 53 min**; ingest top-N ≈ per filer `submissions.json`(1) + per target accession {index+cover+table}(3), full lineage avg ~1.2 filings ⇒ ~4.6 req/filer ⇒ N=1,000 ≈ **≈4,600 × 0.5 ≈ 38 min** (upper bound; cache-first reuse of covers archived during ranking reduces it). **Total ≈ 90 min** (≈110 min at N=1,500) plus slack — inside an overnight window; resumability makes multi-session safe.
4. **Coordinator drives the extended seam; global passes deferred to one finalize.**
5. **Ranking value = `v_default` stage-1 survivor sum** (RESTATEMENT supersedes by `filed_date`→`amendment_no`→`accession`; NEW_HOLDINGS + base union), USD-converted, **agreement-tested against the view**; **ingestion targets = complete period lineage** (base + every amendment). Affiliation stage-2 dedup not applied at ranking (accepted selection over-count, brief §4).
6. **Per-document cache-first resume, checkpoint-before-bytes always**: the expected-hash checkpoint commits before the byte rename on first write and replacement alike, so a durable document can never mismatch on resume; mismatch ⇒ corrupt/superseded non-durable bytes ⇒ refetch; absent ⇒ fetch; zero transport for every durable document; missing-entry self-heal kept as a defensive path.
7. **Two journals with distinct bindings** via `atomic_write_bytes`: rank journal ↔ `refs_sha256` (discovered refs + ranking params, available at sweep time); ingest journal ↔ `universe_sha256` (finalized universe). Both validate version/binding/duplicates; separate mismatch tests.
8. **`accept-m2-6` fully hermetic, never skips, reaches install→serve.**
9. **Hermetic gate-pass via seeded `security_identifiers`** (documented double).

## Alternatives Considered

- **Wrap `run_inst13f_ingest` per-CIK, M2-2 untouched** — rejected (unbounded by quarter; O(N) global passes). Replaced by the default-inert seam extension.
- **Base-only, latest-filed, or reimplemented merge for ranking** — rejected: base-only/latest-filed misprice restatements/NEW_HOLDINGS; a fork violates F1. Replaced by the view-matched survivor sum + agreement test (Locked Decision 5).
- **Ingest only the "winning" filings** — rejected: drops the base and orphans restatements (`amendment_unlinked`, :855). Ingestion targets are the complete lineage.
- **Accession-directory-level resume** — rejected (permits in-flight refetch and refetches `submissions.json`). Replaced by per-document checkpoints (Locked Decision 6).
- **Single journal bound to the universe** — rejected: the universe doesn't exist during the ranking sweep (circular). Two journals with distinct bindings (Locked Decision 7).
- **`master.idx`** — kept as the `form.idx` fallback.
- **Crafted PDF 13(f) list for the gate** — heavy; `_seed_cusip` double suffices.

## Planned Files

- `src/populus/ingest/inst13f.py` — EDIT (backward-compatible): `accessions`/`report_period`/`run_passes`/`resume` params; per-document incremental hash-checkpoint + cache-first read on the live source; export `finalize_inst_ingest`.
- `src/populus/inst_bulk.py` — NEW: discovery, ranking (survivor-matched value + lineage targets), coordinator, `CountingTransport`, two journal-envelope helpers.
- `scripts/accept_m2_6.py` — NEW: hermetic discover→…→serve acceptance.
- `src/populus/cli.py` — EDIT: `inst-bulk` group (`discover`, `ingest`).
- `Makefile` — EDIT: `accept-m2-6` target + `.PHONY`.
- `tests/test_inst_bulk.py` — NEW: parser; ranking **agreement tests** (six amendment cases) + USD; universe write/load; **two-journal** negative tests (corrupt/unknown-version/duplicate + `refs_sha256` and `universe_sha256` mismatch); disposition state-table incl. per-accession `absent`/`period_mismatch`/`partial_lineage`; breaker STOP + `pending`; cardinality benchmark; metrics counting; fake-transport end-to-end.
- `tests/test_inst13f_seam.py` — NEW (or extend `tests/test_inst_ingest.py`): allowlist + report-period assertion; `run_passes=False`+`finalize` equals default all-in-one; **per-document cache-first no-refetch at five interruption boundaries (incl. the corruption-replacement crash)** (submissions durable / some accession docs durable / first-write crash between checkpoint and rename / replacement crash after the new-bytes rename from a mismatching checkpoint / all docs durable + filing committed) asserting zero transport for every durable doc.
- `tests/test_accept_m2_6.py` — NEW: importlib wrapper (`run_acceptance==0`, measured figures, inst admission, `inst_health` provenance, aggregate corpus data).
- `tests/fixtures/inst/bulk/full-index/2026/QTR3/form.idx` — NEW: crafted 13F-HR filers (distinct effective values; a restatement filer, a NEW_HOLDINGS-before-restatement filer, a NEW_HOLDINGS-after-restatement filer, ≥1 beyond top-N, ≥1 non-13F row), header + dashed rule.
- `tests/fixtures/inst/bulk/expected/` — NEW (optional goldens).
- Reused as-is: `src/populus/views.sql` (agreement-test oracle); crafted filer trees under `tests/fixtures/inst/crafted/`.

*(Docs — STATUS.md/DEV-NOTES — belong to the downstream docs-commit phase.)*

## Implementation Tasks

1. **[R1/R2/R12] Discovery** — `_form_index_url`, `parse_form_index` (header-skip + token invariant + strict regexes), `discover_universe`.
2. **[R3/R2/R4/R17] Ranking + universe** — report-period cover filter; survivor-set value matching views.sql:65–70; USD conversion; complete-lineage target sets; rank journal bound to `refs_sha256`; `write_universe`/`load_universe` with `universe_sha256`.
3. **[R13/R16/R2] Seam extension** — `accessions`/`report_period`/`run_passes`/`resume`; period assertion; **per-document incremental hash-checkpoint** write + cache-first read on `_LiveSource`; `finalize_inst_ingest`. Prove defaults inert.
4. **[R5/R6/R14/R17] Coordinator** — `run_bulk_ingest`: shared `SecClient`+`CountingTransport`; ingest-journal validate vs `universe_sha256`; **total per-accession outcome map** + locked completeness rule; deferred finalize; metrics; reconciliation; `format_bulk_summary`.
5. **[R1/R5/R11/R12] CLI** — `inst-bulk discover`/`ingest` (live SecClient as `cli.py:298`; UA warning; exit nonzero on `not ok`).
6. **[R7/R8/R15] Acceptance script** — full chain incl. install→serve + resume sub-proof.
7. **[R8/R10] Makefile** — `accept-m2-6: sync` → `uv run python scripts/accept_m2_6.py`; `.PHONY`; header comment.
8. **[R9/R16] Tests + fixtures** — `form.idx` fixture; the suite above incl. six agreement cases, five interruption boundaries (incl. the corruption-replacement crash), two-journal mismatch, and the pass-count-independent-of-N benchmark.
9. **[R11] Runbook** — corrected operational sequence into Rollout only.
10. **[R10] Reconcile + verify** — `make test`/`make security`/`make accept-m2-6`; mutation-verify each branch; reconcile Changed Files vs `git status`; state deviations.

## Testing Strategy

- **Hermetic, socket-free** (`tests/conftest.py:14`); live paths via `_FakeSecTransport` behind a real `SecClient` with injected clocks.
- **Discovery/parse:** header-skip; 13F-HR/…A kept, non-13F dropped, malformed → counted `rejected`; correct `(cik,accession)`.
- **Ranking agreement (F1/R3):** six cases — base-only, NEW_HOLDINGS-only, restatement, NEW_HOLDINGS-**before** restatement (superseded → excluded from value), NEW_HOLDINGS-**after** restatement (survives → included), mixed — each asserting the pre-ingest effective value **equals** Σ `table_value_total_usd` over `v_default_inst_filings` after ingesting the full lineage; plus a pre-/post-2023 pair for `unit_basis_for`; wrong-`period_of_report` cover dropped; `select_top_n` cut matches the fixture beyond N.
- **Lineage targets (F1):** ingesting only the survivor without the base reproduces `amendment_unlinked`; ingesting the full lineage does not — proving the target set is complete.
- **Seam extension:** allowlist restricts loads; a wrong-`period_of_report` target → `period_mismatch`, not loaded; `run_passes=False`+`finalize_inst_ingest` yields byte-identical coverage/flags to the default call.
- **Per-document no-refetch resume (F2/R13):** five boundaries — (a) after `submissions.json` checkpoint+bytes durable, (b) after some accession docs durable, (c) **first-write crash after the checkpoint entry, before the byte rename** — resume performs exactly ONE fetch for that never-durable document and zero transport for all durable ones, (d) **replacement crash: start from a corrupt document (mismatching checkpoint), refetch, new checkpoint committed, new bytes renamed, crash before any further metadata action** — resume reads the replaced document from disk with **zero transport**, (e) after all docs durable + filing committed — plus dedicated absent-bytes-fetch, corrupt-at-rest-refetch, and defensive missing-entry-self-heal tests; in every case row counts equal a single clean run.
- **Disposition totality (F3/R6):** per-accession map covers every target; `absent` (target missing from submissions) and `period_mismatch` classified; `loaded` only when the whole lineage succeeds; a base-loaded-but-amendment-failed filer → `failed(partial_lineage)` with partial counts; reconciliation `Σ==|universe|` on full and breaker-stopped partial runs.
- **Two-journal binding (F4/R17):** rank-journal load rejects a `refs_sha256` mismatch / corrupt / unknown-version / duplicate; ingest-journal load rejects a `universe_sha256` mismatch / corrupt / duplicate — each a separate negative test.
- **Metrics (F5):** `CountingTransport` counts attempts incl. retries and 304s separately from `SecClient.cache_hits`; cumulative across a resume.
- **Coverage/admission + serving (F6):** gate passes; `inst` admitted; install via `SnapshotClient`; `inst_health` provenance `published-snapshot`; aggregate query returns corpus data with the snapshot `build_id`.
- **Benchmark (F8):** representative-cardinality synthetic corpus; assert finalize invokes each global pass exactly once regardless of N; record elapsed.
- **Mutation checks:** drop report-period filter → agreement test fails; wrong survivor ordering → NEW_HOLDINGS-before/after cases fail; omit base from targets → `amendment_unlinked` test fails; write order inverted (bytes renamed before checkpoint commit) → replacement boundary (d) fails on its zero-transport assertion; mismatch treated as reusable → corrupt-at-rest test fails; `loaded` on partial lineage → totality test fails; wrong journal binding → mismatch test fails; passes per-CIK → benchmark fails.

## Verification Matrix

| Req / Finding | Verified by |
|---|---|
| R1/R12 | fake transport records the form.idx URL; `inst_bulk.py` imports no HTTP lib; `make security` |
| R2 / F1 targets | complete-lineage target set; `amendment_unlinked` presence/absence test |
| R3 / F1 | six agreement tests vs `v_default`; USD pair; wrong-period drop |
| R4 | Locked Decision 3 arithmetic; N=1,000 constant |
| R5/R6 / F3 | per-accession outcome map tests; `absent`/`period_mismatch`/`partial_lineage`; reconciliation full + partial |
| R7 | coverage ≥0.95 + `inst ∈ manifest.modules`; `build.py`/coverage/views.sql unedited (diff) |
| R8 | `make accept-m2-6` exits 0; `test_accept_m2_6` green |
| R9/R10 | tests under autouse guard; `make test` no-regression (exact before/after); `make security`; Changed Files == `git status` |
| R11 / F4-runbook/F6 | Rollout seeds list (`--list13f-start-quarter`) + seeded-count assertion; drives install→serve |
| R13 / F2 | three-boundary per-document zero-transport tests incl. `submissions.json` |
| R14 / F5 | `CountingTransport` counts; cumulative across resume |
| R15 / F6 | `inst_health` provenance `published-snapshot`; aggregate corpus data + snapshot build_id |
| R16 / F8 | seam equivalence; global-pass-once benchmark |
| R17 / F4 | two separate journal-binding mismatch tests; `atomic_write_bytes` reused |

## Rollout / Rollback

**Ship (Dev/QA):** merge the seam extension + coordinator + hermetic acceptance only. Gates: `make test` (no regression), `make security`, `make accept-m2-6`. No network touched.

**Operational overnight run (post-merge runbook — not this phase), report period 2026-06-30:**
1. `export POPULUS_CONTACT=johnbaekk@gmail.com`.
2. `populus inst-bulk discover --filing-quarter 2026q3 --report-period 2026-06-30 --out ops/m2-6 --top-n 1000` → `universe-2026-06-30.json` + rank journal (~53 min; resumable, bound to `refs_sha256`).
3. **Seed identity coverage first (F4/R11):** `populus identity bootstrap --db populus.db --from-cache data-cache/inst/registry --list13f-cache data-cache/13flist --list13f-start-quarter 2026q2` (report quarter derived from the universe). **Assert seeded-quarter count > 0** before ingest (a fresh DB otherwise seeds zero quarters, `list13f.py:459`).
4. `populus inst-bulk ingest --db populus.db --universe ops/m2-6/universe-2026-06-30.json --raw-root data-cache/inst/raw --out ops/m2-6` → resumable, per-document cache-first ingest of the complete target lineage (~38 min). Re-run to resume after any breaker STOP once the request shape is diagnosed; the journal records measured attempts/retries/304s/elapsed/breaker events.
5. `populus build --db populus.db --data-repo ../populus-data` → gate passes → `inst` admitted; `populus publish …`.
6. **Install → serve:** refresh installs the published snapshot; confirm `inst_health` provenance `published-snapshot` and one aggregate query returns corpus data.
7. Record measured figures (filers ranked/selected/loaded, holdings, per-period coverage, publish result, breaker events, wall-clock, request counts) in the dev notes — measured, never asserted.

**Rollback:** additive and idempotent. Journals + universe are external state (never published). Stop a misbehaving run — the journal is the resume point; drop it to restart clean. Below-threshold coverage auto-withholds `inst` (`build.py:1708`); a bad publish reverts via §13.5 `publish --rollback-to`. Code rollback = revert the single feature commit; the seam extension is default-inert so reverting cannot break M2-2.

## Simplicity Audit

- **One ingest path, parameterized** — the coordinator drives the extended M2-2 seam (the chain the federated plane already reuses); no divergent state machine, no forked amendment logic — the ranking value is *validated against the view*, not a second implementation.
- Default-inert extension keeps M2-2 behavior and tests unchanged.
- Reuses `atomic_write_bytes`, the coverage/build/publish/serve chain, and existing test doubles; no new dependency, no second HTTP client, no config seam.
- Global post-passes run once (structural). Two small journals, each bound to source-truth available at write time.
- Deliberately not built: page-budget enforcement (P3), a discovery cache-source mode, a bespoke durability primitive, affiliation dedup at ranking (accepted approximation).

## Tech Debt Introduced

- **TD-M2-6-3 — `form.idx` token parse** (robust for the fields used; `master.idx` fallback) — accepted with strict parser tests.
- **TD-M2-6-4 — single-filing-quarter bound** — late amendments filed in a later filing quarter are outside this run's index; a documented, counted limitation (they simply aren't in the universe), revisited by a follow-on run.
- **TD-M2-6-5 — affiliation over-count at ranking** — stage-2 affiliation dedup is not applied when selecting top-N (brief §4); the *published* corpus is still correct because `v_default` applies it after ingest. Bounded and declared.
- **Retired by this revision:** former TD-1 (per-CIK global passes → deferral seam), TD-2 (cross-process refetch → per-document cache-first). No undeclared debt: durability reuses `atomic_write_bytes`; ranking is agreement-tested against the view; both journals are validated.

## Memory Touch-Points

- Consistent with [[populus-project]] and [[john-baek-profile]] (verified-primary-source, measured figures, decision records).
- Applies [[specify-before-rewriting]] — three review rounds converged the design onto a specified, view-anchored ingest-seam extension before any code.
- The reviewer's source-truth memory drove anchoring the ranking rule to `v_default_inst_filings` with an agreement test rather than a parallel implementation.
- **New memory to write after this run** (project): "M2-6 = default-inert extension of the M2-2 ingest seam (accession allowlist + report-period assertion + per-document hash-checkpointed cache-first resume + deferred finalize); ranking value = `v_default` stage-1 survivor sum, agreement-tested against the view; ingestion targets = complete period lineage; coordinator with total per-accession outcome map; two journals bound to `refs_sha256`/`universe_sha256`; runs through install→serve; operation is post-merge." Deferred to the docs/QA phase.

## Failure-Mode Sweep

- **Malformed index line / non-13F noise** → counted `rejected`, sweep continues.
- **Cover with wrong `period_of_report`** → dropped from ranking; if targeted, `period_mismatch` at load — never silently loaded.
- **Restatement / NEW_HOLDINGS before-or-after / mixed** → survivor-set value matches `v_default` (agreement-tested); full lineage ingested so no `amendment_unlinked`.
- **Cover parse error / missing total** → `rank_failed`; filer excluded; sweep never aborts.
- **Crash after submissions / after some docs / after all docs + commit** → per-document cache-first re-reads durable docs (zero transport), refetches only unverified docs, no double-load.
- **Breaker trip** → `circuit_open`, STOP; unreached `pending`; resume skips `done`.
- **Target absent from submissions / one composing amendment fails** → `absent`/`failed` in the per-accession map; filer → `failed(partial_lineage)` with counts, never a false `loaded`.
- **Generic ingest exception** → `ingest_error:<type>`, persisted, continue.
- **Rank journal vs changed refs / ingest journal vs changed universe / corrupt / duplicate / unknown version** → load rejects with a clear error; wrong CIKs never silently skipped.
- **Fresh DB seeded with zero list quarters** → runbook `--list13f-start-quarter` + seeded-count assertion.
- **Publish-to-serving handoff broken** → acceptance install→serve + `inst_health` provenance assertion catches it.
- **Coverage below 0.95** → `inst` auto-withheld; congress still publishes.
- **Hidden socket** → autouse guard raises.
- **Scope drift / baseline mismatch** → Changed Files reconciliation; Dev re-measures the test count before/after.

## Definition of Done

- [ ] **R1/R2/R12/F1-targets** discovery via `SecClient` only; quarter-bounded to `(filing_quarter, report_period)`; universe carries the complete period lineage; period asserted at load; `amendment_unlinked` avoided (test).
- [ ] **R3/F1** ranking value = `v_default` stage-1 survivor sum, agreement-tested against the view across six amendment cases; no forked merge.
- [ ] **R4** truthful arithmetic; N=1,000 fits budget + overnight.
- [ ] **R5/R6/F3** total per-accession outcome map; `loaded` only under the locked completeness rule; `absent`/`period_mismatch`/`partial_lineage` classified; reconciliation on full and partial runs.
- [ ] **R13/F2** per-document hash-checkpointed cache-first resume incl. `submissions.json`; zero transport for durable documents at three boundaries; no double-load.
- [ ] **R14/F5** measured attempts/retries/304s + wall-clock, per-session and cumulative across resume.
- [ ] **R16/F8** `run_passes=False`+`finalize` equals default; global passes run once regardless of N (benchmarked).
- [ ] **R17/F4** two versioned journals bound to `refs_sha256` / `universe_sha256` via `atomic_write_bytes`; corrupt/unknown/duplicate/mismatch rejected (separate tests).
- [ ] **R7/R15/F6** gate passes → `inst` admitted → snapshot installed → `inst_health` `published-snapshot` → aggregate query returns corpus data with the snapshot build_id.
- [ ] **R8** `make accept-m2-6` exits 0 on committed fixtures; never skips.
- [ ] **R9/R10** all new tests hermetic; `make test` no-regression (exact before/after reported); `make security` clean; Changed Files == `git status`; deviations stated.
- [ ] **R11/F4** runbook seeds identity coverage with `--list13f-start-quarter` + seeded-count assertion; no live fetching in Dev/QA.
- [ ] Existing M2-2 tests pass unchanged (seam extension default-inert).

---
