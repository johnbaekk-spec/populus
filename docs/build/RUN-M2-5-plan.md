The plan is complete and grounded in the actual repository and the cached source bytes. Per the DOER contract for this phase, I'm emitting the full `plan-v1` as my final message (no `ExitPlanMode`).

---

# RUN M2-5 — Identity coverage via the SEC Official 13(f) List (plan-v1)

## Goal and Success Criteria

Ingest the SEC's quarterly Official List of Section 13(f) Securities, seed the M2-1 identity registry with quarter-exact CUSIP validity intervals, and thereby make the existing M2-3 coverage gate pass **honestly** so the `inst` module is admitted to the published manifest and served by the already-shipped M2-4 lifecycle. This implements option **A** from `docs/build/RUN-M2-5-brief.md` (the owner-approved spec). Options **B** (inference) and **C** (gate change) are explicit non-goals.

Success = all of:
- On the real Berkshire corpus (`tests/fixtures/inst/real/CIK0001067983`) with lists 2025Q1–2026Q1 seeded, `compute_coverage` reports a **measured** value-coverage ≥ 0.95 for every covered period, reported per period (R9).
- `populus build` → `populus publish` with the gate PASSING admits `inst` to the manifest; the unchanged M2-4 serving layer installs it and the `inst_*` MCP tools answer with `inst_from_published_manifest=True` (R10).
- Periods outside ingested list coverage still fail closed, and the withheld reason names the uncovered quarters (R11).
- Full `make test` suite green with no regression; every behavioural fix is mutation-verified; no test opens a socket (R12).

## Requirements

Verbatim from `docs/build/RUN-M2-5-brief.md` §5 (R1–R12 are the requirement set):

- **R1** — Conditions-register entry `sec-13f-list` (§15): source URLs (old index + new index + file pattern), retrieval discipline, license basis (SEC public record), and an explicit **counsel-gate flag: CUSIP redistribution**; the existing P2-entry counsel gate must name it.
- **R2** — Fetcher through the existing `SecClient` (rate floor, UA, cache, breaker — no second HTTP client), quarterly files cached under `data-cache/13flist/` with full §5.1 provenance (URL, sha256, retrieved_at).
- **R3** — Text parser for the fixed-width variant; column layout taken from the file itself against committed fixtures — no guessed offsets.
- **R4** — PDF parser for historical quarters, reusing M1's PDF machinery; legend semantics (option asterisk, ADDED/DELETED, flag columns, trailing status) read from the document's own legend page and encoded as tested dispositions — never assumed.
- **R5** — Cross-format validation gate: 2026Q2 exists in BOTH formats; parse both and require **row-for-row identity** (CUSIP, name, class, flags). PDF parser's ground truth; non-negotiable.
- **R6** — CUSIP validation: check-digit verification; malformed rows are counted dispositions (the `parse_company_tickers` pattern), never silent drops (G3). Parse-coverage gate: ≥ 99.9% of non-legend lines dispositioned.
- **R7** — Registry seeding: each quarterly list registers CUSIP identities with validity interval **exactly that quarter** — `[quarter_start, quarter_end]` — no extrapolation beyond observed lists (G14); consecutive lists yield contiguous coverage; re-seeding is idempotent (replay-zero, M2-1 discipline); canonical issuer name recorded with source precedence below `securities.yaml`, above FTD-observed names.
- **R8** — Backfill scope: ingest every list covering a period present in the loaded corpus (config: start quarter; default = earliest loaded `period_of_report`); archive availability recorded in the register entry.
- **R9** — Gate re-measurement (acceptance): on the real Berkshire corpus with lists 2025Q1–2026Q1 seeded, measured value-coverage ≥ 0.95 for every covered period; report the exact figure per period; never assert.
- **R10** — End-to-end publish acceptance: build → publish with the gate PASSING → `inst` admitted → the unchanged serving lifecycle installs it → `inst_ticker_holders`/`inst_filer_holdings` answer from published data with `inst_from_published_manifest=True`; the withheld (FTD-only) path stays covered.
- **R11** — Honest degradation: a period outside ingested list coverage contributes zero coverage (fail-closed as today) and the gate reason names the uncovered quarters.
- **R12** — No regressions: full suite green; behavioural fixes mutation-verified; composition truth table and pipeline-agreement suites untouched and green.

**Brief amendments carried by this run (owner-visible, review F4/F6):** (1) R11's "contributes zero coverage" becomes "keeps the unchanged FTD-only coverage arithmetic — fail-closed via the unchanged threshold — with uncovered quarters named" (forcing zero would be a basis change, non-goal C). (2) R7's name precedence is scoped: the three-source precedence governs IDENTITY resolution; canonical NAMES come from the definitional list, the sole persisted name source. Both amendments are already applied to `docs/build/RUN-M2-5-brief.md` (committed 02f535f).

## Scope

One orchestrated run (M2-2-scale per brief §8): an ingest/parse/seed slice that ends at `compute_coverage` clearing 0.95. Three cohesive areas, all required for the gate to pass, delivered together:

1. **Parse** (`src/populus/parse/list13f.py`) — text + PDF parsers, legend parser, CUSIP check-digit, cross-format comparator, record + disposition (R3, R4, R5, R6).
2. **Ingest** (`src/populus/ingest/list13f.py`) — `SecClient` fetcher + cache source, quarter derivation, provenance sidecar, backfill selection (R2, R8).
3. **Seed + gate-reporting + register** — a `bootstrap_13f_list` seeder writing quarter intervals to a dedicated definitional-source table with a precedence-aware resolver (R7); per-period coverage reporting and uncovered-quarter naming (R9, R11); the `sec-13f-list` register entry with a counsel flag (R1); the end-to-end publish acceptance (R10); no regressions (R12).

## Non-goals

- **No inference layer** (option B). No "assume a mapping extends backward" logic; validity comes only from observed lists.
- **No gate change** (option C). The 0.95 threshold and the value-weighted basis of `compute_coverage` (`src/populus/ingest/inst13f.py:949,965-1005`) are **unchanged**. R9/R11 add per-period *reporting* and uncovered-quarter *naming* only — additive, not a change to the PASS/FAIL decision.
- **No serving-layer changes.** `src/populus/client/snapshot.py`, `src/populus/client/__init__.py`, `src/populus/publish/pointer.py`, `src/populus/publish/attestation.py`, and the inst-resolution/envelope code in `src/populus/mcp_server/{server.py,envelope.py,inst_queries.py}` are OUT OF SCOPE (brief R10/§8).
- **No ticker enrichment**; the list has no tickers. `inst_ticker_holders` keeps its present-day `company_tickers` path with existing G14 labeling. N-PORT is a later decision.
- **No dashboard work** (P3 proceeds independently).
- **No wiring of the canonical 13f-list name into `inst_agg` issuer-keying** — R7 requires *recording* the name with precedence; consuming it in aggregation is an explicit follow-up (see Tech Debt).

## Constraints

- **G1** — no vendor data; SEC primary source only. `make security` (dep_guard) must stay exit 0.
- **G3** — never silently drop; every source line is a counted disposition.
- **G4** — both dates on every record; validity intervals carry `valid_from` and `valid_to`; provenance carries `retrieved_at`.
- **G5** — units/bases labeled; interval endpoints are dates; the `[from,to)` half-open convention is explicit.
- **G6** — rate floor/UA/breaker are code constants in `SecClient`, never config.
- **G12** — one module at a time; this run touches ingest/identity only, not serving.
- **G14** — no identity time-travel; a quarter's list registers exactly that quarter, no extrapolation.
- **No network in tests** — the autouse socket guard (`tests/conftest.py:14-28`) stands; the fetcher is tested through an injected transport exactly like `tests/test_inst_ingest.py:586` (`_FakeSecTransport`). Do NOT re-fetch from sec.gov during dev; use the cached files under `data-cache/13flist/`.
- **Canonical gate run SYNCHRONOUSLY**: `make test` + `make security` + `make accept-m2-5` (`Makefile`-owned entrypoints; round-2 F9 normalized the direct-script form away). M2-4 recorded 1475 passing as the pre-M2-5 baseline (`docs/build/RUN-M2-4-devnotes.md:641`).
- ARCHITECTURE.md §5.1 (provenance), §5.4 (identity substrate), §15 (conditions register) apply.
- **Quality bar (M2-4 lessons, `docs/build/RUN-M2-4-devnotes.md` closing sections)**: no vacuous tests (11 were caught in M2-4 — a test that cannot fail is a defect); tests exercise the path a user travels, not a mock that behaves unlike the real object; every behavioural fix is mutation-verified by reintroducing the defect and watching the test fail; the Changed Files list is reconciled against `git status`, not memory.

