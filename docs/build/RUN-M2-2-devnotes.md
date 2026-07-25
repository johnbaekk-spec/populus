## Detected Stack

Python 3.12, `uv`, hatchling, SQLite/JSON1, Click, `httpx`, `lxml`, pytest. Canonical gates: `uv run pytest -q`, `scripts/dep_guard.py`, `make check`.

## Requirement and Task Completion

All R1–R19 implemented (dev ran to completion; suite green — see Tests Run). Built on RUN M2-1 (identity registries + `SecClient`, merged on `main`) and M1 substrate — imported, not reimplemented.

- **R1 — discover/fetch.** `ingest/inst13f.py`: submissions → 13F-HR/HR-A/NT/NT-A accessions → index.json (info-table filename discovered, never hardcoded) → cover + info-table via the RUN-M2-1 `SecClient`; `--from-cache data-cache/inst`; raw archived; per-CIK `submissions-meta.json` + per-accession `fetch-meta.json` sidecars (sha256 + retrieved_at). Injectable transport; no network in tests. Done.
- **R2 — cover parse.** `parse/inst13f.py` `parse_cover` (namespaces stripped; MM-DD-YYYY→ISO; amendment_type/no; confidential flags; otherManagers; strict, raises `CoverParseError`). Done.
- **R3 — info-table parse.** Each `<infoTable>`→raw row (NFC), putCall absent on equities, voting Sole/Shared/None; row count reconciles to `table_entry_total` (G3); never silently dropped. Done.
- **R4 — unit_basis.** Keyed on filed date (2023-01-03 cutover), not report period; `value_usd` in whole dollars; Σ cross-checked against `table_value_total × multiplier`; crafted pre-2023 fixture proves ×1000. Done.
- **R5 — typed amendments.** RESTATEMENT supersedes; NEW HOLDINGS merges; `amends` lineage resolves to the unique base for `(cik, period)`; 0/many ⇒ NULL + flag; default set via the `v_default_inst_filings` view. Done.
- **R6 — confidential treatment.** `isConfidentialOmitted`/`confDeniedExpired` captured as filing facts; disclosing amendment routed through NEW-HOLDINGS merge. Done.
- **R7 — affiliated/otherManager de-dup.** Over the restatement-selected candidate set; canonical file-number equality; mutual coverage excludes+flags both. Done.
- **R8 — default-population views.** `v_default_inst_filings` (restatement-survivor minus affiliated-covered) + `v_default_holdings` in `views.sql`, mirroring the `v_default_transactions` idiom. Done.
- **R9 — identity resolution (G14).** `resolve_cusip(as_of=period_of_report)`; unmapped ⇒ `issuer_name_raw` + `missing_security` flag; never reads `entity_id` as a dated substitute. Done.
- **R10 — schema + provenance + atomic load.** `inst.sql` (`inst_filers`/`inst_filings`/`inst_holdings`), full §5.1 provenance columns; atomic per-filing load reusing `canonical.assign_identity`. Done.
- **R11 — golden fixtures.** Real Berkshire 2026-Q1 + 2025-Q4 + the real 2025-Q1 NEW-HOLDINGS base+amendment merge pair (info table `43981.xml`), plus crafted deterministic fixtures (thousands, options/putCall, multi-restatement lineage, affiliated pair, 13F-NT, confidential pair, failed zero-row, malformed cover, malformed-row never-drop); `<key>.expected.json` each. Done.
- **R12 — CLI.** `populus ingest inst-13f` (`--db/--from-cache/--raw-root/--cik`), applies schema+views, prints reconciliation summary, non-zero only on a genuinely failed run. Done.
- **R13 — tests + gates.** `test_inst_{parse,normalize,ingest}.py` + the F5 `test_identity.py` edit; whole-repo green. Done.
- **R14 — guardrails.** G3/G4/G5/G10/G14/G6 as specified; structural caveat ships as a non-removable module constant. Done.
- **R15 — determinism.** Injected `ingested_at`/`now` + committed sidecars ⇒ byte-identical rebuilds; RFC-8785 raw_row; no wall-clock in library code. Done.
- **R16 — coverage inputs (never inflated).** Persist `table_value_total_usd`/`resolved_value_usd`/`resolved_rows`; denominator over `v_default_inst_filings`, numerator over `v_default_holdings` with non-null `security_id`; NULL total ⇒ not certifiable (`cover_failed_count>0`). Done.
- **R17 — gate assignment recorded.** `docs/build/RUN-M2-3-brief.md` updated with the ≥95% coverage gate + cover-failed certifiability + LD-8 semantics + §15 prerequisite. Done.
- **R18 — failed-cover persisted outcome (G3).** Malformed/missing-field cover ⇒ `parse_status='failed'`, `failure_kind`, 0 holdings, `cover_failed` flag, NULL total, meta from the validated submissions index; run continues. Done.
- **R19 — submissions-meta sidecar.** Per-CIK `submissions-meta.json` (retrieved_at/source_url/response_hash); cache reads it for `inst_filers` provenance + R18 dates; missing ⇒ NULL + `submissions_meta_missing` (never wall-clock). Done.

