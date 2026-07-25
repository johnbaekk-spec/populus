All stale references are cleaned up. The single blocker (F8) is resolved. Here is the complete, updated plan.

---

# RUN M2-2 — 13F ingest, parse, normalize, golden fixtures (`plan-v1`)

## Goal and Success Criteria

**Context.** Populus M2 (institutional 13F) needs the data layer that turns SEC EDGAR 13F filings into queryable, honest holdings rows. RUN M2-1 (merged, `481f30b`) already shipped the substrate this run consumes and must not reimplement: the §5.4 temporal identity registries with fail-closed as-of resolution (`src/populus/identity/registry.py:856` `resolve_cusip`), the §11.4 conservative SEC client (`src/populus/net/sec_client.py:263` `SecClient`), and the `sec-edgar` / `sec-ftd` §15 register entries (`src/populus/licenses.json:49`). M1 shipped the load/identity substrate (`src/populus/load.py`, `src/populus/canonical.py`) and the ingest idioms (`src/populus/ingest/senate.py`). Today there is **no 13F code at all**: no inst tables, no cover or info-table parser, no `populus ingest inst-13f`. Downstream RUN M2-3 (aggregates + publish, the coverage-gate enforcement point) and M2-4 (MCP tools + `inst_health`) both block on this run's `v_default_holdings`/`v_default_inst_filings` and inst tables (`docs/build/RUN-M2-3-brief.md:7`).

**Goal.** Ship the 13F ingest → parse → normalize → atomic-load path end to end, with the four behaviors ARCHITECTURE.md §10.2 names — era-dependent `unit_basis`, typed amendments, confidential-treatment routing, affiliated-filer de-dup — proven by a committed golden corpus of real cached Berkshire filings plus small deterministic crafted fixtures, and compute the exact, never-inflated value-coverage inputs the M2 ≥95 % identity gate consumes at M2-3 publish time.

**Success criteria**

1. `make test` green over the whole repository — every new inst test plus all 1157 existing M1 + M2-1 tests unchanged and passing (including the updated `SECURITY_ID_REFERENCING_TABLES` guard, F5) — and `make security` clean (both under the frozen lockfile).
2. `populus ingest inst-13f --from-cache data-cache/inst --db /tmp/i.db` (after `db init` + `identity bootstrap`) ingests the cached Berkshire filings, exits 0, and prints a reconciliation summary carrying: rows vs `table_entry_total`, Σ `value_usd` vs `table_value_total`, `unit_basis` per filing, amendment handling, affiliated coverage, cover-failed count, and value-coverage %.
3. No test touches the network; the autouse socket guard in `tests/conftest.py:14` stays effective for every new test.
4. The info-table XML filename is **discovered from `index.json` in every mode** (cache and live); no filename is hardcoded anywhere in source or tests.
5. An existing M2-1-era database gains the inst tables **and** both inst views on first M2 use, proven by an upgrade test.
6. Coverage % is computed over an authoritative **filing-level** default population, so a parse-failed zero-row filing with a known reported total drags coverage **down**; a cover-parse-failed filing (reported value unknown) is surfaced and blocks certification, never silently dropped from the denominator.

## Requirements

Stable IDs, traced through Implementation Tasks, Verification Matrix, and Definition of Done.

- **R1 — Discover and fetch.** For a CIK: `submissions/CIK<10>.json` → `13F-HR`/`13F-HR/A` (plus `13F-NT`/`13F-NT/A`) accessions → `Archives/edgar/data/<cik>/<accn_nodash>/index.json` → **discover the information-table XML filename from the index** (variable/numeric, e.g. `53405.xml`, `50240.xml`, `43981.xml` — never hardcoded) → fetch `primary_doc.xml` + the info table through the RUN-M2-1 `SecClient`. `--from-cache data-cache/inst` reads the same layout offline. Archive raw bytes; record sha256 hashes and `retrieved_at` for `submissions.json` in a **per-CIK `submissions-meta.json`** sidecar (R19) and for the index/cover/info-table in a **per-accession `fetch-meta.json`** sidecar. Transport injectable; **no live network in any test**.
- **R2 — Cover parse.** From `primary_doc.xml` (namespaces stripped): `submission_type`, `period_of_report` (MM-DD-YYYY → ISO), `is_amendment`, `amendment_type ∈ {RESTATEMENT, NEW_HOLDINGS}`, `amendment_no`, filing-manager name, `form13f_file_number`, `report_type`, `table_entry_total`, `table_value_total`, `is_confidential_omitted`, `conf_denied_expired`, `other_included_managers_count` + `other_managers[]`, `schema_version`. The pure `parse_cover` stays strict (raises `CoverParseError`); the failed path is owned by ingest (R18).
- **R3 — Info-table parse.** Each `<infoTable>` → one raw row exactly as printed (NFC only): `nameOfIssuer, titleOfClass, cusip, value, sshPrnamt, sshPrnamtType, putCall? (absent on equities), investmentDiscretion, otherManager, votingAuthority{Sole,Shared,None}`. Emitted row count reconciles against `table_entry_total` (G3); a row is **never silently dropped** — an uninterpretable field yields a retained row with a flag and a `partial` `parse_status`.
- **R4 — Unit basis.** `unit_basis ∈ {thousands, whole}` keyed on the **filed date** with the **2023-01-03** cutover (form-version era), **not** the report period. `value_usd` computed in whole dollars. Cross-check Σ `value_usd` against `table_value_total × multiplier` and report the delta. The crafted pre-2023 fixture proves the ×1000 path.
- **R5 — Typed amendments.** `RESTATEMENT` supersedes the original in full; `NEW HOLDINGS` merges with the original. Amendment lineage (`amends`) resolves to the unique **base** filing (the non-amendment `13F-HR`/`13F-NT` for the same `(cik, period_of_report)` that predates the amendment), **independent of lifecycle**, so successive restatements and post-restatement new-holdings additions all link correctly and none is falsely flagged `amendment_unlinked`; zero or many candidate bases ⇒ NULL + flag. The default set is computed by **one authoritative rule** — the filing-level `v_default_inst_filings` view — not by a second lifecycle mutation.
- **R6 — Confidential treatment.** `isConfidentialOmitted` on a cover and `confDeniedExpired` on an amendment are captured as filing-level source facts, and the disclosing amendment is routed through the **NEW-HOLDINGS merge** path (never through supersede).
- **R7 — Affiliated-filer / `otherManager` modeling, over the restatement-selected candidate set.** `otherManagers2Info` is modeled so the same position is not double-counted across affiliated filers. Affiliation exclusion and flagging both operate on the **restatement-selected candidate set** (filings that survive restatement supersede), so a stale, restatement-superseded original can neither suppress an affiliate nor be suppressed (F6). A filing whose own normalized 13F file number is listed as an other-manager of another **surviving** filing for the period is covered and excluded. File-number equality is on the **canonical form** (differently-formatted encodings of the same number match; different numbers never conflate). Mutual coverage excludes both sides and flags both, never arbitrarily ranked.
- **R8 — Default-population views.** `v_default_inst_filings` (filing-level, built as a restatement-survivor CTE minus affiliated-covered-by-a-survivor) is the **single authoritative predicate**; `v_default_holdings` = `inst_holdings` JOINed to it. Both live in `src/populus/views.sql`, follow the `v_default_transactions` idiom (`src/populus/views.sql:9`), so no default number counts a position twice and the coverage denominator is defined independently of holding-row existence.
- **R9 — Identity resolution (G14).** `cusip` → `resolve_cusip(conn, cusip, as_of=period_of_report)` → `security_id`; unmapped ⇒ keep `issuer_name_raw` + `missing_security` flag, never dropped and never guessed. `securities.entity_id` is never read as a substitute for a dated resolver (TD-M2-1-8).
- **R10 — Schema, per-row provenance, atomic load.** `inst_filers` / `inst_filings` / `inst_holdings` DDL, each fact row carrying the **complete applicable §5.1 provenance contract as physical columns** — `source`, `source_url`, `source_record_id`, `retrieved_at`, `response_hash`, `raw_path`, `parser_version`, `normalization_version`, `license_id`, `ingested_at` (with `retrieved_at` distinct from `ingested_at`; `vintage`/`effective_date` N/A — 13F snapshots do not revise). `inst_filers` provenance comes from the per-CIK `submissions-meta.json` sidecar (R19); filing/holding provenance from the per-accession `fetch-meta.json`. Atomic per-filing load in one transaction reusing `populus.canonical.assign_identity`.
- **R11 — Golden fixtures.** Committed corpus under `tests/fixtures/inst/` covering all four behaviors: real Berkshire 2026-Q1 `13F-HR` (whole-dollar primary), real 2025-Q4 `13F-HR`, and the **real 2025-Q1 NEW-HOLDINGS merge pair** — the original **base** `13F-HR` `0000950123-25-005701` **and** its `13F-HR/A` `NEW HOLDINGS` + `confDeniedExpired` amendment `0000950123-25-008361` (with its real info table `43981.xml`) — both round-tripping end to end so the amendment links to the base (`amends`) and both jointly populate `v_default_holdings` (a *real* merge, F8) — plus crafted deterministic fixtures for the thousands regime, options/`putCall`, a multi-restatement lineage (incl. a restatement that changes the other-manager list), an affiliated pair, a `13F-NT` notice, a confidential pair, a **failed zero-row filing with a known reported total**, a **malformed/missing-field cover**, and a malformed-row never-drop case. One `<key>.expected.json` per fixture (filing meta + full normalized rows + flags + `value_usd` + `unit_basis` + provenance); **≥2 hand-verified against source**, named in the test docstring.
- **R12 — CLI.** `populus ingest inst-13f` wired in `src/populus/cli.py` with `--db`, `--from-cache`, `--raw-root`, `--cik` (repeatable), applying `ensure_inst_schema` **and** `ensure_views` on the target database, printing the reconciliation summary, and exiting non-zero only on a genuinely failed run.
- **R13 — Test suite and gates.** `tests/test_inst_parse.py`, `tests/test_inst_normalize.py`, `tests/test_inst_ingest.py`, plus the **required edit to `tests/test_identity.py`** (F5); whole-repo gates run as `make test` and `make security` (frozen lockfile), green with every other M1 and M2-1 test unchanged.
- **R14 — Guardrails.** G3 (never drop — every index row and every info-table row ends in exactly one accounted status, **including cover-parse failures**), G4 (both dates: `period_of_report` **and** `filed_date` on every holdings row), G5 (`unit_basis` and the era label travel with every value; no unlabeled derived numbers), G10 (13F is a quarter-end snapshot of long 13(f) positions — the §5.2/M2-CONTRACT §5 structural caveat ships as a non-removable module constant), G14 (as-of identity only), G6 (politeness floors reused from `SecClient` — no new tunable).
- **R15 — Determinism.** Given the **same injected `ingested_at`/`now`** and the committed `submissions-meta.json`/`fetch-meta.json` sidecars (deterministic `retrieved_at`/hashes), two clean rebuilds of the same inputs produce **byte-identical** inst rows across **every** column. RFC-8785 canonical `raw_row`, deterministic sorted/compact JSON columns, no wall-clock read in library code (`now`/`run_id`/`host` injected by the CLI, as in `src/populus/ingest/senate.py:737`). (The M2-3 two-build gate then compares under a projection that additionally excludes `ingested_at`.)
- **R16 — Coverage inputs (feeds the M2 ≥95 % gate), never inflated.** Persist per filing `table_value_total_usd` (populated for **info-table-failed** filings from the cover; NULL for **cover-failed** filings — value unknown), `resolved_value_usd`, `resolved_rows`. Coverage is computed over the **filing-level** population: denominator = Σ `table_value_total_usd` over `v_default_inst_filings`; numerator = Σ `value_usd` over `v_default_holdings` with a non-null `security_id`. Because a NULL total would silently shrink the denominator, coverage is **not certifiable** (reported as blocked, `cover_failed_count > 0`) whenever any in-scope `v_default_inst_filings` row has `table_value_total_usd IS NULL`. Emit the %, the `cover_failed_count`, and the certifiability flag in the summary. These are the exact inputs the ≥95 % gate consumes at M2-3 publish time (LD-8).
- **R17 — Record the gate assignment in the owning downstream brief.** Update `docs/build/RUN-M2-3-brief.md` to add the ≥95 % coverage gate (plus the cover-failed certifiability rule) as an **M2-3 pre-publication requirement** executing in M2-3's `build`/`publish` path, with the LD-8 denominator/numerator/exit semantics and the §15 data-acquisition prerequisite, cross-referencing M2-CONTRACT §8. Human approval of this plan ratifies the assignment (LD-8).
- **R18 — Failed-cover persisted outcome (G3).** A malformed cover or a missing required cover field does **not** abort the run or drop the accession: ingest catches `CoverParseError`/malformed-cover XML and persists the accession with `parse_status='failed'`, `failure_kind ∈ {cover_malformed, cover_missing_field}`, 0 holdings, a `cover_failed` flag, and NULL `table_value_total_usd`, using the **validated submissions-index metadata** (`reportDate`→`period_of_report`, `filingDate`→`filed_date`, `form`→`submission_type`, submissions top-level `name`→`filing_manager_raw`, `unit_basis` from `filed_date`). Processing continues with the next filing. If the index itself lacks `reportDate`/`filingDate`, the accession is a counted discovery reject (still accounted, G3).
- **R19 — Submissions-level metadata sidecar.** A per-CIK `submissions-meta.json` records `submissions.json`'s `retrieved_at`, `source_url`, and `response_hash`; cache mode reads it to populate `inst_filers` provenance and to source `filed_date`/`period` for R18, live mode writes it, and it is committed with the fixtures. A cache missing it yields `retrieved_at=NULL` + `submissions_meta_missing` on the filer (never the wall clock, R15).