## Current State

- No 13flist implementation exists; `13flist`/`sec-13f-list` match only in `docs/build/RUN-M2-5-brief.md`. Branch: `m2-5-workspace`.
- **Source material already cached** (gitignored via `.gitignore:1` `data-cache/`) under `data-cache/13flist/`: `13flist2026q2-txt.txt` (2,051,973 bytes, **25,333 rows**) plus PDFs `13flist{2026q2,2026q1,2025q4,2025q3,2025q2,2025q1}.pdf`; each has a `.meta.json` sidecar `{source_url, http_status, bytes, sha256, retrieved_at, user_agent}`. 2026Q2 ships BOTH formats (the R5 pair).
- **Verified text layout** (fixed-width, 80 chars, no header/legend in the txt): `[0:9]` CUSIP · `[9]` option asterisk (`*` on the underlying, 6,110 rows) · `[10:40]` issuer name · `[40:67]` class/description · `[67:70]` status flag (`*A*` ADDED ×1351 / `*D*` DELETED ×844 / blank) · `[79]` trailing status letter (uniformly `E`). 23,277 distinct CUSIPs among 25,333 rows: **1,030 duplicate CUSIPs** (1,024 byte-identical repeats; a few option CUSIPs carry both `*A*` and `*D*` in one quarter). No CUSIP appears with two distinct classes.
- **Verified PDF structure** (2025q1 = 675 pages, 2026q2 = 748 pages): page 0 cover (carries the **CGS/ABA CUSIP copyright + "No redistribution without permission of CGS"** notice — the R1 counsel-flag ground truth), page 1 legend/USER INFORMATION SHEET (ADDED/DELETED and asterisk-option semantics — the R4 ground truth), data pages 2+. Each data page repeats a 3-line header: `Run Date: … ** List of Section 13F Securities ** Page N` / `Run Time: … Year: 2026 Qtr:2 IVM001` / `CUSIP NO ISSUER NAME ISSUER DESCRIPTION STATUS`. In PDF text extraction the CUSIP is split into 3 tokens (6-char issuer + 2-char issue + 1 check digit, e.g. `B38564 10 8`) that must be re-joined; STATUS renders as words `ADDED`/`DELETED` (vs `*A*`/`*D*` in the txt); rows match the txt positionally (first 12 confirmed identical). The `Year: … Qtr:` header is an in-document quarter marker.
- **Legend date is unreliable for the quarter**: the 2025q1 legend body reads "quarter ending March 31, 2024" / "Copyright 2024" (stale template), while 2025q3/2026q1/2026q2 track their filenames correctly. The **filename/source URL is the authoritative quarter identifier** (cross-checked against the PDF's `Year:/Qtr:` header), NOT the legend "current as of" date.
- **CUSIP check-digit**: with the standard mod-10 double-add-double algorithm (letters A=10…Z=35), **all 13,113 non-option rows pass (100%)**; the 11,825 failures are exactly the CALL/PUT option rows (SEC synthetic option CUSIPs, which do not follow the standard rule). Check-digit validation must therefore be scoped to non-option securities.
- **Coverage gate**: `compute_coverage(conn)` (`inst13f.py:965-1005`, `COVERAGE_THRESHOLD=0.95` at `:949`) is value-weighted and corpus-wide; numerator = `SUM(value_usd)` over `v_default_holdings WHERE security_id IS NOT NULL`. `security_id` is stamped at holding ingest by `resolve_security(cusip, period_of_report)` = `resolve_cusip(conn, cusip, as_of)` (`normalize_inst.py:170-199`, wired `inst13f.py:1143-1144`). Consumed at publish in `build.py:1668-1720`; `inst` injected into the manifest only when the gate passes (`build.py:1778-1800`). Typed reasons `{below_threshold, cover_failed, not_measurable}` (`build.py:1691-1704`); **no per-quarter naming exists yet**.
- **Registry**: `security_identifiers` holds CUSIP intervals `[valid_from, valid_to)` with `provenance`/`confidence`/`review_state`/`license_id` (`registry.sql:63-80`); `rewrite_identifier_intervals`/`union_intervals` (`registry.py:1061-1125,755-786`) do adjacency-only union + replay-zero; `applicable_value` (`registry.py:792-813`) resolves as-of and returns `None` on >1 hit (ambiguity, not preference). `normalize_cusip` (`registry.py:202-214`) is format-only; **no check-digit validator exists**. `target_for` + `ensure_security` assign a deterministic security_id from the authority (`bootstrap.py:846-878` in `bootstrap_ftd`); `securities` has **no name column** and FTD issuer names are not persisted.
- **Register**: `src/populus/licenses.json` (`register_version licenses-1.1.0`), validated by `src/populus/licenses.py` (`REQUIRED_FIELDS` `:22-35`, `_STATUSES` `:36`); entries `sec-edgar`/`sec-ftd` (`:48-94`); manifest cross-checks license_ids (`build.py:1801-1802`). **No structured counsel-gate flag field exists** — the counsel gate is prose in `ARCHITECTURE.md §17`.
- **Tests**: cache-gated acceptance pattern exists (`@pytest.mark.skipif(not DATA_CACHE.exists(), …)`, `tests/test_senate_ingest.py:1677`; `tests/test_backfill.py:322`); golden pattern `UPDATE_GOLDENS=1` (`tests/test_inst_ingest.py:5,123-128`); real Berkshire corpus fixture `tests/fixtures/inst/real/CIK0001067983` (`real_conn`, `REAL_CIK`); withheld-path tests in `tests/test_publish.py`, `tests/test_inst_ingest.py`, `tests/test_mcp_server_inst.py`.

## Detected Stack

Python 3.12, `uv`, hatchling, SQLite/JSON1, Click, `httpx`, `lxml`, **`pdfplumber` + `pypdf`** (already declared, `pyproject.toml:10-20`), FastMCP, pytest. Canonical gates: `make test` and `make security` (the latter wraps `uv run python scripts/dep_guard.py`; the script is mode 100644 and never invoked directly). **No new dependency is required** (R4 reuses the declared PDF libraries; adding one would have to satisfy `dep_guard.py` and keep `uv.lock` frozen).

## Reuse Map

| Need | Existing symbol / path | Decision |
|---|---|---|
| HTTP fetch (rate floor/UA/cache/breaker) | `SecClient.get` `src/populus/net/sec_client.py:302` (transport required positional `:271`) | **Reuse** — no second HTTP client (R2). |
| Fetch→cache→sidecar + injected-transport pattern | `_LiveSource`/`_CacheSource` dual source `src/populus/ingest/inst13f.py:120-254`; `archive_path` `ingest/__init__.py:35` | **Mirror** the dual-source shape (R2, R8). |
| Injected transport for tests | `_FakeSecTransport` `tests/test_inst_ingest.py:586`; `SecTransport` protocol `sec_client.py:155` | **Reuse** (R2, R12; socket guard `conftest.py:14`). |
| Columnar PDF parsing | GENERIC primitives only: `extract_positioned` `src/populus/parse/house_ptr.py:399` + `_column_of` `:615`; pypdf layout `:340`. **`_header_anchors` and `_Segmenter` are NOT reused** — they hard-code House columns (`id`/`owner`/`asset`/…, `:436-461`) and House `RowCandidate` routing (`:503-603`) and recognize none of `CUSIP NO`/`ISSUER NAME`/`ISSUER DESCRIPTION`/`STATUS` (round-3 F10). | **Reuse the generic pair; ADD a small, fixture-tested 13F adapter** (`_list13f_anchors` + `_list13f_row_mapper`, T3) for this layout's headers and row shape (R4). |
| Counted-disposition accounting | `Disposition` (buckets partition `rows_read`, `__post_init__` sum-assert) `src/populus/identity/bootstrap.py:86-117`; `parse_company_tickers` `:370` | **Reuse the pattern** for the 13flist parser (R6). |
| CUSIP format normalization | `normalize_cusip` / `_CUSIP_RE` `registry.py:202-214,84` | **Reuse** for format gate; **add** check-digit on top (R6, net-new). |
| Security-id assignment + interval seeding | `target_for`/`ensure_security` `registry.py:665,225`; `bootstrap_ftd` `bootstrap.py:797-929` | **Mirror** `bootstrap_ftd` so the same CUSIP gets the same security_id across sources (R7). |
| As-of resolution | `resolve_cusip`/`applicable_value` `registry.py:860,792` | **Extend** `resolve_cusip` with an additive definitional-source precedence branch (R7). |
| Coverage gate | `compute_coverage` `inst13f.py:965`; publish wiring `build.py:1668-1800` | **Reuse unchanged** for PASS/FAIL; **add** `compute_period_coverage` companion (R9, R11). |
| Register schema/loader | `licenses.json`; `licenses.py:22-100`; `sec-edgar`/`sec-ftd` entries | **Extend** with `sec-13f-list` + optional `counsel_flags` (R1). |
| CLI seeding entrypoint | `identity bootstrap` `cli.py:365-486`; `run_identity_bootstrap` `bootstrap.py:1027-1090` | **Extend** with 13flist options (R8). |
| Cache-gated acceptance / golden / real corpus | `skipif(not DATA_CACHE.exists())` `test_senate_ingest.py:1677`; `UPDATE_GOLDENS` `test_inst_ingest.py:123`; `real_conn` fixture | **Reuse** for R9. |
| Fixture convention (verbatim clip + PROVENANCE.md) | `tests/fixtures/inst/ftd/PROVENANCE.md` | **Mirror** at `tests/fixtures/inst/13flist/` (R3–R6, R9). |

## Architecture

Data flow (all new work is upstream of the untouched serving layer):

```
data-cache/13flist/*.pdf|.txt ──▶ ingest/list13f.py (SecClient live | cache source)
   │  quarter derived from source URL/filename, cross-checked vs PDF Year/Qtr header
   ▼
parse/list13f.py:
   text parser (fixed offsets, fixture-pinned)  ─┐
   pdf parser (M1 x-anchored column split)       ├─▶ List13fRecord{cusip,name,class,is_option,status,quarter}
   legend parser (page-1 semantics)              │       + Disposition (counted buckets, ≥99.9% gate)
   CUSIP check-digit (non-option only)           │
   cross-format comparator (2026Q2 txt==pdf) ────┘   (R5 ground-truth gate)
   ▼
identity/list13f_seed.py: bootstrap_13f_list(conn, records, quarter, ...)
   for each accepted CUSIP: sid = target_for(registry,'cusip',cusip,quarter_asof); ensure_security(sid)
   upsert row into security_list_intervals[sid, cusip, quarter_start, next_quarter_start,
       issuer_name, class, is_option, status_flag, provenance='sec-13f-list', source_url, sha256]
   (idempotent PK(value, valid_from) ⇒ replay-zero)
   ▼
registry.resolve_cusip(conn, cusip, as_of):        # PRECEDENCE-AWARE, FAIL-CLOSED (round-4 F12)
   covering = [definitional rows whose interval covers as_of]
   if covering:                                      # the definitional layer DECIDES
       return unique_undisputed(covering) or None    # ambiguous/disputed ⇒ None — NEVER falls to FTD
   return applicable_value(security_identifiers rows, as_of)   # FTD only when NO definitional coverage
# `applicable_value` returns None for zero rows AND for ambiguous/disputed alike
# (`registry.py:792-813`), so the fallback must key on COVERAGE, not on None —
# else a disputed list binding resolves through a lower-precedence FTD row,
# violating the R18 disputed-resolves-nowhere contract (`tests/test_identity.py:433-457`).
   ▼
(pipeline order) identity bootstrap (incl. 13flist)  ──▶  inst ingest stamps security_id
   ──▶ build.run_build → compute_coverage ≥0.95 → inst admitted (build.py:1778-1800)
   ──▶ publish → M2-4 serving installs inst → inst_* tools: inst_from_published_manifest=True
```

**R7 multi-source design (locked, see Locked Decisions).** The definitional 13f-list source writes a **dedicated `security_list_intervals` table**, NOT the shared `security_identifiers` table. This is deliberate: reusing `rewrite_identifier_intervals` for a second provenance would either create resolver ambiguity (two applicable rows for one date → `applicable_value` returns `None`) or clobber FTD provenance and make results order-dependent (the function reads existing rows regardless of provenance and re-inserts them all under the single passed `provenance`, so an FTD-only day sharing a CUSIP would be mis-tagged `sec-13f-list` — verified by reading `registry.py:1079-1125`). A separate table keeps the FTD write path byte-for-byte untouched (zero risk to existing FTD/registry tests) and makes source precedence explicit and testable. `resolve_cusip` becomes precedence-aware with an additive branch that is a no-op when the new table is empty (all existing tests unchanged).

**Quarter interval (R7).** From the source URL/filename `13flist{YYYY}q{N}` (cross-checked against the PDF `Year:/Qtr:` header, never the stale legend date), derive the calendar quarter and store the half-open interval `[quarter_start, next_quarter_start)` so that `period_of_report` (the quarter-end date) resolves (`valid_from ≤ period < valid_to`) and consecutive quarters are contiguous at resolution (Q1 `[2025-01-01,2025-04-01)`, Q2 `[2025-04-01,2025-07-01)`). No cross-quarter physical merge is needed; one row per (CUSIP, quarter).

## Locked Decisions

1. **Quarter identity = source URL/filename**, cross-checked against the PDF `Year:/Qtr:` in-document header; the legend "current as of / quarter ending" date is parsed and, on mismatch, recorded as a disposition/warning but never used to set the interval (the 2025q1 legend is stale boilerplate). (R7, R8)
2. **CUSIP check-digit is scoped to non-option securities.** Standard mod-10 double-add-double (A=10…Z=35) over chars `[0:8]` vs char `[8]`. Option rows (class ∈ {CALL, PUT}, legend-grounded) are a distinct accepted class NOT subject to the standard rule. Invariant pinned by a fixture test: non-option rows pass 100%; option rows are accepted as options. (R6)
3. **Legend/flag semantics are read from the PDF legend page (page 1) and encoded as tested dispositions** (`*A*`/ADDED, `*D*`/DELETED, underlying-asterisk = "has a listed option", trailing `E`), and the seeding outcomes are LOCKED NOW (review F3): an unmarked or ADDED row on quarter Q's list seeds validity for Q; a **DELETED row is a counted NON-SEED disposition (`counted_deleted`)** — per the cached legend it ceased to be a 13(f) security since the prior list, so it registers no interval for Q (the prior quarter's own list already covers the prior quarter; no extrapolation, G14). The legend-presence assertion stays fixture-pinned and fails loud on drift. (R4, R7, G3)
4. **Duplicate and conflicting rows have order-independent, locked outcomes** (review F3): byte-identical repeats collapse to one accepted record with an `accepted_duplicate` count; a **same-CUSIP contradictory status pair (`*A*`+`*D*`) is `rejected_status_conflict` — NEITHER row seeds**, decided across the WHOLE file before any seeding (the `parse_company_tickers` DC1 pattern), so input order cannot change the outcome; order-independence is asserted by a test that feeds both orders. Every bucket partitions `rows_read` with the sum-assert. (R6, G3)
5. **R5 comparison is FULL-FILE and cardinality-preserving, BEFORE dedup or seeding** (review F1). Both parsers expose the raw canonical row sequence (`raw_rows`: one `(cusip, name, class, flags)` tuple per source line, pre-dedup); `assert_cross_format_identity` compares the COMPLETE 2026Q2 text file against the COMPLETE 2026Q2 PDF: total count equal, order equal, multiplicity equal, every tuple equal — a PDF parser that drops or duplicates an identical source row FAILS this gate. Committed excerpts remain for hermetic unit tests; the full-file comparison is a **mandatory acceptance-command gate (T13) that ERRORS — never skips — if either full file is absent**. STATUS words map to flags (`ADDED↔*A*`, `DELETED↔*D*`, blank↔blank); on mismatch the error carries the first diverging index and a multiset diff as diagnostics. (R5)
6. **R7 writes a dedicated `security_list_intervals` table; `resolve_cusip` gains an additive definitional-source-first precedence branch.** FTD write path and `union_intervals`/`rewrite_identifier_intervals` are untouched. **The quarter interval is INTERSECTED with the `securities.yaml` authority ownership windows before seeding** (review F2): if a declared-authority boundary falls inside `[quarter_start, next_quarter_start)`, the interval is split at each boundary and `target_for` is called as-of EACH sub-interval's start, one row per sub-interval — a quarter-end owner is never back-filled across a mid-quarter reassignment (G14). With `securities.yaml` empty (today) no split occurs and behaviour is the plain quarter interval. Boundary test matrix: mid-quarter reassignment; Q1→Q2 and Q4→Q1 (year) contiguity; leap-year Feb 29; boundary day; boundary-minus-one day. **And the LIFECYCLE half (round-3 F2): a LATER `securities.yaml` authority revision must recut this table too** — `reconcile_identity_registry` currently migrates only `security_identifiers` (`registry.py:1208-1239`), so `security_list_intervals` joins the FK-to-securities table set: the migration repoints/cuts its rows with the existing `owner_windows`/`cut_interval` machinery, the overlap invariants extend to it, and the FK-completeness contract test (`tests/test_identity_migration.py:108-125`) is updated to enumerate it. Replay interplay: the MIGRATION owns the recut; a same-SHA reseed after migration stays replay-zero because rows already reflect the migrated state. Convergence tests: seed-then-revise-authority ends bit-identical to revise-authority-then-seed (clean build), including a mid-quarter split introduced by the revision. (R7, G14)
7. **Gate DECISION unchanged (non-goal C honored) — and R11's wording is reconciled by brief amendment** (review F4). `compute_coverage` and its 0.95 threshold/value basis are untouched. An uncovered quarter is NOT forced to zero (that would be a basis change): it keeps exactly today's sparse FTD-only arithmetic, fails the unchanged 0.95 threshold naturally, and is NAMED in `uncovered_quarters` on the withheld reason. The brief's R11 sentence "contributes zero coverage" is amended to "keeps the unchanged FTD-only coverage arithmetic (fail-closed via the unchanged threshold), with uncovered quarters named". A dedicated test seeds a quarter with VALID FTD mappings but NO list and asserts its coverage equals the FTD-only figure (bit-for-bit today's behaviour), the gate outcome is unchanged, and the quarter is named. `compute_period_coverage` produces per-period figures (R9); `build.py` attaches them on pass. (R9, R11)
8. **Sidecar shape matches the on-disk 13flist convention** `{source_url, http_status, bytes, sha256, retrieved_at, user_agent}` (§5.1). (R2)
9. **Pipeline order: identity bootstrap (incl. 13flist) runs before inst ingest** so holdings' `security_id` is stamped from the seeded registry. The R9/R10 acceptance harness seeds-then-ingests-then-builds to match production; DEV verifies (and, if needed, wires) this ordering in the build pipeline. (R9, R10)
10. **Name precedence is scoped by brief amendment** (review F6): the three-source precedence `securities.yaml > sec-13f-list > sec-ftd` governs IDENTITY resolution (which security a CUSIP maps to as-of a date) — exercisable and tested across authority windows, definitional intervals, and FTD intervals. **Canonical NAMES come from the definitional list, the sole persisted name source**: `resolve_security_name` returns the covering quarter's list name or `None` — never a fabricated fallback (FTD names are observed but not persisted, unchanged; `securities.yaml` carries no name field today and would take precedence if it ever grows one). The brief's R7 is amended to state this scope. (R7)
11. **Corrected-source replay policy** (review F8): re-seeding a quarter whose cached list has the SAME `list_sha256` is replay-zero (idempotent, `Mutations` all zero). Re-seeding with a DIFFERENT `list_sha256` is a **hard error naming both hashes** unless the explicit `--replace-quarter` flag is passed, in which case that quarter's rows for this source are superseded in one transaction and `Mutations`-counted — an auditable correction, never a silent overwrite. Both paths tested. (R2, R7, §5.1)
12. **Register gets an optional `counsel_flags` list field**; `sec-13f-list` carries `["cusip-redistribution"]` with the verbatim CGS/ABA notice in `required_notices`/`determination_basis`; ARCHITECTURE.md §15/§17 name it. Optional (not required) so existing entries need no migration. (R1)