## Changed Files

New: `src/populus/ingest/inst13f.py`, `src/populus/parse/inst13f.py`, `src/populus/normalize_inst.py`, `src/populus/inst.sql`, `tests/test_inst_parse.py`, `tests/test_inst_normalize.py`, `tests/test_inst_ingest.py`, `tests/fixtures/inst/{real,crafted,expected}/` + `tests/fixtures/inst/README.md`.
Modified: `src/populus/cli.py` (wire `ingest inst-13f`), `src/populus/db.py` (apply `inst.sql`/views), `src/populus/identity/registry.py` (F5-related), `src/populus/load.py` (inst atomic load), `src/populus/views.sql` (`v_default_inst_filings`/`v_default_holdings`), `tests/test_identity.py` (F5), `tests/fixtures/README.md`, `docs/build/RUN-M2-3-brief.md` (R17 gate assignment).

## Reuse / Duplication Check

Reused: RUN-M2-1 `SecClient` (fetch) + `resolve_cusip` (identity); `canonical.assign_identity`/RFC-8785; the M1 `load.py` atomic-per-filing idiom; the `v_default_transactions` view idiom for `v_default_*`; the `ingest/senate.py` injected-`now`/`run_id`/`host` pattern. No re-implementation of M2-1/M1 substrate.

## Simplicity Audit

One authoritative default-population predicate (`v_default_inst_filings`), not a second lifecycle mutation. Pure parsers (`parse_cover`/info-table) separate from ingest (which owns the failed-cover outcome). Proportionate to the 13F contract; no speculative abstraction.

## Tech Debt Introduced

The approved plan's declaration, carried verbatim. Owner: John Baek.

- **TD-M2-2-1 — a `securities.yaml` split touching a stored CUSIP fails the reconcile loudly (FK → rollback).** LD-3; unreachable in v1. *Removal:* teach the split branch to re-resolve inst rows as-of `period_of_report` or NULL + flag them.
- **TD-M2-2-2 — cache-mode discovery is cache-bounded (LD-6).** *Removal:* an M2-3 completeness check or `--require-complete-cache`.
- **TD-M2-2-3 — `filings.files[]` older shards counted but not read.** *Removal:* shard pagination.
- **TD-M2-2-4 — affiliated de-dup is filing-level, not position-level.** *Removal:* a position-level overlap study against a real affiliated pair.
- **TD-M2-2-5 — `inst_filers.entity_id` populated only when a CIK already exists in `entities`.** *Removal:* seed `entities` from `submissions.json` filer metadata later.

**Not debt:** the ≥95% coverage-gate assignment is a specified, owner-ratified hand-off to M2-3 (LD-8/R17) — this run computes and persists the never-inflated inputs; M2-3 executes the gate at publish.

**Carried, not introduced:** TD-M2-1-2, TD-M2-1-7 (bounded here by `--cik`), TD-M2-1-8, TD-M2-1-9.