## Scope

One coherent slice: the 13F **data layer**, the failed-outcome accounting, and the written hand-off of the coverage gate to its owning run. Three new source modules (`parse/inst13f.py`, `normalize_inst.py`, `ingest/inst13f.py`), one new packaged DDL file, two new views, six surgical source/test edits, one downstream-brief edit, three new test modules, and the fixture corpus. Everything downstream of loaded rows (aggregates, publish, the ≥95 % gate *execution*, MCP tools, dashboard) is deferred to M2-3/M2-4 and listed under Non-goals.

## Non-goals

- Cross-filer aggregates, `inst_agg.db`, `build.py`/`manifest.py` generalization, the inst logical digest, two-build reproducibility gate — **RUN M2-3** (`docs/build/RUN-M2-3-brief.md`).
- The five `inst_*` MCP tools, the M2 envelope/`data_note` wiring into responses, `populus_health` inst module, golden Q&A corpus — **RUN M2-4**.
- **Executing** the ≥95 % value-coverage gate. This run *computes and persists* the exact, never-inflated gate inputs (R16) and *writes the enforcement contract into the M2-3 brief* (R17). Enforcement runs in **RUN M2-3's `build`/`publish` path** (LD-8), where publication happens — so no under-coverage or cover-failed inst snapshot can publish before the gate exists.
- Populating `src/populus/securities.yaml` (TD-M2-1-2); TD-M2-1-9 stays unreachable and carried.
- `populus reparse inst-13f` from the raw archive (the load path is idempotent; a reparse selector is a later addition).
- Cross-sectional SEC bulk 13F datasets (secondary source, M2-CONTRACT §1) and any change to the M2-1 `SecClient` internals.

## Constraints

- **Read-only on M2-1 semantics** except the two sanctioned edits LD-3 forces: the `SECURITY_ID_REFERENCING_TABLES` constant (`src/populus/identity/registry.py:72`) **and** its guard test (`tests/test_identity.py:814`, F5). `SecClient`, the registries' behavior, and every other M2-1 test are imported/unchanged.
- **`schema.sql` is frozen.** `tests/test_schema.py:113` asserts byte-identity to the §9.4 DDL block; inst DDL cannot be appended there (LD-1).
- **No new dependencies.** `lxml`, `rfc8785`, `click`, stdlib only — all in `pyproject.toml:10`.
- **No wall-clock reads in library code** (`src/populus/load.py:93`, `ingest/senate.py:15`).
- **Politeness in code, never config (G6).** All SEC access via `SecClient` (module constants, `src/populus/net/sec_client.py:59`).
- **`data-cache/` is gitignored** (`.gitignore:1`). Tests read a committed corpus under `tests/fixtures/inst/` (incl. both sidecar kinds); only the CLI acceptance run reads `data-cache/inst` (`tests/test_senate_parse.py:41` precedent).
- **Remote input reaching a URL or a filesystem path must be validated first** (`ingest/senate.py:76` + `archive_path()` containment, `ingest/__init__.py:35`).

## Current State

| Fact | Evidence |
|---|---|
| No 13F code exists | `src/populus/` has no `inst*` module; `ingest/` holds only `house.py`, `senate.py` |
| Schema has 5 M1 tables + 5 registry tables | `src/populus/schema.sql`, `src/populus/registry.sql` |
| `schema.sql` byte-identity is a live gate | `tests/test_schema.py:113-119` |
| Views are a separate idempotent file, applied by `ensure_views` | `src/populus/views.sql:1-8`, `amendments.py:22` |
| Registry DDL separate + idempotent | `src/populus/registry.sql:1-6`, `identity/registry.py:88` |
| `init_db` composes schema + views + registry | `src/populus/db.py:66-73` |
| §5.1 field list | `ARCHITECTURE.md:206-217` |
| `SECURITY_ID_REFERENCING_TABLES` is a 2-tuple + a **guard test** and an FK-completeness interlock | `identity/registry.py:72`; `tests/test_identity.py:814`; `tests/test_identity_migration.py:108-125` |
| `resolve_cusip(conn, cusip, as_of)` is fail-closed | `src/populus/identity/registry.py:856-876` |
| `SecClient(transport, *, contact, sleep, monotonic)` — transport required | `src/populus/net/sec_client.py:271-279` |
| Atomic per-filing upsert idiom | `src/populus/load.py:255-355` (`upsert_filing`) |
| Row identity from RFC-8785 `raw_row` | `src/populus/canonical.py:61-98` |
| M1 amendment default is view-only; lifecycle stays `active` until OQ-13 | `views.sql:9-17`, `ARCHITECTURE.md:548` |
| `submissions.json` carries per-accession `reportDate`/`filingDate`/`form`/`primaryDocument` + a top-level filer `name` | verified in the cached corpus |
| CLI ingest jobs are a dict + `click.Choice` | `src/populus/cli.py:32-41`, `:81` |
| Autouse no-network guard | `tests/conftest.py:14-29` |
| `sec-edgar` register entry present, ingestible | `src/populus/licenses.json:49-71` |
| Gate chain is `make test` / `make security` (frozen lockfile) | `Makefile` |
| M2-3 brief exists and is editable | `docs/build/RUN-M2-3-brief.md` |