## Alternatives Considered

- **Seed 13f-list into the shared `security_identifiers` table** (reuse `rewrite_identifier_intervals`): rejected — creates resolver ambiguity or clobbers FTD provenance and is order-dependent (Decision 6 rationale). A provenance-aware union across both sources was considered but touches the core FTD path (higher regression risk) for no coverage benefit.
- **Register the quarter as 90 individual observed dates** via existing `union_intervals`: rejected — semantically dishonest (we observed one list, not each day) and ~2.3M date strings/quarter; the interval model fits the definitional source better.
- **Per-period gate thresholding**: rejected — that is a basis change (non-goal C). Per-period figures are reporting only; the corpus-wide 0.95 decision stands.
- **Add a required `counsel_flags` field to every entry**: rejected — forces migration of `sec-edgar`/`sec-ftd` and their tests; an optional field is minimal.
- **Text-only ingest (skip the PDF parser)**: rejected — only 2026Q2 has a text variant; historical quarters (2025Q1–2026Q1, the R9 corpus) are PDF-only, so R4 is mandatory and R5 is its ground truth.

## Planned Files

New source:
- `src/populus/parse/list13f.py`
- `src/populus/ingest/list13f.py`
- `src/populus/identity/list13f_seed.py`

Modified source:
- `src/populus/registry.sql`
- `src/populus/identity/registry.py` — incl. extending `reconcile_identity_registry` to cut/repoint `security_list_intervals` (round-2 F2)
- `src/populus/identity/bootstrap.py`
- `src/populus/licenses.json`
- `src/populus/licenses.py`
- `src/populus/ingest/inst13f.py`
- `src/populus/publish/build.py`
- `src/populus/cli.py`
- `scripts/accept_m2_5.py` — NEW (T13, the mandatory acceptance command)
- `Makefile` — edited (adds the `accept-m2-5` target)
- `scripts/render_licenses.py`
- `DATA-LICENSE.md`
- `NOTICE`
- `ARCHITECTURE.md`