## Memory Touch-Points

Consulted the mandatory failure-mode catalog, both Populus project memories (verified-primary-source bar; the M2-1 QA-grind lesson), and global memories on explicit executable contracts, canonical gates, never-drop reconciliation, and as-of identity. They drove the never-drop failed-cover outcome (R18), the never-inflated coverage inputs (R16), and per-observation as-of resolution (R9).

## Failure-Mode Sweep

No live network in any test (injectable transport). Never-drop: every index row + info-table row + cover-parse failure ends in exactly one accounted status (G3). Both dates on every holdings row (G4); unit_basis + era label travel with every value (G5); quarter-end-snapshot caveat non-removable (G10); as-of identity only, unmapped surfaces by name + flag (G14); coverage never inflated (NULL total ⇒ fail-closed). Deterministic rebuild (injected clock + committed sidecars). dep_guard denylist clean (G1).

## Tests Run

`uv run pytest -q` → 1247 passed (1157 M2-1 baseline + 61 M2-2 dev tests + 29 post-dev QA-fix regression tests across four review rounds), independently verified; all M1 + M2-1 tests unchanged. `scripts/dep_guard.py` → exit 0. No live network in the hermetic suite. Cache-mode ingest of the real cached Berkshire filings reconciles rows vs `table_entry_total`, Σ`value_usd` vs `table_value_total`, unit_basis, amendment linkage, and coverage %.

### V-A acceptance transcript (R12/R13/R16 — real `data-cache/inst`, QA-F8)

`db init` → `identity bootstrap --from-cache data-cache/inst/registry --ftd cnsfails202606b.zip --as-of 2026-06-01` → `ingest inst-13f --from-cache data-cache/inst`, all exit 0:

- **identity bootstrap (real FTD archive):** 69,961 observations → 13,706 anchors / 13,706 securities (all provisional), 6,877 links stamped, 0 conflicted, 0 disputed.
- **ingest: 4 real filings, 314 holdings, 0 failures, `uncached 40`** (cache-bounded discovery, TD-M2-2-2):

| accession | form | period | filed | unit_basis | rows vs entry_total | Σvalue_usd vs cover total | delta |
|---|---|---|---|---|---|---|---|
| 0001193125-26-226661 | 13F-HR | 2026-03-31 | 2026-05-15 | whole | 90 vs 90 | 263,095,703,570 vs 263,095,703,570 | **0** |
| 0001193125-26-054580 | 13F-HR | 2025-12-31 | 2026-02-17 | whole | 110 vs 110 | 274,160,086,701 vs 274,160,086,701 | **0** |
| 0000950123-25-008361 | 13F-HR/A (NEW_HOLDINGS) | 2025-03-31 | 2025-08-14 | whole | 4 vs 4 | 1,106,550,356 vs 1,106,550,356 | **0** |
| 0000950123-25-005701 | 13F-HR | 2025-03-31 | 2025-05-15 | whole | 110 vs 110 | 258,701,144,516 vs 258,701,144,516 | **0** |

Amendment linkage: `amendments 1 (linked 1, unlinked 0)`; `cover_failed_count 0`; `certifiable(measurable) yes`.

**Coverage measured, and a quantified finding.** With only the June-2026 FTD archive, coverage was `0 / 797,063,485,143 = 0.00%` — correct fail-closed behaviour, not a defect: FTD intervals spanned 2026-06-15→07-01 while the report periods are 2025-03-31/2025-12-31/2026-03-31, so `resolve_cusip(as_of=period)` has no applicable interval (G14, no identity time-travel). Adding a **period-covering** archive (`cnsfails202603b`) proved the mechanism end-to-end: coverage rose to **130,126,938,539 / 797,063,485,143 = 16.33%**, and for the 2026-03-31 period alone **42/90 rows (46.7%) / 49.46% by value**. Diagnostic on that period: **29/29 of its distinct CUSIPs are present in the FTD registry, but only 15 are valid as-of 2026-03-31** — because FTD records a CUSIP only on dates it actually failed to deliver.