**Cached real corpus** (`data-cache/inst/CIK0001067983/`, gitignored):

| Accession | Form | Period | Info table | Rows | `tableValueTotal` | Cached? |
|---|---|---|---|---|---|---|
| `0001193125-26-226661` | 13F-HR | 2026-03-31 | `53405.xml` (45 259 B) | 90 | 263 095 703 570 | complete |
| `0001193125-26-054580` | 13F-HR | 2025-12-31 | `50240.xml` (55 376 B) | 110 | 274 160 086 701 | complete |
| `0000950123-25-005701` | 13F-HR (the **base** for 2025-03-31) | 2025-03-31 | discovered in T0 | base `tableEntryTotal` | base cover | **fetched in T0 — R11/F8** |
| `0000950123-25-008361` | 13F-HR/A `NEW HOLDINGS`, `confDeniedExpired=true` (amends `…005701`) | 2025-03-31 | `43981.xml` (2 134 B per `index.json`) | 4 | 1 106 550 356 | **cover cached; info table fetched in T0 — R11** |

The 2025-03-31 **base** `0000950123-25-005701` and its **amendment** `0000950123-25-008361` are both listed in the submissions index (verified); the base is the original NEW-HOLDINGS merge target required to exercise a *real* merge (F8). Real docs were fetched 2026-07-24 (M2-CONTRACT §1) — the `retrieved_at` the sidecars record. `submissions.json` lists **88** 13F filings; today only the two 2026 accession dirs plus the amendment's cover are cached — T0 fetches the base filing and the two missing info tables. Neither cached 2026 info table contains `putCall` (0 occurrences), so options are crafted. Berkshire's cover file number is `028-04545`; other-manager seq 4 (Buffett) is `28-554` — **different filers** (canonical `028-4545` vs `028-554`). `schemaVersion` is `X0202` in both post-2023 covers.

## Detected Stack

- **Language/runtime:** Python ≥ 3.12 (`pyproject.toml:9`), `uv`, frozen lockfile.
- **Libraries reused:** `lxml`, `rfc8785`, `httpx` (via `SecClient`), `click`, `pyyaml`, stdlib `sqlite3`/`hashlib`/`json`/`functools`.
- **Storage:** SQLite ≥3.38 (JSON1 + row-value/CTE support), autocommit + `PRAGMA foreign_keys = ON`.
- **Tests:** `pytest` (+ `jsonschema`), golden fixtures with `<name>.expected.json` and `UPDATE_GOLDENS=1`.
- **Gates:** `make test` / `make security` / `make check`.
- **No new dependency is introduced.**

## Reuse Map

| Need | Reuse (do not reimplement) | Path |
|---|---|---|
| SEC HTTP access, rate floor, ETag cache, breaker | `SecClient`, `HttpxSecTransport`, `sec_contact`, `validate_sec_url` | `src/populus/net/sec_client.py:263,159,122,230` |
| SEC UA / hosts / encoding constants | `SEC_APP_NAME`, `SEC_HOSTS`, `ACCEPT_ENCODING`, `TransportResponse` | `src/populus/net/__init__.py:26,38,42` |
| CUSIP normalization + as-of identity | `normalize_cusip`, `resolve_cusip`, `normalize_cik`, `entity_id_for` | `src/populus/identity/registry.py:198,856,159,180` |
| Row identity | `assign_identity`, `canonical_json`, `nfc`, `row_fingerprint` | `src/populus/canonical.py:61,35,30,48` |
| Atomic per-filing upsert shape | `upsert_filing` | `src/populus/load.py:255-355` |
| Archive-path containment | `archive_path`, `UnsafeArchivePathError` | `src/populus/ingest/__init__.py:31,35` |
| Ingest-run audit + summary shape | `run_senate_ingest`/`format_summary`, `ingest_runs` | `src/populus/ingest/senate.py:737,1123`; `schema.sql:87` |
| Idempotent DDL applier idiom | `ensure_views`, `ensure_registry` | `amendments.py:22`; `identity/registry.py:88` |
| Default-view + view-only amendment default | `v_default_transactions` | `src/populus/views.sql:9-17` |
| Pair-invariant checker idiom | `pair_invariant_errors` | `src/populus/amendments.py:62` |
| Flag taxonomy shape | `PARSE_DEFECT_FLAGS`/`SOURCE_FACT_FLAGS`/`has_parse_defect` | `src/populus/normalize.py:31,45,58` |
| License register lookup | `load_register`, `ingestible_ids` (`sec-edgar` exists) | `licenses.py:39,88`; `licenses.json:49` |
| Golden-corpus test idiom | `UPDATE_GOLDENS`, per-fixture expected JSON | `tests/test_senate_parse.py` |
| No-network test guard | autouse `_no_network` | `tests/conftest.py:14` |

**Not reused, deliberately:** `normalize.py`'s M1 flag frozensets (disjoint field set — a parallel taxonomy is honest; sharing would put `side_unparsed` in a 13F path).

## Architecture

### Data flow

```
submissions.json ──► discover()   13F accessions (+ reportDate/filingDate/form + filer name)
        │  (+ submissions-meta.json sidecar: retrieved_at/url/hash — R19)
        │                 │
        │                 ▼
        │           index.json ──► discover_info_table_name()   ← R1, never hardcoded
        │                 │
        │                 ▼
        └──────► fetch/read: primary_doc.xml + <discovered>.xml   (SecClient | cache)
                          │  (+ fetch-meta.json: retrieved_at/hashes per accession)
                 parse/inst13f.py  ──► CoverPage | CoverParseError ; tuple[InfoTableRow]
                          │            (pure, no I/O)
                 ingest: evaluate_filing  ── cover ok ─► normalize_inst.py
                          │            └─ CoverParseError ─► FAILED-COVER outcome (R18, from index meta)
                          ▼
                 load.py: upsert_inst_filing()   one transaction/filing (full per-row provenance)
                          │
                 link_inst_amendments() (lineage) + mark_affiliated_coverage() (candidate-set)
                          │
                 reconcile() ──► InstIngestReport ──► format_summary() (+ coverage %, cover_failed)
                          │
                 v_default_inst_filings  (restatement CTE → affiliation)  ─┬─► v_default_holdings
                                                                           └─► coverage denominator
```

### Provenance (R10; §5.1) — complete contract on every fact row

Full applicable §5.1 field set as **physical columns** on all three tables. `retrieved_at` (SEC fetch time) is distinct from `ingested_at` (row write time). `vintage`/`effective_date` omitted (13F does not revise). Two sidecar kinds supply deterministic `retrieved_at`/hashes and are committed with the fixtures (recording 2026-07-24 for the real corpus); a missing sidecar yields `NULL` + `submissions_meta_missing`/`retrieved_at_unknown`, **never** the wall clock.

| Field | `inst_filers` (from `submissions.json` + `submissions-meta.json`) | `inst_filings` (from `fetch-meta.json`) | `inst_holdings` |
|---|---|---|---|
| `source` | `'sec-edgar'` | `'sec-edgar'` | `'sec-edgar'` |
| `source_url` | submissions.json URL | `primary_doc.xml` URL | info-table URL |
| `source_record_id` | CIK | accession | `<accession>:<row_ordinal>` |
| `retrieved_at` | **submissions-meta.json** submissions fetch time | max(index,cover,table) fetch time | info-table fetch time |
| `response_hash` | submissions.json sha256 | cover sha256 (+ `index_response_hash`, `table_response_hash`) | info-table sha256 |
| `raw_path` | archived submissions.json | archived accession dir | archived info-table path |
| `parser_version` | `inst-13f-1.0.0` | `inst-13f-1.0.0` | `inst-13f-1.0.0` |
| `normalization_version` | `inst-norm-1.0.0` | `inst-norm-1.0.0` | `inst-norm-1.0.0` |
| `license_id` | `'sec-edgar'` | `'sec-edgar'` | `'sec-edgar'` |
| `ingested_at` | injected write time | injected write time | injected write time |

Every physical provenance column is asserted populated and correct, per filer/filing/holding, in the golden and load tests (R10/V10), including `inst_filers.retrieved_at` sourced from `submissions-meta.json` (F4).

### Schema (`src/populus/inst.sql`, new packaged DDL, all `IF NOT EXISTS`)