New tests:
- `tests/test_list13f_parse.py`
- `tests/test_list13f_ingest.py`
- `tests/test_list13f_seed.py`
- `tests/test_list13f_coverage.py`

Modified tests:
- `tests/test_licenses.py`
- `tests/test_publish.py`
- `tests/test_identity.py` — the hard-coded `SECURITY_ID_REFERENCING_TABLES` tuple (`:814-823`) gains `security_list_intervals`; without this edit `make test` deterministically fails once the table joins the FK set (round-3 F2)
- `tests/test_identity_migration.py` — the FK-completeness contract (`:108-125`) enumerates the new table; new lifecycle-convergence cases live here

New fixtures:
- `tests/fixtures/inst/13flist/13flist2026q2-excerpt.txt`
- `tests/fixtures/inst/13flist/13flist2026q2-excerpt.pdf`
- `tests/fixtures/inst/13flist/13flist2025q1-excerpt.pdf`
- `tests/fixtures/inst/13flist/13flist2025q2-excerpt.pdf`
- `tests/fixtures/inst/13flist/13flist2025q3-excerpt.pdf`
- `tests/fixtures/inst/13flist/13flist2025q4-excerpt.pdf`
- `tests/fixtures/inst/13flist/13flist2026q1-excerpt.pdf`
- `tests/fixtures/inst/13flist/PROVENANCE.md`
- `tests/fixtures/inst/expected/list13f-2026q2.expected.json`