**Consequence for M2-3 (owner decision, flagged):** the M2-CONTRACT §8 **≥95%-by-value gate is not reachable from the FTD bootstrap alone** at any number of archives — the as-of intervals are inherently sparse (TD-M2-1-1, now quantified at ~50% by value per period). M2-3, which executes the gate, will fail closed until either (a) an identifier-history source with real validity intervals is admitted via §15, (b) an explicitly-labelled, confidence-carrying inference layer is added (G5), or (c) the gate's basis/threshold is revisited. RUN M2-2's own obligation — compute and persist **never-inflated** inputs — is met.

## Plan Deviations

The dev completed all R1–R19 as approved. A QA-only external review then surfaced nine findings; **all nine are addressed** on this branch (regression tests noted, each mutation-checked where it guards a transaction):

- **QA-F1 (fixed + tests):** a missing/non-numeric `tableValueTotal` on a HOLDINGS report is now `cover_missing_field` (→ cover-failed, NULL total), and `filing_reconciliation` keeps an unknown total NULL instead of coercing it to 0 — the coverage denominator can no longer shrink silently. A `13F-NT` notice legitimately has no totals (asserted).
- **QA-F2 (fixed + tests):** an ABSENT required info-table field is a defect, not "optional absence" — missing `sshPrnamt`, missing all `votingAuthority` values, and missing `titleOfClass`/`sshPrnamtType` now flag (`ssh_unparsed`/`voting_unparsed`/`row_incomplete`) and force the filing to `partial`; `putCall`/`otherManager` stay legitimately optional.
- **QA-F3 (fixed + test):** the remote accession is validated against the canonical dashed SEC form BEFORE any cache path or SEC URL is derived; traversal/separator/wrong-length/non-string values are counted discovery rejects. Test injects `../../etc/passwd` et al. and asserts no filesystem escape and no aborted run.
- **QA-F4 (fixed + test):** `raw_row` is NFC-only, never trimmed (`_raw_text`), so archived text and the canonical fingerprint match source and rows differing only in whitespace stay distinguishable; trimming moved to the normalization-facing `InfoTableRow` accessors (`_trim`).
- **QA-F5 (fixed + test):** affiliation-derived flags are cleared then recomputed from the current restatement-survivor set, so a filing whose coverer stopped surviving no longer keeps a stale `affiliated_*` flag and an incremental run converges with a clean rebuild.
- **QA-F6 (fixed + tests):** `certifiable` now means MEASURABLE (nonzero denominator, no unknown totals); the ≥95% decision is reported separately as `meets_threshold` (+ `COVERAGE_THRESHOLD`), so a measurable 94% is no longer mislabelled non-certifiable.
- **QA-F7 (fixed + test):** a mid-load failure-injection test drives the production `upsert_inst_filing` path (raising between the holdings DELETE and the COMMIT) and asserts the prior filing and holdings are byte-identical. **Mutation-verified:** disabling the inst rollback makes it fail.
- **QA-F8 (done):** the V-A cache-mode acceptance was executed against the real `data-cache/inst` and its full transcript + measurements are recorded above (including the quantified coverage finding).
Round 5 — the single remaining finding addressed (mutation-verified):

- **R5-F1 (test strengthened):** the reviewer confirmed the implementation already uses the correct FILING-LEVEL denominator, but `test_failed_zero_row_filing_drags_coverage_down` only proved view membership. It now invokes `compute_coverage` and asserts the behaviour: the known-total zero-row failed filing contributes **exactly 5,000,000,000** to the denominator, the numerator is unchanged, coverage strictly decreases, and `coverage == numerator / filing-level denominator`. **Mutation-verified against the exact regression the reviewer named** — deriving the denominator from `v_default_holdings` instead of `v_default_inst_filings` makes it fail.

Round 4 — both findings addressed:

- **R4-F1 (fixed):** no test opens a literal SEC information-table filename any more — fixture reads go through a `_table_bytes` helper that resolves the name via `discover_info_table_name(index.json)`, and the live-path fake-transport test derives the name the same way (R1: the filename is variable per accession and is never hardcoded anywhere operational). The only remaining literals are the discovery test's own expected values.
- **R4-F2 (fixed + test, mutation-verified):** an EMPTY component inside a non-empty `otherManager` value (`1,,3`) now also flags `other_manager_unparsed` — completing the round-3 never-silently-drop fix, which had still skipped empties.

Round 3 — all three findings addressed (both behavioural fixes mutation-verified):

- **R3-F1 (fixed):** the notice-vs-cover-failed correction is now propagated into `docs/build/RUN-M2-3-brief.md` so M2-3 cannot reintroduce it — the gate contract now states that cover-failure is keyed on the `cover_failed` FLAG (never on "total IS NULL", which a valid `13F-NT` legitimately has), keeps `certifiable` (measurable) separate from `meets_threshold`, requires an M2-3 notice-only regression test, and records the measured finding that FTD alone cannot reach ≥95 % (raise with the owner at M2-3 entry).
- **R3-F2 (fixed + test, mutation-verified):** the cover period must be a REAL calendar date, not merely `MM-DD-YYYY`-shaped — an impossible date (`02-30-2026`, `13-01-2026`) now yields a failed-cover outcome instead of being persisted as `period_of_report` and used as the as-of identity key.
- **R3-F3 (fixed + test, mutation-verified):** a non-numeric `otherManager` component now flags `other_manager_unparsed` (a new parse-defect flag) and forces `partial`, instead of being silently discarded while the row reported as fully parsed.

Round 2 — all eight further findings addressed (each behavioural fix mutation-verified):

- **R2-F1/F2 (fixed + tests):** a missing `investmentDiscretion` now flags `row_incomplete`, and EACH `votingAuthority` member (Sole/Shared/None) is individually required — one missing value flags `voting_unparsed`.
- **R2-F3 (fixed + test, mutation-verified):** `cover_failed_count` now counts only filings that actually failed their cover (keyed on the `cover_failed` flag). A valid totals-free `13F-NT` is a genuine ZERO contribution, so a lone notice no longer makes coverage non-certifiable and can no longer block M2-3's publish.
- **R2-F4 (fixed + test, mutation-verified):** `amendment_unlinked` is dropped when lineage later finds a base (new `_drop_flag` helper, which also backs the affiliation clear), so an amendment-first/base-later sequence converges with a clean rebuild. The test drives `link_inst_amendments` directly — a full re-ingest rewrites flags from source and would have masked a missing clear.
- **R2-F5 (fixed + test):** discovery now requires REAL canonical ISO dates (`_is_iso_date`); a malformed remote `filingDate`/`reportDate` is a counted discovery reject instead of aborting the run downstream in `date.fromisoformat` or persisting an invalid temporal key.
- **R2-F6 (test strengthened):** the two-build determinism comparison now includes ordered `inst_filers` rows, so nondeterministic filer provenance can no longer pass the R15 gate.
- **R2-F7 (test strengthened):** the malformed-accession test now asserts the EXACT rejected set and count (and unchanged `index_rows`), so removing reject accounting cannot leave it green.
- **R2-F8 (nit, fixed):** the affiliation docstring no longer claims an enclosing ingest transaction (the connection is autocommit); it states the pass is idempotent and derived from persisted state.

- **QA-F9 (fixed):** the Tech Debt section now carries the approved plan's TD-M2-2-1..5 verbatim, keeps LD-8 as a ratified downstream assignment (not debt), and lists the carried M2-1 items. (Process note: the orchestrated run FATAL'd after DEV on the dev-notes-v1 artifact — the doer's final message was a stray line, not the notes — so this record was reconstructed from the approved plan + the committed code, and the run is being finished via QA-only + owner's pragmatic bar; identical recovery to M2-1.)

## Model Provenance

Doer: `claude-opus-4-8` at effort xhigh (orchestrate global override, quality profile). Plan reviewer: `gpt-5.6-sol` xhigh (APPROVED round 5).