```sql
CREATE TABLE IF NOT EXISTS inst_filers (
  cik TEXT PRIMARY KEY,                    -- 10-digit, normalize_cik
  name_raw TEXT NOT NULL,                  -- submissions top-level filer name
  form13f_file_number TEXT, file_number_norm TEXT,   -- canonical '028-4545'
  entity_id TEXT REFERENCES entities(entity_id),
  raw JSON,
  source TEXT NOT NULL CHECK (source IN ('sec-edgar')),
  source_url TEXT NOT NULL, source_record_id TEXT NOT NULL,   -- source_record_id = CIK
  retrieved_at TEXT, response_hash TEXT, raw_path TEXT,       -- from submissions-meta.json (R19)
  parser_version TEXT NOT NULL, normalization_version TEXT NOT NULL,
  license_id TEXT NOT NULL DEFAULT 'sec-edgar', ingested_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inst_filings (
  filing_id TEXT PRIMARY KEY,              -- 'inst:<dashed accession>'
  cik TEXT NOT NULL REFERENCES inst_filers(cik),
  accession TEXT NOT NULL UNIQUE,          -- source_record_id
  submission_type TEXT NOT NULL
      CHECK (submission_type IN ('13F-HR','13F-HR/A','13F-NT','13F-NT/A')),
  period_of_report DATE NOT NULL,          -- G4; from cover, or index reportDate on cover failure (R18)
  filed_date       DATE NOT NULL,          -- G4; from index filingDate; drives unit_basis
  form_version TEXT,
  unit_basis TEXT NOT NULL CHECK (unit_basis IN ('thousands','whole')),
  is_amendment INTEGER NOT NULL CHECK (is_amendment IN (0,1)),
  amendment_type TEXT CHECK (amendment_type IN ('RESTATEMENT','NEW_HOLDINGS')),
  amendment_no INTEGER,
  amends TEXT REFERENCES inst_filings(filing_id),   -- lineage only; LD-4
  is_confidential_omitted INTEGER CHECK (is_confidential_omitted IN (0,1)),
  conf_denied_expired     INTEGER CHECK (conf_denied_expired IN (0,1)),
  filing_manager_raw TEXT NOT NULL,        -- cover name, or submissions name on cover failure (R18)
  form13f_file_number TEXT, file_number_norm TEXT, report_type TEXT,
  other_managers JSON NOT NULL DEFAULT '[]'
      CHECK (json_valid(other_managers) AND json_type(other_managers) = 'array'),
  table_entry_total INTEGER, table_value_total INTEGER,
  table_value_total_usd INTEGER,           -- x multiplier; NULL only on cover failure (value unknown) — R16/R18
  row_count INTEGER, sum_value_usd INTEGER, value_total_delta INTEGER,
  resolved_rows INTEGER, resolved_value_usd INTEGER,
  parse_status TEXT NOT NULL CHECK (parse_status IN ('parsed','partial','failed')),
  failure_kind TEXT,                       -- infotable_missing|infotable_ambiguous|cover_malformed|cover_missing_field|...
  lifecycle TEXT NOT NULL DEFAULT 'active'
      CHECK (lifecycle IN ('active','superseded','retired','withdrawn')),
  flags JSON NOT NULL DEFAULT '[]'
      CHECK (json_valid(flags) AND json_type(flags) = 'array'),
  doc_url TEXT NOT NULL,
  table_url TEXT, table_filename TEXT,
  source TEXT NOT NULL CHECK (source IN ('sec-edgar')),
  source_url TEXT NOT NULL, source_record_id TEXT NOT NULL,
  retrieved_at TEXT, raw_path TEXT,
  index_response_hash TEXT, response_hash TEXT, table_response_hash TEXT,
  parser_version TEXT NOT NULL, normalization_version TEXT NOT NULL,
  license_id TEXT NOT NULL DEFAULT 'sec-edgar', ingested_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inst_holdings (
  holding_id TEXT PRIMARY KEY,             -- '<filing_id>:<fp32>[#<dup_seq>]'
  filing_id TEXT NOT NULL REFERENCES inst_filings(filing_id),
  raw_row TEXT NOT NULL
      CHECK (json_valid(raw_row) AND json_type(raw_row) = 'object'),
  row_fingerprint TEXT NOT NULL, dup_seq INTEGER NOT NULL DEFAULT 1, row_ordinal INTEGER NOT NULL,
  cik TEXT NOT NULL, accession TEXT NOT NULL,
  period_of_report DATE NOT NULL, filed_date DATE NOT NULL,   -- G4 / G14 as-of key
  security_id TEXT REFERENCES securities(security_id),        -- NULL = unmapped + flag
  cusip_raw TEXT, cusip TEXT, issuer_name_raw TEXT NOT NULL, title_of_class TEXT,
  value_raw INTEGER, unit_basis TEXT NOT NULL, value_usd INTEGER,
  ssh_prnamt INTEGER, ssh_prnamt_type TEXT,
  put_call TEXT CHECK (put_call IS NULL OR put_call IN ('PUT','CALL')),
  investment_discretion TEXT, other_manager TEXT,
  other_manager_seqs JSON NOT NULL DEFAULT '[]',
  voting_sole INTEGER, voting_shared INTEGER, voting_none INTEGER,
  flags JSON NOT NULL DEFAULT '[]'
      CHECK (json_valid(flags) AND json_type(flags) = 'array'),
  source TEXT NOT NULL CHECK (source IN ('sec-edgar')),
  source_url TEXT NOT NULL, source_record_id TEXT NOT NULL,   -- '<accession>:<row_ordinal>'
  retrieved_at TEXT, response_hash TEXT, raw_path TEXT,
  parser_version TEXT NOT NULL, normalization_version TEXT NOT NULL,
  license_id TEXT NOT NULL DEFAULT 'sec-edgar', ingested_at TEXT NOT NULL,
  UNIQUE (filing_id, row_fingerprint, dup_seq)
);
CREATE INDEX IF NOT EXISTS inst_holdings_by_filing ON inst_holdings (filing_id);
CREATE INDEX IF NOT EXISTS inst_holdings_by_security ON inst_holdings (security_id, period_of_report);
CREATE INDEX IF NOT EXISTS inst_filings_by_period ON inst_filings (period_of_report, cik);
```

`value_raw`/`value_usd`/`cusip` are nullable **on purpose** (retained row + flag, never a drop).

### Views (appended to `src/populus/views.sql`) — restatement candidate set, then affiliation

```sql
-- SINGLE authoritative default-filing predicate, filing-level (so a parse-failed
-- zero-row filing that reported a total still counts for coverage — reviewer F3).
-- Affiliation runs over the RESTATEMENT-SURVIVOR candidate set on BOTH sides, so a
-- stale, superseded original can neither suppress an affiliate nor be suppressed
-- (reviewer F6). NEW_HOLDINGS is the absence of an exclusion (original + amendment
-- both survive → their union is the merge, §10.2).
CREATE VIEW IF NOT EXISTS v_default_inst_filings AS
WITH restatement_survivors AS (
  SELECT f.*
  FROM inst_filings f
  WHERE f.lifecycle = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM inst_filings r
      WHERE r.lifecycle = 'active' AND r.amendment_type = 'RESTATEMENT'
        AND r.cik = f.cik AND r.period_of_report = f.period_of_report
        AND r.filing_id <> f.filing_id
        AND ( r.filed_date > f.filed_date
           OR (r.filed_date = f.filed_date
               AND COALESCE(r.amendment_no,0) > COALESCE(f.amendment_no,0))
           OR (r.filed_date = f.filed_date
               AND COALESCE(r.amendment_no,0) = COALESCE(f.amendment_no,0)
               AND r.accession > f.accession) )
    )
)
SELECT s.*
FROM restatement_survivors s
WHERE NOT EXISTS (                          -- affiliation, over SURVIVORS only
  SELECT 1 FROM restatement_survivors c, json_each(c.other_managers) m
  WHERE c.filing_id <> s.filing_id
    AND c.period_of_report = s.period_of_report
    AND s.file_number_norm IS NOT NULL
    AND json_extract(m.value, '$.file_number_norm') = s.file_number_norm
);

CREATE VIEW IF NOT EXISTS v_default_holdings AS
SELECT h.*
FROM inst_holdings h
JOIN v_default_inst_filings f ON f.filing_id = h.filing_id;
```

**Coverage (R16), same predicate, never inflated:**

```
denominator = SELECT COALESCE(SUM(table_value_total_usd), 0) FROM v_default_inst_filings
numerator   = SELECT COALESCE(SUM(value_usd), 0) FROM v_default_holdings WHERE security_id IS NOT NULL
cover_failed = SELECT COUNT(*) FROM v_default_inst_filings WHERE table_value_total_usd IS NULL
coverage    = numerator / denominator ;   certifiable  ⇔  cover_failed = 0 AND denominator > 0
```

An **info-table-failed** filing keeps its cover-derived `table_value_total_usd` → it adds to the denominator, 0 to the numerator, dragging coverage down (F3). A **cover-failed** filing has an unknown total (NULL) → it cannot enter the denominator honestly, so `cover_failed > 0` makes coverage **non-certifiable** (the M2-3 gate refuses to publish, LD-8) rather than silently inflating (F7). A `13F-NT` reports no positions/value and contributes nothing.

**`mark_affiliated_coverage(conn)`** stamps `affiliated_covered`/`affiliated_mutual_coverage` using the **same restatement-survivor candidate set** the view uses (F6) — never over stale superseded originals. `lifecycle` is never mutated for amendments; `amends` is lineage only, validated by `inst_pair_invariant_errors`.

### Modules