New docs (DEV phase, not this planning phase):
- `docs/build/RUN-M2-5-devnotes.md`

## Implementation Tasks

**T1 — Register entry `sec-13f-list` + counsel flag (R1).**
- `src/populus/licenses.py`: add optional `counsel_flags` to the schema; validate it is a list of non-empty strings when present (extend `validate_register`, `:49-81`); expose a `counsel_flags(license_id)` helper.
- `src/populus/licenses.json`: add `sec-13f-list` mirroring `sec-ftd` structure with `source` = SEC index (new `…/staff-guidance/official-list-section-13f-securities`, old `…/divisions/investment/13flists.htm` 301, file pattern `sec.gov/files/investment/13flist{YYYY}q{N}.pdf` and the `-txt.txt` variant), `required_notices` = the verbatim CGS/ABA notice, `restrictions` naming the CUSIP-redistribution counsel gate and the archive-availability range recorded during the run (R8), `counsel_flags: ["cusip-redistribution"]`, `ingestible: true`, `status: "determined"`, ISO `determination_date`/`review_by`.
- `scripts/render_licenses.py` + regenerated `DATA-LICENSE.md`/`NOTICE`: render the counsel flag.
- `ARCHITECTURE.md` §15/§17: record `sec-13f-list` and that the P2-entry counsel gate names the CUSIP-redistribution flag.

**T2 — Text parser (R3, R6).** `src/populus/parse/list13f.py`:
- `List13fRecord` dataclass (`cusip, issuer_name, security_class, is_option, status_flag, quarter`); module constants for the fixed offsets (`CUSIP=[0:9]`, `OPT=[9]`, `NAME=[10:40]`, `CLASS=[40:67]`, `STATUS=[67:70]`, `TRAIL=[79]`) with a docstring citing the verified layout.
- `Disposition13f` mirroring `bootstrap.Disposition` (buckets partition `rows_read`, `__post_init__` sum-assert): `accepted`, `accepted_option`, `accepted_duplicate`, `counted_deleted`, `rejected_status_conflict`, `rejected_malformed`, `rejected_bad_check_digit`, `rejected_bad_width` (F3 semantics per Locked Decisions 3–4; conflict decided file-wide pre-seeding, order-independent).
- `parse_list13f_text(data: str, *, quarter) -> ParsedList13f` with `.raw_rows` (the cardinality-preserving canonical `(cusip, name, class, flags)` sequence, one per source line, PRE-dedup — the R5 comparison substrate), `.records` (post-disposition accepted set) and `.disposition`. Pure; offsets validated against width; duplicates deduped-with-count; CUSIP through `normalize_cusip` then `cusip_check_digit_ok` (T4) for non-option rows.

**T3 — PDF parser + legend (R4).** `src/populus/parse/list13f.py`:
- `parse_list13f_legend(pdf_bytes) -> LegendSemantics`: read page 1; assert the ADDED/DELETED and asterisk-option sentences are present (fixture-tested); fail loud if the legend text drifts.
- `parse_list13f_pdf(pdf_bytes, *, quarter) -> ParsedList13f` (same shape as T2, incl. `.raw_rows` pre-dedup): reuse ONLY the generic `extract_positioned`/`_column_of` primitives, plus two NEW 13F-specific helpers in `parse/list13f.py` (round-3 F10): `_list13f_anchors(page_words)` — derives x-anchors from the `CUSIP NO ISSUER NAME ISSUER DESCRIPTION STATUS` header line, fixture-tested against a committed page; and `_list13f_row_mapper(positioned_words, anchors)` — maps word runs to columns, re-joins the 3-token CUSIP, maps STATUS words to flags. Filter the 3-line per-page header; retain-and-flag unparseable lines (never drop). House's `_header_anchors`/`_Segmenter` are NOT touched. Parse-coverage: ≥99.9% of non-legend/non-header lines yield a record (report shortfall).

**T4 — CUSIP check-digit (R6).** `src/populus/parse/list13f.py`: `cusip_check_digit_ok(cusip: str) -> bool` (standard mod-10 double-add-double, A=10…Z=35). Applied only to non-option rows; option rows accepted as options.

**T5 — Cross-format gate (R5, full-file per Locked Decision 5).** `src/populus/parse/list13f.py`: `assert_cross_format_identity(text_parsed, pdf_parsed) -> None` comparing `.raw_rows` sequences — count, order, multiplicity, every tuple — raising an error carrying the first diverging index plus a multiset diff. Hermetic test on the committed 2026Q2 excerpts; the COMPLETE-file comparison runs in the mandatory acceptance command (T13) and ERRORS if either full file is absent.

**T6 — Fetcher + cache source + backfill (R2, R8).** `src/populus/ingest/list13f.py`:
- `_LiveSource` (via `SecClient.get`, writes bytes under `archive_path` + `.meta.json` sidecar per Decision 8) and `_CacheSource` (reads `data-cache/13flist/`), mirroring `inst13f.py:120-254`.
- `quarter_from_url(url) -> Quarter` and `quarter_bounds(quarter) -> (start, next_start)`; cross-check vs PDF `Year:/Qtr:` header.
- `select_backfill_quarters(conn, start_quarter=None)`: default = earliest `period_of_report` in `v_default_inst_filings` through the latest; honor an explicit start.
- `run_list13f_ingest(conn, *, source, quarters, ...)`: fetch/read → parse (txt preferred where present, else pdf) → for 2026Q2 run the R5 gate → seed (T7).

**T7 — Registry table + seeder + precedence resolver (R7).**
- `src/populus/registry.sql`: `security_list_intervals(security_id, id_type, value, valid_from, valid_to, quarter, issuer_name, security_class, is_option, status_flag, provenance, license_id, review_state, source_url, list_sha256, retrieved_at, raw_path, row_ordinal, parser_version, normalization_version, raw, PRIMARY KEY(value, valid_from))` — full §5.1 provenance ON THE FACT ROW (F8): every seeded identity traces to its retrieval event (`retrieved_at`, `source_url`, `list_sha256`, `raw_path`), its source line (`row_ordinal`, `raw`), and its transformation (`LIST13F_PARSER_VERSION`, `LIST13F_NORMALIZATION_VERSION` constants) (+ a lookup index on `value`), `IF NOT EXISTS`, picked up by `ensure_registry` (`registry.py:92-104`).
- `src/populus/identity/registry.py`: `IDENTITY_SOURCE_PRECEDENCE = ("securities.yaml","sec-13f-list","sec-ftd")` (identity resolution only — there is NO name-precedence constant, round-4 F13); a write helper `upsert_list_interval(...)` (idempotent, replay-zero via PK/`DO NOTHING`-when-identical, `Mutations`-counted); fail-closed precedence-aware `resolve_cusip` per the Architecture pseudocode (definitional layer decides when it covers; FTD only when it does not — round-4 F12); `resolve_security_name(conn, security_id, as_of)` returning the covering quarter's list name or `None` (amended R7 — the list is the sole persisted name source).
- `src/populus/identity/list13f_seed.py`: `bootstrap_13f_list(conn, parsed, *, quarter, registry, source_meta, license_id='sec-13f-list', provenance='sec-13f-list', replace_quarter=False, disposition=None, mutations=None)` mirroring `bootstrap_ftd` (`bootstrap.py:797-929`), where `source_meta` is the sidecar dict (source_url, sha256, retrieved_at) + raw_path: per CUSIP, intersect `[quarter_start, next_start)` with the `securities.yaml` authority ownership windows, split at any interior boundary, and call `target_for` as-of EACH sub-interval start (Locked Decision 6, G14) before `ensure_security` + `upsert_list_interval` per sub-interval. Replay: same `list_sha256` ⇒ replay-zero; different `list_sha256` ⇒ hard error naming both hashes unless `replace_quarter=True`, which supersedes the quarter's rows for this source in one transaction, `Mutations`-counted (Locked Decision 11). DELETED rows and status-conflict CUSIPs are never seeded (Locked Decisions 3–4).
- `src/populus/identity/bootstrap.py`: constants `LIST13F_PROVENANCE`/`LIST13F_LICENSE_ID`; wire optional 13flist seeding into `run_identity_bootstrap` inside the existing single `BEGIN IMMEDIATE` transaction (`:1047-1090`).

**T8 — Per-period coverage + uncovered-quarter naming (R9, R11).**
- `src/populus/ingest/inst13f.py`: `compute_period_coverage(conn) -> tuple[PeriodCoverage, ...]` (per `period_of_report`: denominator, numerator, coverage, `covered_by_list: bool` = any `security_list_intervals` row spans the period). `compute_coverage` unchanged.
- `src/populus/publish/build.py`: on PASS attach the per-period breakdown to the report (R9); in the withheld branch add `uncovered_quarters` to `inst_withheld` (R11) without changing the typed reason set or threshold.
- `src/populus/cli.py`: `build`/`publish` output surfaces per-period figures and the uncovered-quarter list.
- R11 semantics per Locked Decision 7 (brief-amended): an uncovered quarter keeps today's FTD-only arithmetic bit-for-bit — no forcing to zero, no basis change — and is named; the valid-FTD-but-no-list test pins it.

**T9 — CLI wiring (R8, R7).** `src/populus/cli.py` `identity bootstrap`: add `--list13f-cache` (dir, default `data-cache/13flist/`), repeatable `--list13f` (explicit file), `--list13f-start-quarter`, and **`--replace-quarter` (round-2 F8)** — the operator path for Locked Decision 11's corrected-source replacement; pass all into `run_identity_bootstrap` → `bootstrap_13f_list`. CLI-level tests: default rejection of a different-sha reseed with BOTH hashes in the diagnostic; successful transactional replacement under the flag with counted mutations; replay-zero on the next same-sha run.

**T10 — Fixtures (R3–R6, R9).** Create `tests/fixtures/inst/13flist/` verbatim clips: 2026Q2 txt excerpt + 2026Q2 pdf excerpt (cover + legend page + one data page covering the same CUSIPs, clipped with pypdf); per-quarter 2025Q1–2026Q1 pdf excerpts containing the Berkshire CUSIP rows + legend page; `PROVENANCE.md` (source URL, archive sha256 from the `.meta.json`, retrieved date/UA, excerpt sha256, exact line/page contents) mirroring `tests/fixtures/inst/ftd/PROVENANCE.md`; golden `tests/fixtures/inst/expected/list13f-2026q2.expected.json`.

**T11 — Tests (R3, R4, R5, R6, R7, R8, R9, R10, R11, R12).** See Testing Strategy — including the R10 end-to-end publish acceptance that drives the real SnapshotClient; every behavioural assertion mutation-verified.

**T13 — Mandatory acceptance command (R5, R9, R10 — review F5).** `scripts/accept_m2_5.py` + a `make accept-m2-5` target, run SYNCHRONOUSLY by DEV (not part of the hermetic CI suite):
- **ERRORS (nonzero) if any required input is absent** — the full 2026Q2 txt AND pdf and the 2025Q1–2026Q1 pdfs under `data-cache/13flist/` (cache-only inputs), and the TRACKED real Berkshire corpus at `tests/fixtures/inst/real/CIK0001067983` (present in every checkout — asserted anyway); a skip is impossible by construction, and each missing-input case has its own nonzero-exit test alongside the with-inputs success test.
- Runs the FULL-FILE R5 cross-format gate (Locked Decision 5).
- **Fresh path**: seeds lists → ingests the real corpus → builds; **populated pre-M2-5 path** (round-4 F14): ingests FIRST into a clean db (no lists), then seeds, then RE-ingests, then builds — proving the locked rollout sequence recovers a populated database. BOTH paths **print the exact per-period numerator, denominator, and ratio** and exit nonzero if any list-covered period is <0.95.
- Its captured output is pasted VERBATIM into Dev Notes (the R9 evidence is this output, not prose).

**T12 — Gate + Dev Notes.** Run `make test`, `make security` (the repository-owned dep_guard entrypoint — `scripts/dep_guard.py` is mode 100644 and not directly executable, round-2 F9), AND `make accept-m2-5` (T13) synchronously; write `docs/build/RUN-M2-5-devnotes.md` with the T13 output verbatim and a Changed Files list reconciled against `git status`.

## Testing Strategy

All tests are hermetic (socket guard `conftest.py:14`); the fetcher is exercised only through an injected `_FakeSecTransport`. Committed fixtures are small verbatim clips. The full-corpus measurement is NOT merely cache-gated: the mandatory T13 acceptance command ERRORS when inputs are missing and is a required DEV gate (review F5) — the cache-gated pytest variant is a convenience duplicate, never the evidence.

- **Parse (`tests/test_list13f_parse.py`)** — text offsets against the committed excerpt (R3); the option-vs-non-option check-digit invariant (non-option pass 100%, options accepted as options — mutation: drop the option scoping and watch non-option-only assertion fail) (R6); duplicate dedup-with-count; the `*A*`+`*D*` pair is `rejected_status_conflict` with NEITHER seeded, asserted in BOTH input orders (order-independence, F3); DELETED rows land in `counted_deleted` and register no interval (R4/R6/G3); disposition buckets partition `rows_read` (`__post_init__`); parse-coverage ≥99.9% (R6); legend semantics present and ADDED/DELETED/asterisk mapping (R4); PDF x-anchored column split + 3-token CUSIP re-join against the pdf excerpt (R4); golden round-trip (R3/R4).
- **Cross-format (`tests/test_list13f_parse.py`)** — parse 2026Q2 txt + pdf excerpts, `assert_cross_format_identity` passes; mutation: perturb one pdf record and watch it fail. The COMPLETE-file comparison is the T13 acceptance gate (R5).
- **Ingest (`tests/test_list13f_ingest.py`)** — `quarter_from_url` for each filename incl. the stale-legend 2025q1 (asserts filename wins, mismatch recorded); `_LiveSource` via `_FakeSecTransport` writes the correct sidecar shape + sha256 == content; `_CacheSource` reads sidecars; the transport is required (no default); `select_backfill_quarters` from corpus periods with an explicit-start override (R2, R8).
- **Seed (`tests/test_list13f_seed.py`)** — quarter interval exactly `[start,next_start)` so `resolve_cusip` at the quarter-end period returns the security_id (R7, G14); consecutive quarters resolve contiguously across the boundary; **authority-window intersection matrix** (F2): mid-quarter `securities.yaml` reassignment splits the interval and each sub-interval resolves to ITS owner (never the quarter-end owner back-filled), plus Q1→Q2, Q4→Q1 year-boundary, leap-year Feb 29, boundary-day and boundary-minus-one assertions; **lifecycle convergence** (round-3 F2, in `tests/test_identity_migration.py`): seed-then-revise-authority ends bit-identical to revise-then-seed (clean build) including a mid-quarter split introduced by the revision, and a same-SHA reseed AFTER migration is replay-zero; **replay policy** (F8): same-sha reseed ⇒ replay-zero, different-sha reseed ⇒ hard error naming both hashes, `--replace-quarter` ⇒ transactional supersede with counted mutations; **replay-zero** (re-seed same quarter ⇒ `Mutations` all zero; mutation: break the idempotent guard and watch it fail); **cross-source consistency** — seed FTD and 13f-list for the same CUSIP, assert ONE security_id, no ambiguity, `resolve_cusip` returns it as-of both an FTD date (FTD fallback) and a quarter date (definitional), in BOTH seed orders (order-independent); an FTD-only date outside any seeded quarter still resolves via FTD and is NOT re-tagged `sec-13f-list`; a period with no seeded list resolves to `None` (R7, R11); **fail-closed precedence** (round-4 F12): a DISPUTED covering list row above a usable FTD row resolves to `None` (never falls through), overlapping/ambiguous covering list rows above a usable FTD row resolve to `None`, and FTD is consulted ONLY when no definitional interval covers the date; `resolve_security_name` returns the covering quarter's list name or `None` (amended R7 — no other source).
- **Coverage (`tests/test_list13f_coverage.py`)** — *always-run*: a crafted inst corpus + committed list excerpts covering its CUSIPs ⇒ `compute_coverage` ≥0.95 and `compute_period_coverage` per-period figures (R9); a period with no covering list ⇒ withheld reason names it (R11, mutation: drop the naming and watch it fail). **A valid-FTD-but-no-list quarter** keeps bit-for-bit today's FTD-only coverage figure — not forced to zero, no basis change — and is named in `uncovered_quarters` (F4). *Cache-gated convenience duplicate* of the T13 measurement (`skipif`), but the R9 EVIDENCE is the mandatory T13 command output (errors on missing inputs; exact per-period numerator/denominator/ratio; nonzero exit under 0.95).
- **Register (`tests/test_licenses.py`)** — `sec-13f-list` validates; `counsel_flags` present with `cusip-redistribution`; a malformed `counsel_flags` is rejected (mutation) (R1).
- **End-to-end (`tests/test_publish.py`)** — the FULL production lifecycle with NOTHING mocked (F7): seed 13flist → inst ingest → build → publish, then call the production `_resolve_snapshot()` (monkeypatching ONLY `sys.argv` to the repo/cache and `_utc_now` — the real `SnapshotClient` and `LocalRepoFetcher` run inside it), pass its UNMODIFIED output dict straight into `build_server(**resolved)`, and call BOTH `inst_ticker_holders` and `inst_filer_holdings` asserting real data and `inst_from_published_manifest=True`. FORBIDDEN in this test: mocking the manifest, the client, the resolver output, or the provenance boolean — a hand-built `build_server(inst_from_published_manifest=True)` cannot pass for this requirement (R10). The existing withheld-path tests (`test_inst_gate_withholds_below_threshold_congress_publishes:2137`, `:2274`, `:2612`, the `inst_from_published_manifest is False` assertions `:3494` etc.) stay green (R10, R12).
- **Regression (R12)** — full `make test` green; `make security` exit 0; the composition truth table and pipeline-agreement suites in `tests/test_inst_ingest.py`/`test_inst_agg.py` untouched and green.