**`src/populus/parse/inst13f.py`** — pure, no I/O. `PARSER_VERSION = "inst-13f-1.0.0"`. `_HARDENED_PARSER` (entity expansion off). `_local(tag)` namespace strip. `parse_cover(xml) -> CoverPage` **stays strict** — raises `CoverParseError` on malformed XML or a missing required field (the failed path is ingest's, R18). `parse_info_table(xml)`. `normalize_file_number(raw)`: `^0*(\d{1,3})-0*(\d+)$` → `f"{int(p):03d}-{s}"` (`028-00554`==`28-554`; `028-04545`≠`28-554`). `discover_info_table_name(index_json)` (validated, ambiguity/absence handled).

**`src/populus/normalize_inst.py`** — pure. `NORMALIZATION_VERSION = "inst-norm-1.0.0"`. `unit_basis_for`, `UNIT_MULTIPLIER`, disjoint flag frozensets (+ `cover_failed`, `submissions_meta_missing`, `retrieved_at_unknown`), `inst_has_parse_defect`, `normalize_holding` (injected `resolve_security`), `filing_reconciliation` (deltas + coverage inputs; `table_value_total_usd` from the cover on info-table failure, NULL on cover failure — R16/R18/F3), `INST_DATA_NOTE`.

**`src/populus/ingest/inst13f.py`** — the only inst module touching the network. `discover` (reads/writes `submissions-meta.json`; LD-6 cache-bounding; carries per-accession index meta reportDate/filingDate/form/name for R18); `_obtain` (cache/`SecClient` + `archive_path` + sha256 + `fetch-meta.json`); `evaluate_filing` — the single status-decision point:
- cover parses ok → normalize; info-table missing ⇒ `failed`/`infotable_missing`; ambiguous ⇒ `failed`/`infotable_ambiguous`; `13F-NT`/no table ⇒ `parsed`/`notice_no_table`; row defect or `entry_total_mismatch` ⇒ `partial`; else `parsed`;
- **cover raises `CoverParseError` or is malformed XML ⇒ FAILED-COVER outcome (R18):** `parse_status='failed'`, `failure_kind ∈ {cover_malformed, cover_missing_field}`, 0 holdings, `cover_failed` flag, `table_value_total_usd=NULL`, with `period_of_report`/`filed_date`/`submission_type`/`filing_manager_raw`/`unit_basis` from the validated submissions index metadata; the loop continues.

`run_inst13f_ingest` (one `ingest_runs` row finalized on every exit path); `link_inst_amendments` (lineage only, base = unique non-amendment predating the amendment, lifecycle-independent — F2); `mark_affiliated_coverage` (restatement-survivor candidate set — F6); `inst_pair_invariant_errors`; `reconcile` + `format_summary` (coverage %, `cover_failed_count`, certifiability).

**`src/populus/load.py`** (edit) — `ensure_inst_schema`, `InstParsedRow`, `upsert_inst_filer`, `upsert_inst_filing` (one `BEGIN IMMEDIATE`; full per-row provenance; a failed-cover filing writes a row with zero holdings).

**Determinism (R15).** `raw_row` via `canonical_json`; JSON columns sorted/compact; `retrieved_at`/hashes from committed sidecars; `ingested_at`/`run_id`/`host` injected.

## Locked Decisions

- **LD-1 — Inst DDL in a new `src/populus/inst.sql`, not `schema.sql`** (byte-identity gate; `registry.sql` precedent). Owner-visible wording deviation; scope identical.
- **LD-2 — both inst views in `src/populus/views.sql`,** applied by `ensure_views`; every M2 entrypoint calls `ensure_inst_schema` before `ensure_views`.
- **LD-3 — `inst_holdings.security_id` FK to `securities`; `"inst_holdings"` added to `SECURITY_ID_REFERENCING_TABLES` (`identity/registry.py:72`) AND its guard test updated (`tests/test_identity.py:814` — F5).** The FK-completeness interlock (`tests/test_identity_migration.py:125`, set-compares the constant to PRAGMA FK tables) then passes because the FK exists and the constant lists it. TD-M2-2-1: a `securities.yaml` split touching a stored CUSIP fails the reconcile loudly (FK → rollback); unreachable in v1.
- **LD-4 — `amends` is lineage only; no `lifecycle` mutation for amendments** (view is the single authority; M1 OQ-13 posture). Validated by `inst_pair_invariant_errors`.
- **LD-5 — `unit_basis` keyed on `filed_date` vs `2023-01-03`; `form_version` audit-only.**
- **LD-6 — `--from-cache` discovery is cache-bounded** (`uncached_index_rows`); live mode fetches all.
- **LD-7 — `Σ value_usd ≠ table_value_total` reported, not fatal;** row-count mismatch forces `partial` (G3).
- **LD-8 — the ≥95 % gate is specified here, inputs produced here (R16), written into the M2-3 brief here (R17), ENFORCED in RUN M2-3's `build`/`publish` path** (M2-3 owns publication — closes the publish-before-M2-4 hole):
  - Threshold ≥95 %, unchanged (M2-CONTRACT §8).
  - Denominator = Σ `table_value_total_usd` over `v_default_inst_filings` (incl. info-table-failed filings with a known total — F3).
  - Numerator = Σ `value_usd` over `v_default_holdings` with a non-null `security_id`.
  - **Certifiability (fail-closed):** publish is **refused** when coverage < 0.95, when `denominator = 0` (no inst value → N/A, not auto-pass), **or when any in-scope default filing has `table_value_total_usd IS NULL`** (a cover-failed filing of unknown value — F7).
  - Data-acquisition prerequisite (blocking input to M2-3): admit period-covering FTD/identifier data through §15.
  Human approval of this plan ratifies the assignment; R17 records it.
- **LD-9 — the real 2025-Q1 merge pair is a hard prerequisite (T0), not substitutable:** both the base `0000950123-25-005701` (index, cover, discovered info table) **and** the amendment's info table `43981.xml` are fetched and committed, so the contractually required *real* NEW-HOLDINGS merge round-trips (F8). Offline ⇒ STOP + owner waiver. The crafted confidential pair ships in addition only, never as a stand-in.
- **LD-10 — TD-M2-1-9 not fixed here.**
- **LD-11 — `SecClient` not modified.**
- **LD-12 — cover failures never abort the run (R18).** The pure `parse_cover` stays strict; ingest catches and persists a `failed` filing from validated submissions-index metadata, then continues. This is the one explicit persisted-outcome path the reviewer's Simplicity note requires.

## Alternatives Considered

| Decision | Alternative | Why rejected |
|---|---|---|
| Fetch + commit the real base `…005701` (R11/F8) | Ship only the amendment | The amendment alone has no original → no real merge is testable; the golden suite could pass while the contractually required merge is unproven. |
| Restatement-survivor candidate set for affiliation (R7/R8/F6) | Affiliation over all `lifecycle='active'` filings | A superseded original stays `active` (no lifecycle mutation), so its stale `other_managers` could suppress an affiliate — silent undercount. |
| Ingest-owned failed-cover path from index metadata (R18/LD-12) | Let `parse_cover` return a partial object / abort | Loosening the pure parser blurs the boundary; aborting drops a discovered accession (G3 violation). |
| Per-CIK `submissions-meta.json` (R19/F4) | Reuse per-accession `fetch-meta.json` for the filer | The filer fact derives from `submissions.json`, a per-CIK document. |
| Cover-failed ⇒ non-certifiable (R16/F7) | Sum NULL totals as 0 | Silently shrinks the denominator, inflating coverage. |
| Update the guard test (F5) | Only change the constant | `tests/test_identity.py:814` hard-asserts the 2-tuple; `make test` fails deterministically without the edit. |
| Full §5.1 columns physically on every fact table (R10) | Join document provenance from the filing | Reviewer requires per-row traceability. |
| Filing-level `v_default_inst_filings` (R8/F3) | Denominator from holdings | A failed zero-row filing vanishes from the denominator. |
| Gate enforced in M2-3 (LD-8) | Enforce in M2-4 | M2-3 owns publication; M2-4 doesn't exist yet. |
| New `inst.sql` (LD-1) | Append to `schema.sql` | Breaks `tests/test_schema.py:113`. |
| `filed_date` discriminator (LD-5) | `schemaVersion` | No verified version→units map. |
| Injected `resolve_security` | Import + take a connection | Would permit a resolver call with no as-of date. |

## Planned Files

**New source**

- `src/populus/inst.sql` — inst DDL with full per-row §5.1 provenance (LD-1/R10).
- `src/populus/parse/inst13f.py` — `PARSER_VERSION = "inst-13f-1.0.0"`.
- `src/populus/normalize_inst.py` — `NORMALIZATION_VERSION = "inst-norm-1.0.0"`.
- `src/populus/ingest/inst13f.py` — discovery + sidecars, evaluate (incl. failed-cover R18), load, amendment lineage, affiliated coverage (candidate set), reconciliation, summary, `inst_pair_invariant_errors`.

**Edited source**

- `src/populus/views.sql` — `v_default_inst_filings` (restatement CTE → affiliation) + `v_default_holdings`.
- `src/populus/load.py` — `ensure_inst_schema`, `InstParsedRow`, `upsert_inst_filer`, `upsert_inst_filing`.
- `src/populus/db.py` — `init_db` calls `ensure_inst_schema` before `ensure_views`.
- `src/populus/identity/registry.py` — append `"inst_holdings"` to `SECURITY_ID_REFERENCING_TABLES` (LD-3).
- `src/populus/cli.py` — register `inst-13f` + guarded `--cik`; the branch and the `identity bootstrap` path call `ensure_inst_schema` **and** `ensure_views` (F4).

**Edited tests**

- `tests/test_identity.py` — update `test_security_id_referencing_tables_is_the_enforced_constant` to expect `("security_identifiers", "security_supersessions", "inst_holdings")` (F5); the FK-completeness interlock (`tests/test_identity_migration.py:125`) auto-follows.

**Edited docs**

- `docs/build/RUN-M2-3-brief.md` — M2-3 pre-publication ≥95 % + cover-failed certifiability gate (R17).
- `tests/fixtures/README.md` — inst corpus provenance paragraph.

**New tests**

- `tests/test_inst_parse.py`, `tests/test_inst_normalize.py`, `tests/test_inst_ingest.py`.

**New fixtures** (committed; `data-cache/` gitignored)

- `tests/fixtures/inst/README.md`.
- `tests/fixtures/inst/real/CIK0001067983/` — `submissions.json`, `submissions-meta.json` (R19), the **four** accession dirs (`…226661`/`53405.xml`, `…054580`/`50240.xml`, the 2025-Q1 **base** `…005701`/its discovered info table, and the amendment `…008361`/`43981.xml` — all real, LD-9/F8) each with a `fetch-meta.json` (`retrieved_at = 2026-07-24` + hashes).
- `tests/fixtures/inst/crafted/CIK0009000001/…` — thousands, period 2022-12-31 filed 2023-02-14.
- `…/CIK0009000009/…` — thousands, filed 2020-02-14 (pure ×1000).
- `…/CIK0009000002/…` — options/`putCall` (+ `PRN`).
- `…/CIK0009000003/…` — multi-restatement lineage **incl. a restatement that changes `other_managers`** (F6): base + RESTATEMENT#1 (drops an other-manager) + RESTATEMENT#2 + a later NEW HOLDINGS.
- `…/CIK0009000004/…` — confidential pair.
- `…/CIK0009000005/…` + `…/CIK0009000006/…` — affiliated covering/covered pair (equal-but-formatted file numbers); the covering side's coverage lives in the restatement-surviving filing.
- `…/CIK0009000007/…` — `13F-NT` notice + malformed-row `13F-HR` (never-drop).
- `…/CIK0009000008/…` — failed zero-row `13F-HR`, cover `tableValueTotal` 5 000 000 000 (F3).
- `…/CIK0009000010/…` — **cover-failed** filing: malformed `primary_doc.xml` (and a sibling with a missing required cover field), index metadata present → persisted `failed`/`cover_failed` (R18/F7).
- `tests/fixtures/inst/expected/*.expected.json` — one per fixture key (incl. provenance).

## Implementation Tasks

**T0 — Cache completion, sidecars, fixture import (R1, R10, R11, R19, F8).** Through the M2-1 client (offline ⇒ STOP + waiver, LD-9): fetch the amendment's info table `.../000095012325008361/43981.xml`, **and** fetch the 2025-Q1 **base** filing `0000950123-25-005701` in full — its `index.json`, `primary_doc.xml`, and the info table **discovered from that index** (never hardcoded, R1). Write a per-CIK `submissions-meta.json` (`retrieved_at = 2026-07-24`, URL, sha256) and a per-accession `fetch-meta.json` for each of the four real accessions. Copy the real corpus (+ both sidecar kinds) byte-identically into `tests/fixtures/inst/real/CIK0001067983/`. Author `<key>.expected.json` for the base and confirm the amendment's `amends` points at the base. Write `tests/fixtures/inst/README.md`; update `tests/fixtures/README.md`.

**T1 — Schema, views, provenance, registry constant + guard test, upgrade path (R8, R10, R13, R14, R15, R16).** Author `src/populus/inst.sql` (full per-row §5.1 provenance). Append the two views (restatement CTE → affiliation) to `src/populus/views.sql`. Add `ensure_inst_schema`; wire into `db.init_db` before `ensure_views`; append `"inst_holdings"` to `SECURITY_ID_REFERENCING_TABLES` **and update `tests/test_identity.py:814`** (F5). Ensure ingest + bootstrap CLI paths call `ensure_inst_schema` then `ensure_views` (F4). Confirm `tests/test_schema.py` and `tests/test_identity_migration.py` pass; add the M2-1-era upgrade test.

**T2 — Parsers (R1, R2, R3, R7, R14).** `parse/inst13f.py`: discovery, strict `parse_cover` (raises), `parse_info_table`, `normalize_file_number` (F3), hardened parser, error classes.

**T3 — Normalization + coverage inputs (R4, R5, R6, R9, R14, R15, R16).** `normalize_inst.py`: flags (+ cover/meta flags), `normalize_holding`, `filing_reconciliation` (`table_value_total_usd` from cover on info-table failure, NULL on cover failure; coverage inputs), `INST_DATA_NOTE`.

**T4 — Load path + per-row provenance (R10, R15, R18, R19).** `InstParsedRow`, `upsert_inst_filer` (provenance from `submissions-meta.json`), `upsert_inst_filing` (per-row provenance; failed-cover filing writes zero holdings).

**T5 — Ingest orchestration (R1, R5, R6, R7, R12, R14, R15, R16, R18, R19).** `discover` (submissions-meta + index metadata for R18; LD-6), `_obtain` (+ `fetch-meta.json`), `evaluate_filing` (single decision incl. failed-cover), `run_inst13f_ingest`, `link_inst_amendments` (F2), `mark_affiliated_coverage` (candidate set — F6), `inst_pair_invariant_errors`, `reconcile`, `format_summary` (coverage %, `cover_failed`, certifiability).

**T6 — CLI (R12).** Register `inst-13f`; guarded `--cik`; branch calls `ensure_inst_schema` + `ensure_views`, builds cache reader or `SecClient(...)`, prints summary, exits 1 only when not `ok`.

**T7 — Crafted fixtures (R4, R5, R6, R7, R11, R16, R18).** Author the crafted trees incl. the restatement-changes-`other_managers` lineage (F6), the failed zero-row filing (F3), and the cover-failed filings (R18/F7).

**T8 — Tests (R10, R11, R13, R14, R15, R16, R18, R19).** `test_inst_parse.py` (discovery; cover fields; MM-DD-YYYY; exact `raw_row`; NFC; missing→`null`; malformed XML; `028-00554`==`28-554`, `028-04545`≠`28-554` — F3; entity refusal; `parse_cover` raises on missing field/malformed XML). `test_inst_normalize.py` (cutover; multiplier; flag disjointness; `put_call`/`PRN`; `missing_security`; coverage arithmetic; `INST_DATA_NOTE`; no DB import — G14). `test_inst_ingest.py` (round-trip vs `<key>.expected.json` asserting **every physical provenance column incl. `inst_filers.retrieved_at` from `submissions-meta.json`** — F1/F4; live-mode fake transport, exact URL sequence, no hardcoded filename; idempotence; multi-restatement lineage no false unlinked — F2; views all four behaviours on counts and `SUM(value_usd)`; **affiliation uses the restatement-survivor set — a restatement that drops an other-manager no longer suppresses the affiliate** — F6; failed zero-row filing in the denominator drags coverage down — F3; **cover-failed filing persisted `failed`/`cover_failed`, run continues, coverage non-certifiable** — F7/R18; submissions-meta cache-read vs missing → `submissions_meta_missing` — R19; mutual-coverage symmetry; never-drop; byte-identical determinism under fixed `ingested_at` — F7-prior; M2-1-era upgrade — F4-prior; **the real 2025-Q1 base + amendment: the amendment `amends` the base, and both jointly populate `v_default_holdings` for 2025-03-31 — a real NEW-HOLDINGS merge** — F8; CLI via `CliRunner`; summary content). `tests/test_identity.py` guard updated (F5). Hand-verified goldens named in the docstring: (a) real 2026-Q1 ALLY row $39.23/share; (b) the real 2025-Q1 merge pair — base `…005701` + amendment `…008361` (`NEW HOLDINGS`, `confDeniedExpired=true`, `tableEntryTotal 4`, `tableValueTotal 1 106 550 356`) — both in the default view.

**T9 — Downstream brief + gates + acceptance (R13, R12, R16, R17).** Edit `docs/build/RUN-M2-3-brief.md` (R17/LD-8). Run and record `make test` + `make security`. Then the V-A acceptance sequence.

## Testing Strategy

- **Unit, pure.** No DB/IO. R1 proven negatively (renamed table still found); F3 file-number equal + distinct; `parse_cover` raises on malformed/missing-field covers.
- **Golden round-trip.** Every fixture key ingested into `tmp_path`; filing + rows + **all physical provenance columns** (incl. `inst_filers.retrieved_at` from `submissions-meta.json`) vs `.expected.json`. `UPDATE_GOLDENS=1` regenerates.
- **Provenance (F1/F4).** Asserted per filer/filing/holding, `retrieved_at`≠`ingested_at`; the filer timestamp comes from the committed submissions sidecar; a missing sidecar → NULL + `submissions_meta_missing`.
- **Real merge (F8).** The 2025-Q1 base and amendment both round-trip; a test asserts the amendment `amends` the base and that both populate `v_default_holdings` for 2025-03-31, on membership and `SUM(value_usd)`.
- **Affiliation candidate set (F6).** A restatement that removes an other-manager: the pre-restatement original no longer suppresses the affiliate; only the surviving restatement's `other_managers` count. Asserted on membership, counts, and `SUM(value_usd)`.
- **Failed-cover (F7/R18).** Malformed cover XML and a missing-required-field cover each persist a `failed`/`cover_failed` filing built from index metadata, the run continues to the next filing, and coverage is reported non-certifiable (`cover_failed_count > 0`).
- **Coverage (F3).** Failed zero-row filing (known total) is in the denominator, 0 in the numerator, lowers coverage.
- **Guard/interlock (F5).** The updated `tests/test_identity.py` guard expects the 3-tuple; the migration FK-completeness interlock passes because `inst_holdings` now has the FK and is listed.
- **Live path without a network.** `FakeSecTransport` serves fixture bytes by URL; exact URL sequence asserted; autouse socket guard blocks escape.
- **Views / lineage / determinism / upgrade / never-drop** — as before (counts + `SUM(value_usd)`; base-linked amendments; byte-identical under fixed `ingested_at`; M2-1-era upgrade; malformed row retained with `partial`).
- **Regression protection.** Only `tests/test_identity.py`'s guard is edited (F5); every other existing test is unchanged.

## Verification Matrix

| ID | Requirement | Verification | Evidence |
|---|---|---|---|
| V1 | **R1** | Cover/index/table fetched both modes; renamed-table resolves; ambiguous/absent handled; regex rejection; `archive_path` containment; sha256 + `retrieved_at` recorded (both sidecar kinds) | `tests/test_inst_parse.py`, `tests/test_inst_ingest.py` |
| V2 | **R2** | Every cover field on real covers; MM-DD-YYYY→ISO; `NEW HOLDINGS`→`NEW_HOLDINGS`; both `otherManagers` shapes; `parse_cover` raises on missing field/malformed XML | `tests/test_inst_parse.py` |
| V3 | **R3** | 90/110/4 rows; exact `raw_row`; missing `putCall`→`null`; NFC; `entry_total_mismatch`→`partial`; malformed row retained | `tests/test_inst_parse.py`, `tests/test_inst_ingest.py` |
| V4 | **R4** | Cutover 2023-01-02/03; Q4-2022-filed-2023→`whole`; pre-2023 ×1000; real `whole`; `value_total_delta` | `tests/test_inst_normalize.py`, `tests/test_inst_ingest.py` |
| V5 | **R5** | Multi-restatement: each `amends` the base, no false `amendment_unlinked`, no lifecycle mutation; view keeps only the latest restatement | `tests/test_inst_ingest.py` |
| V6 | **R6** | Confidential facts captured; the **real** 2025-Q1 pair round-trips — amendment `…008361` `amends` base `…005701`, both appear in `v_default_holdings` for 2025-03-31 (real NEW-HOLDINGS merge, F8), asserted on membership + `SUM(value_usd)` | `tests/test_inst_ingest.py` |
| V7 | **R7** | `028-00554`==`28-554`, `028-04545`≠`28-554`; **affiliation over the restatement-survivor set — a restatement that drops an other-manager no longer suppresses the affiliate**; covered excluded+flagged; mutual coverage both | `tests/test_inst_parse.py`, `tests/test_inst_ingest.py` |
| V8 | **R8** | Both views exist after `db init` **and** upgrade; behaviours assert counts and `SUM(value_usd)` | `tests/test_inst_ingest.py`, `tests/test_schema.py` (unchanged) |
| V9 | **R9** | Unmapped CUSIP → `NULL`+`missing_security`+name; covering interval resolves, non-covering does not (G14) | `tests/test_inst_normalize.py`, `tests/test_inst_ingest.py` |
| V10 | **R10** | Every §5.1 physical column populated/correct on filer/filing/holding, `retrieved_at`≠`ingested_at`, **filer `retrieved_at` from `submissions-meta.json`**; `holding_id` matches `assign_identity`; re-ingest replaces; mid-load rollback | `tests/test_inst_ingest.py` |
| V11 | **R11** | Every fixture round-trips; the real 2025-Q1 **base `…005701` and amendment `…008361`** both round-trip; two hand-verified fixtures explicit + named | `tests/test_inst_ingest.py` |
| V12 | **R12** | CLI exits 0 on fresh **and** M2-1-era DB; summary carries rows/Σ/`unit_basis`/amendments/affiliated/cover-failed/coverage % | `tests/test_inst_ingest.py` |
| V13 | **R13** | `make test` green whole-repo incl. the **updated `test_security_id_referencing_tables_is_the_enforced_constant`** (F5); `make security` exit 0 | `make test`, `make security`, `tests/test_identity.py` |
| V14 | **R14** | G3 one-bucket accounting **incl. cover failures**; G4 both dates per holding; G5 `unit_basis`/`PRN`; G10 `INST_DATA_NOTE`; G14 no DB import; G6 no new knob | `tests/test_inst_normalize.py`, `tests/test_inst_ingest.py` |
| V15 | **R15** | Two fresh DBs, same injected `ingested_at` → byte-identical; double ingest → identical `holding_id` sets | `tests/test_inst_ingest.py` |
| V16 | **R16** | Denominator over `v_default_inst_filings` (failed zero-row filing lowers it); cover-failed ⇒ `cover_failed_count>0` and non-certifiable; numerator = resolved `value_usd`; printed | `tests/test_inst_normalize.py`, `tests/test_inst_ingest.py` |
| V17 | **R17** | `docs/build/RUN-M2-3-brief.md` carries the M2-3 pre-publication ≥95 % + cover-failed certifiability gate with LD-8 semantics + data-acquisition prerequisite | reviewer inspection of the committed brief edit |
| V18 | **R18** | Malformed cover + missing-required-field cover each persist `failed`/`cover_failed` from index metadata; run continues; `table_value_total_usd` NULL | `tests/test_inst_ingest.py` |
| V19 | **R19** | `submissions-meta.json` read in cache mode → filer `retrieved_at`/URL/hash; missing → `submissions_meta_missing` + NULL (never wall clock) | `tests/test_inst_ingest.py` |
| V-A | **R12**, **R13**, **R16** acceptance (manual) | `db init` → `identity bootstrap … --ftd cnsfails202606b.zip --as-of 2026-06-01` → `ingest inst-13f --from-cache data-cache/inst` → exit 0, **4 real filings** (2026-Q1, 2025-Q4, 2025-Q1 base, 2025-Q1 amendment), 90+110+`<base_rows>`+4 holdings, `unit_basis whole`, the 2025-Q1 amendment `amends` the base and both are in `v_default_holdings`, coverage % + cover-failed printed | Dev Notes |

## Rollout / Rollback

**Rollout.** Purely additive: `ensure_inst_schema` (`CREATE … IF NOT EXISTS`) + both views (`CREATE VIEW IF NOT EXISTS`) via `ensure_views`, called (after `ensure_inst_schema`) by every M2 entrypoint, so an existing M1/M2-1 DB gains tables + views on first M2 use with no M1 table touched (the `ensure_registry` upgrade pattern; F4 test). The only reach beyond inst is LD-3's constant + its guard test. No migration script, no publish-path change here (M2-3 owns that + the gate). The nightly publish workflow is unarmed.

**Sequence.** T0 → T1 → T2/T3 → T4 → T5 → T6 → T7 → T8 → T9. T1 first so the registry constant, guard test, FK interlock, and upgrade path are green before any inst code depends on them.

**Rollback.** Revert the branch (source, the guard-test edit, the M2-3 brief edit). Orphan `inst_*` tables/views are harmless; `DROP VIEW v_default_holdings; DROP VIEW v_default_inst_filings; DROP TABLE inst_holdings; DROP TABLE inst_filings; DROP TABLE inst_filers;` removes them. Reverting LD-3's constant + guard restores M2-1 exactly.

**Risk if partially landed.** Nothing consumes inst data yet — an incomplete run degrades to "empty tables".

## Simplicity Audit

- **One filing-level authority, built in two clear stages** (restatement-survivor CTE, then affiliation over survivors). The holdings view and the coverage denominator derive from it, and affiliation can no longer be poisoned by a stale superseded original (F6) — a correctness fix, not new machinery.
- **One explicit failed-cover path** (R18/LD-12): the pure parser stays strict; ingest owns the persisted `failed` outcome from index metadata and continues — the reviewer's requested single outcome path, no parser loosening.
- **Three new modules, one DDL file, two views, surgical edits** (five source, one guard test, one brief). Repo shape one-for-one.
- **No new dependency/abstraction/framework;** `ingest/inst13f.py` mirrors `ingest/senate.py`.
- **Provenance is a flat physical column set;** the only new artifacts are the two sidecar kinds that make `retrieved_at` real and deterministic.
- **Deliberate duplication, once** (`inst_has_parse_defect`).
- **`normalize_inst.py` takes a callable, not a connection** (G14 structural).
- **Cut:** `reparse inst-13f`, filer-name fuzzy matching, `securities.yaml` authoring, gate execution.

## Tech Debt Introduced

- **TD-M2-2-1 — a `securities.yaml` split touching a stored CUSIP fails the reconcile loudly (FK → rollback).** LD-3; unreachable in v1. *Removal:* teach the split branch to re-resolve inst rows as-of `period_of_report` or NULL + flag them.
- **TD-M2-2-2 — cache-mode discovery is cache-bounded (LD-6).** *Removal:* an M2-3 completeness check or `--require-complete-cache`.
- **TD-M2-2-3 — `filings.files[]` older shards counted but not read.** *Removal:* shard pagination.
- **TD-M2-2-4 — affiliated de-dup is filing-level, not position-level.** *Removal:* a position-level overlap study against a real affiliated pair.
- **TD-M2-2-5 — `inst_filers.entity_id` populated only when a CIK already exists in `entities`.** *Removal:* seed `entities` from `submissions.json` filer metadata later.

**Resolved, NOT accepted as debt** (reviewer's Tech Debt note): the submissions retrieval metadata (F4 — `submissions-meta.json` sidecar + `inst_filers` provenance columns, asserted), the stale affiliated-coverer behavior (F6 — restatement-survivor candidate set on both sides, tested), the unaccounted cover-parse failure (F7/R18 — persisted `failed`/`cover_failed` path from index metadata, tested), and the missing real amendment base (F8 — the real base `…005701` is fetched, committed, and its merge with the amendment is tested). The coverage-gate assignment is a specified, owner-ratified hand-off (LD-8/R17), not debt.

**Carried, not introduced:** TD-M2-1-2, TD-M2-1-7 (bounded here by `--cik`), TD-M2-1-8, TD-M2-1-9.

## Memory Touch-Points

- Consulted `populus-project` and `john-baek-profile`; both consistent; neither needs an edit.
- Nothing here belongs in memory (schema/module layout/decisions live in the repo).
- One candidate **after** merge (project memory, only if the owner wants it tracked outside the repo): the M2 ≥95 % coverage gate executes at M2-3 publish, is fail-closed on cover-failed filings, and is blocked on period-covering FTD/identifier data (LD-8) — recorded here and (via R17) in the M2-3 brief.

## Failure-Mode Sweep

| # | Failure mode | Handling |
|---|---|---|
| F1 | Info-table filename hardcoded | Discovered from `index.json`; renamed-fixture test |
| F2 | Two candidate XML files | `InfoTableAmbiguousError` → `failed`/`infotable_ambiguous` |
| F3 | `13F-NT` notice has no table | `parsed`, 0 rows, `notice_no_table` |
| F4 | Remote filename/accession reaches a URL/path | Regex-validated + `archive_path()` containment |
| F5 | XXE/entity expansion | Hardened `lxml` parser; entity-bearing test |
| F6 | Pre-2023 normalized as whole dollars | `unit_basis` from `filed_date`; boundary + ×1000 fixture |
| F7 | Q4-2022 filed 2023 misclassified | Discriminator is `filed_date` (LD-5) |
| F8 | Row silently dropped | Nullable value/cusip + flags; count reconciled; malformed fixture (G3) |
| F9 | Restatement double-counted | Filing view rule; counts + `SUM(value_usd)` |
| F10 | New-holdings treated as supersede | `amendment_type`; view union is the merge |
| F11 | Position double-counted across affiliates, or a **stale superseded original suppresses an affiliate** | Affiliation over the **restatement-survivor candidate set** on both sides; restatement-changes-other-managers fixture (reviewer F6) |
| F12 | Mutual affiliated coverage drops/double-counts | Symmetric exclusion + `affiliated_mutual_coverage`, over survivors |
| F13 | Later restatements/new-holdings falsely `amendment_unlinked` | `amends` = base, lifecycle-independent (prior F2) |
| F14 | File numbers conflated / equal ones split | Canonical `normalize_file_number` (prior F3) |
| F15 | CUSIP resolved outside its window (G14) | `resolve_cusip(as_of=period)`; non-covering test |
| F16 | Unmapped CUSIP dropped/guessed | Retained + `missing_security` |
| F17 | Registry promotion orphans `inst_holdings.security_id` | LD-3 registers the table + guard test; split fails loudly |
| F18 | `schema.sql` byte-identity broken | Inst DDL in `inst.sql` (LD-1) |
| F19 | Existing DB never gains the views | `ensure_views` on every M2 entrypoint; upgrade test (prior F4) |
| F20 | A fact row cannot be independently traced | Complete §5.1 physical columns, `retrieved_at`≠`ingested_at`, per row (prior F1) |
| F21 | A test reaches the network | Autouse `_no_network`; `SecClient` requires a transport |
| F22 | Live run trips SEC's WAF | All access via `SecClient` (G6) |
| F23 | Partial write leaves mismatched rows | One `BEGIN IMMEDIATE`; rollback test |
| F24 | Two rebuilds diverge | Byte-identical under fixed `ingested_at` + committed sidecars (prior F7) |
| F25 | Amendment linked to the wrong base | Exactly one non-amendment base predating it, else NULL + flag |
| F26 | 85 uncached accessions reported as failures | LD-6 + `uncached_index_rows` |
| F27 | `Σ value_usd ≠ table_value_total` fails acceptance | LD-7: reported/flagged, never fatal |
| F28 | Coverage gate vanishes / M2-3 publishes under-coverage or unknown-value | LD-8: inputs here (R16), gate WRITTEN into the M2-3 brief (R17), ENFORCED fail-closed at M2-3 incl. cover-failed (prior F2/F6, F7) |
| F29 | Coverage inflated by dropping a failed filing | Denominator = filing-level `v_default_inst_filings` (prior F3) |
| F30 | Real amendment fixture faked | LD-9: real 2025-Q1 merge pair (base + amendment tables) is a hard prerequisite; offline ⇒ STOP + waiver (prior F5) |
| F31 | Local env drift passes tests | `make test`/`make security` (frozen lockfile) (prior F8) |
| F32 | `retrieved_at` from the wall clock | From committed sidecars; absent ⇒ NULL + flag (R10/R15/R19) |
| F33 | `identity bootstrap` on a pre-inst DB hits `no such table: inst_holdings` | Bootstrap path calls `ensure_inst_schema` + `ensure_views` (T1) |
| F34 | **`SECURITY_ID_REFERENCING_TABLES` guard test fails after adding `inst_holdings`** | The guard test is updated in the same task as the constant, and the FK-completeness interlock validates the pair (reviewer F5) |
| F35 | **Cover-parse failure aborts the run or drops the accession** | Ingest catches `CoverParseError`/malformed XML → persisted `failed`/`cover_failed` from validated index metadata, continues (reviewer F7/R18) |
| F36 | **`inst_filers.retrieved_at` has no source in cache mode** | Per-CIK `submissions-meta.json` sidecar; missing ⇒ NULL + `submissions_meta_missing` (reviewer F4/R19) |
| F37 | **No real NEW-HOLDINGS merge is testable (amendment has no original)** | The real base `0000950123-25-005701` is fetched + committed (T0/LD-9); a test asserts the amendment `amends` it and both populate `v_default_holdings` (reviewer F8) |

## Definition of Done

- **R1** — cover + info table fetched both modes; filename discovered from `index.json` (renamed test); raw bytes archived with sha256 + `retrieved_at` in both sidecar kinds; injectable transport; zero network in tests.
- **R2** — every cover field parsed/asserted on real covers, both `otherManagers` shapes, MM-DD-YYYY → ISO; `parse_cover` raises on malformed/missing-field covers.
- **R3** — 90/110/4 rows with exact `raw_row`; counts reconcile; malformed fixture never-drops with `partial`.
- **R4** — `unit_basis` from `filed_date` at 2023-01-03 (boundary tested); ×1000 and Q4-2022-filed-2023 fixtures; `value_total_delta` recorded.
- **R5** — restatement supersede + new-holdings merge proved; multi-restatement lineage links every amendment to the base, no false `amendment_unlinked`, no lifecycle mutation.
- **R6** — confidential facts captured; the **real** 2025-Q1 merge round-trips — amendment `…008361` `amends` base `…005701` and both populate `v_default_holdings` for 2025-03-31 — plus the crafted confidential pair.
- **R7** — normalizer equates equal encodings, keeps distinct numbers distinct; **affiliation runs over the restatement-survivor candidate set** so a stale superseded original never suppresses an affiliate; mutual coverage symmetric+flagged.
- **R8** — both views exist after `db init` **and** upgrade, encoding all three behaviours as the single filing-level authority (restatement CTE → affiliation), asserted on counts and `SUM(value_usd)`.
- **R9** — every CUSIP resolved as-of `period_of_report`; unmapped retained with `missing_security`.
- **R10** — three inst tables with the complete §5.1 provenance as physical columns, every field populated/asserted per filer/filing/holding, `retrieved_at`≠`ingested_at`, **filer `retrieved_at` from `submissions-meta.json`**; identity from `assign_identity`; atomic idempotent load.
- **R11** — fixture corpus committed with one `.expected.json` per key (incl. provenance); all round-trip, including the **real 2025-Q1 base `…005701` and amendment `…008361`** merge pair; two hand-verified fixtures explicit + named.
- **R12** — `populus ingest inst-13f --from-cache data-cache/inst --db /tmp/i.db` exits 0 after `db init` + `identity bootstrap` on fresh **and** M2-1-era DBs, printing rows-vs-`table_entry_total`, Σ vs total, `unit_basis`, amendment handling, affiliated coverage, cover-failed count, and coverage %.
- **R13** — `make test` green whole-repo with the **updated `tests/test_identity.py` guard** and every other M1/M2-1 test unchanged; `make security` exit 0.
- **R14** — G3 (incl. cover failures), G4, G5, G6, G10, G14 each have a named passing assertion.
- **R15** — two fresh DBs with the same injected `ingested_at` are byte-identical across every column; double ingest yields an identical `holding_id` set.
- **R16** — `table_value_total_usd` (info-table-failed from cover; NULL on cover failure), `resolved_value_usd`, `resolved_rows` persisted; coverage computed over `v_default_inst_filings`/`v_default_holdings`, non-certifiable when any in-scope filing has a NULL total; `%` + `cover_failed_count` printed.
- **R17** — `docs/build/RUN-M2-3-brief.md` records the M2-3 pre-publication ≥95 % + cover-failed certifiability gate with the LD-8 semantics and data-acquisition prerequisite.
- **R18** — a malformed/missing-field cover persists a `failed`/`cover_failed` filing from validated index metadata, the run continues, and tests cover both malformed XML and a missing required field.
- **R19** — a per-CIK `submissions-meta.json` supplies `inst_filers` retrieval provenance in cache mode; a missing sidecar yields NULL + `submissions_meta_missing`, never the wall clock; both live-written and cache-read behaviour tested.
- **R6/R11 (F8)** — the real 2025-Q1 base `0000950123-25-005701` is fetched and committed alongside its amendment; a test asserts the amendment `amends` the base and both populate `v_default_holdings` for 2025-03-31 (a real NEW-HOLDINGS merge), and V-A ingests four real filings.
- Dev Notes record the V-A acceptance transcript, the T0/LD-9 real base+amendment fetch outcome (incl. the base's discovered info-table filename and row count), and the measured coverage % / `cover_failed_count` / `value_total_delta` per real filing.