## Verification Matrix

| Req | Verification |
|---|---|
| R1 | `tests/test_licenses.py` validates `sec-13f-list` + `counsel_flags`; rendered `DATA-LICENSE.md`/`NOTICE` show the flag; ARCHITECTURE.md §15/§17 name it. |
| R2 | `tests/test_list13f_ingest.py` — `_FakeSecTransport` fetch writes sidecar `{source_url,http_status,bytes,sha256,retrieved_at,user_agent}` with sha256==content; no second HTTP client; transport required. |
| R3 | `tests/test_list13f_parse.py` — text offsets against the committed excerpt + golden; no guessed offsets (constants cite verified layout). |
| R4 | `tests/test_list13f_parse.py` — legend semantics asserted from page 1; PDF x-anchored split + 3-token CUSIP re-join; retain-and-flag. |
| R5 | Hermetic: excerpt comparison + mutation. EVIDENCE: T13 acceptance command compares the COMPLETE 2026Q2 txt vs pdf raw_rows (count, order, multiplicity, tuples) and ERRORS if either file is absent. |
| R6 | `tests/test_list13f_parse.py` — check-digit non-option 100% / option scoping; duplicate dedup-with-count; disposition partition; parse-coverage ≥99.9%. |
| R7 | `tests/test_list13f_seed.py` — quarter-exact interval resolves as-of; contiguity; authority-window intersection matrix (mid-quarter split, year/leap/boundary cases); replay-zero + different-sha error + `--replace-quarter` supersede; cross-source single security_id order-independent; fail-closed precedence (disputed/ambiguous covering rows ⇒ None, never FTD fallthrough); `resolve_security_name` ⇒ covering list name or None. `tests/test_identity_migration.py` — FK set enumerates `security_list_intervals`; seed-then-revise ≡ revise-then-seed bit-identity incl. a revision-introduced mid-quarter split; post-migration same-SHA replay-zero. `tests/test_identity.py` tuple updated. |
| R8 | `tests/test_list13f_ingest.py` — `select_backfill_quarters` default + override; register records the archive range. |
| R9 | Always-run crafted ≥0.95 + per-period; EVIDENCE: mandatory T13 command (errors on missing inputs) prints exact per-period numerator/denominator/ratio for real Berkshire 2025Q1–2026Q1 on BOTH the fresh and populated-db paths, exits nonzero under 0.95; output verbatim in Dev Notes. |
| R10 | `tests/test_publish.py` — build→publish→production `_resolve_snapshot()` (real client+fetcher inside)→UNMODIFIED dict→`build_server(**resolved)`→both tools; mocking the manifest/client/resolver/provenance forbidden; withheld-path tests still green. |
| R11 | `tests/test_list13f_coverage.py` — uncovered period keeps bit-for-bit FTD-only arithmetic (valid-FTD-no-list test) and the withheld reason names the quarter (brief-amended wording); `resolve_cusip` `None` outside coverage; mutation drops naming and fails. |
| R12 | `make test` green (no regression vs the 1475 baseline); `make security` exit 0; `make accept-m2-5` exit 0 with output in Dev Notes; truth-table/agreement suites untouched; fixes mutation-verified. |

## Rollout / Rollback

- **Rollout**: additive to the ingest/identity layer, with ONE locked operational step (round-4 F14): after the first list seeding on an existing database, **the institutional corpus MUST be re-ingested** before the next build — `security_id` is stamped at ingest (`inst13f.py:1143-1144`), so without re-ingest coverage stays at the pre-M2-5 level and the gate keeps withholding. Locked sequence (EXECUTABLE command forms, round-5 F14): `populus identity bootstrap --db <db> …` (seeds lists) → `populus ingest inst-13f --db <db> --from-cache <dir>` (re-ingest, idempotent — the job is `inst-13f` under the `ingest` group, `cli.py:37,81`; there is no `populus inst ingest` command) → `populus build` → `populus publish`; documented verbatim in the CLI output and Dev Notes, and exercised end-to-end by T13's populated-path scenario. `ensure_registry` creates `security_list_intervals` idempotently. No serving-layer change; the M2-4 lifecycle installs `inst` automatically once the gate passes.
- **Rollback**: revert the branch. With the new table empty (or the seeder not run), `resolve_cusip`'s definitional branch is a no-op, coverage returns to FTD-only (~50%), the gate withholds `inst`, and the withdrawal lifecycle removes it from serving — the exact pre-M2-5 behaviour, still covered by the existing withheld tests. The register/`counsel_flags` additions are inert if unused.

## Simplicity Audit

Minimum coherent design: **four new files** — `parse/list13f.py`, `ingest/list13f.py`, `identity/list13f_seed.py`, `scripts/accept_m2_5.py` — plus additive edits to existing extension points (round-3 F11 corrected the count). New public surface, each with its necessity and the rejected simpler alternative:
- `List13fRecord`, `ParsedList13f` (with pre-dedup `raw_rows`), `Disposition13f` — the R5 full-file gate NEEDS cardinality-preserving raw rows, and counted dispositions are the G3 contract; a bare list of accepted records (simpler) cannot express either.
- `LegendSemantics` + `parse_list13f_legend` — the R4 rule that flag meanings come from the document, fixture-pinned; hard-coding the semantics (simpler) is exactly what R4 forbids.
- `_list13f_anchors`, `_list13f_row_mapper` — the 13F-specific adapter over the generic `extract_positioned`/`_column_of` pair (F10); reusing House's `_header_anchors`/`_Segmenter` (simpler-looking) is impossible — they hard-code House columns.
- `parse_list13f_text`, `parse_list13f_pdf` — the two public parser entry points (T2/T3); a single format-sniffing function (simpler) would blur the R5 gate's two independent sides.
- The fixed-offset module constants (`CUSIP`/`OPT`/`NAME`/`CLASS`/`STATUS`/`TRAIL`, T2) — named constants citing the verified layout; inline magic numbers (simpler) defeat the offsets-cited-not-guessed rule (R3).
- `cusip_check_digit_ok`, `assert_cross_format_identity` — R6/R5 obligations; folding them into the parser (simpler) would make the gate untestable in isolation.
- `counsel_flags(license_id)` helper + the optional `counsel_flags` register field (T1) — the R1 counsel-gate surface; overloading `restrictions` prose (simpler) would make the flag unqueryable.
- `_LiveSource`/`_CacheSource` (list13f), `quarter_from_url`, `quarter_bounds`, `select_backfill_quarters`, `run_list13f_ingest` — mirrors of the proven inst13f shapes; inventing a new shape was rejected.
- `upsert_list_interval`, `bootstrap_13f_list`, `resolve_security_name`, `IDENTITY_SOURCE_PRECEDENCE`, `LIST13F_PROVENANCE`/`LIST13F_LICENSE_ID`, `LIST13F_PARSER_VERSION`/`LIST13F_NORMALIZATION_VERSION` — the R7/§5.1 seeding contract; writing into the shared FTD union (simpler) was rejected as order-dependent and provenance-clobbering.
- `compute_period_coverage`, `PeriodCoverage` — read-only R9/R11 reporting beside the untouched gate; extending `compute_coverage` itself (simpler) risks the frozen decision.
- CLI surface (T9): `--list13f-cache`, `--list13f`, `--list13f-start-quarter`, `--replace-quarter` — the operator path for R8 backfill and the Locked-Decision-11 correction flow; no programmatic-only path (simpler) would leave corrections undocumented.
Rejected abstractions: no provenance-aware union rewrite; no per-period gate engine; no new PDF library; no `security_names` table; no new MCP tool or envelope change (serving untouched); no `NAME_SOURCE_PRECEDENCE` constant (round-4 F13).

## Tech Debt Introduced

- **TD-M2-5-1** — DOWNSTREAM CONSUMPTION only (the R7 name CONTRACT itself is resolved by brief amendment, Locked Decision 10 — not deferred): the recorded canonical name is not yet consumed by `inst_agg` issuer-keying (`inst_agg._issuer_key` `inst_agg.py:99-116`), which still uses the reported-name tier with its filer-to-filer drift. *Owner:* Populus. *Impact:* cross-filer keying is not yet strengthened by the canonical name. *Removal:* wire `resolve_security_name` into the `name` tier of `_issuer_key` in a future aggregate revision.
- **TD-M2-5-2** — `security_list_intervals` stores one row per (CUSIP, quarter); contiguity across consecutive quarters holds at *resolution* but the rows are not physically merged into spanning intervals. *Impact:* more rows; a display/audit consumer wanting spanning intervals must union at read time. *Removal:* an optional read-time union view if a consumer needs it.

Carried, not introduced: TD-M2-1-1 (FTD interval sparsity — the reason the gate withholds today), TD-M2-4-1..3. None dropped or redefined.

## Memory Touch-Points

- `populus-project.md` — Populus redistributes publicly, so the CGS/ABA CUSIP IP notice must be recorded (R1 counsel flag) and no vendor source admitted (G1). Drove Decision 10 and the register content.
- `john-baek-profile.md` — verified-primary-source, decision-record bar: the quarter/check-digit/legend facts are verified against the cached bytes in Current State, not assumed. Drove Decisions 1–3.
- `specify-before-rewriting.md` — the M2-4 multi-source grind; the R7 interaction (`rewrite_identifier_intervals` provenance clobber) is specified up front (Decision 6) rather than patched later.
- `orchestrate-devnotes-fluke.md` — every orchestrated run FATALs on the dev-notes artifact; budget the QA-only recovery (process note, not a code change).
- Shared failure-modes (`~/.claude/skills/_shared/failure-modes.md`): F1 gate-list-completeness (the full standing gate is `make test` + `make security` + `make accept-m2-5`), units/NULL contract, F2 behavioural-test-validity + full-tree lint, F0 verify-don't-assume — all reflected below.

## Failure-Mode Sweep

- **behavioral-test-validity / vacuous tests (F2)** — every behavioural assertion is mutation-verified (reintroduce the defect, watch the specific test fail), per the M2-4 lesson (11 vacuous tests caught there). Applicable.
- **verify-don't-assume (F0)** — quarter identity, check-digit scoping, legend semantics, and duplicate handling are all derived from the cached bytes and the legend page, not from the task text (Decisions 1–4). Applicable.
- **gate-list-completeness (F1)** — the standing gate is `make test` AND `make security` AND `make accept-m2-5`, run synchronously. Applicable.
- **units + NULL/awaiting contract (F1)** — intervals are half-open `[from,to)` dates (G4/G5); `resolve_cusip` returns `None` (fail-closed) outside coverage; `covered_by_list` is an explicit boolean. Applicable.
- **full-tree gate scope (F2)** — new `src/` + `tests/` code is covered by the same `make test`/`make security` scope. Applicable.
- **no-print-secrets (F0)** — no secrets involved; sidecars carry only public SEC URLs/hashes/UA. Non-applicable beyond the standing rule.
- **prod-write / auth (F1)** — no production writes, no auth surface; SQLite seeding only. Non-applicable.
- **connection-pooler / RLS / bulk-SQL** — no Postgres/pooling/RLS; SQLite seeding uses `executemany` batches, not per-row loops. Non-applicable.
- **F5 workflow transport** — orchestrated-artifact plan; DEV rebuilds the gate bundle against the content worktree token after any source repair. Applicable at handoff.

## Definition of Done

- **R1** — `sec-13f-list` register entry validates with `counsel_flags: ["cusip-redistribution"]` and the verbatim CGS/ABA notice; `DATA-LICENSE.md`/`NOTICE` render it; ARCHITECTURE.md §15/§17 name it; `tests/test_licenses.py` green incl. the malformed-flag rejection.
- **R2** — the fetcher uses only `SecClient`; `_FakeSecTransport` test proves fetch→cache→sidecar with sha256==content; transport required; no socket opened.
- **R3** — text parser matches the committed excerpt + golden; offsets are named constants citing the verified layout.
- **R4** — PDF parser reproduces records via M1 x-anchored columns with the 3-token CUSIP re-join; legend semantics asserted from page 1; ≥99.9% parse coverage; unparseable lines flagged not dropped.
- **R5** — `assert_cross_format_identity` passes on 2026Q2 txt vs pdf; the mutation test fails when a record is perturbed.
- **R6** — check-digit scoped to non-option (non-option 100%, options accepted); duplicates deduped-with-count; disposition buckets partition `rows_read`.
- **R7** — quarter-exact intervals resolve as-of; contiguous across quarters; replay-zero; FTD+13f-list on one CUSIP → one security_id, order-independent, no ambiguity; canonical name = the covering list name or `None` (no other source, amended R7); disputed/ambiguous covering list rows resolve to `None` and never fall through to FTD (F12); FTD path untouched; `reconcile_identity_registry` cuts/repoints `security_list_intervals` on a later authority revision, with seed↔revise order convergence proven bit-identical and post-migration same-SHA replay-zero.
- **R8** — backfill selects quarters from the corpus periods (default + override); archive range recorded in the register.
- **R9** — real Berkshire corpus + lists 2025Q1–2026Q1: measured value-coverage ≥0.95 for every covered period, exact per-period figures reported in Dev Notes (not asserted from the task).
- **R10** — build→publish with the gate PASSING admits `inst`; the unchanged M2-4 client installs it; `inst_*` tools answer with `inst_from_published_manifest=True`; withheld-path tests still green.
- **R11** — an uncovered period fails closed and the withheld reason names the uncovered quarter(s); the mutation test fails when naming is dropped.
- **R12** — `make test` green with no regression vs the 1475 baseline; `make security` exit 0; `make accept-m2-5` exit 0 with its output verbatim in Dev Notes; truth-table/agreement suites untouched; every behavioural fix mutation-verified; Changed Files reconciled against `git status`.
