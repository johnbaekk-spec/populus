Below is the complete `plan-v1` artifact for RUN M1-B — Phase A, revised after external plan review round 1 (six blockers) and round 2 (four blockers), all adopted. It is grounded in this repository (real `path:line` citations), reuses the checkpoint-before-bytes pattern rather than forking it, and restores the owner brief's sequencing: **code + hermetic gates, then a live operational Phase A inside this run, then the halt at the Phase A stop point** — Phase B only after the recorded decision. Twenty requirements (R1 … R20) are each enumerated literally in Implementation Tasks, Verification Matrix, and Definition of Done.

---

## Goal and Success Criteria

**Goal.** Execute RUN M1-B **Phase A** end to end: build the code + hermetic acceptance that makes the congressional historical backfill *measurable and resumable*, then — inside this same run, after the hermetic gates and before the run is declared complete — **fetch and ingest the real historical era** (House 2015 + one historical Senate window), report the measured figures the brief names, and **halt at the Phase A stop point so the owner can decide** before any Phase B work begins. Phase B (2013–2025 remainder) is planned and sized here and executed only under the owner's recorded decision.

**Success criteria.**
- `make test` green with **no regressions** on the 1645-test baseline; `make security` (dep_guard) clean; a new synchronous **`make accept-m1-b`** exits 0, hermetic (committed fixtures, zero sockets, never skips), driving the whole chain through **build → publish → verify** with regenerated feed/slices and measured entity/file budgets.
- The House PTR fetch is resumable via **checkpoint-before-bytes provenance sidecars** reusing (not forking) the inst13f pattern, and a House filing is **skipped as settled only when its archived bytes verify**; a re-run over a verified archive performs **zero PTR transport** on a *fresh* database, and a missing or corrupt archive refetches **exactly once** on the *same* database.
- The Senate client gains a **default-inert submitted-date start/end seam** so Phase A can request exactly one historical window instead of "2012 → forever" (empty store) or "watermark → forever" (current store).
- A per-era gate evaluator tracks the **e-file filing census independently of produced rows** and computes the row-level ≥97% metric on the same ruler as the 2026 baseline (`RUN-2-brief.md:20`, `STATUS.md:39`). **Any e-file filing whose expected row count is unknown makes the era's row gate `unmeasurable`** — non-passing, with the decision surfaced — because a single unmeasured filing can hold disproportionately many rows and therefore no percentage of filings can bound true row coverage. The unmeasurable count is severity-ranked so a one-filing unknown reads differently from an era-wide blackout without either being able to pass.
- Per-`(chamber, year)` **member-join coverage** is DB-derived and published additively; the real `congress-legislators` historical inputs are verified, not assumed.
- Both polite fetchers carry **attempt / retry / status counters and monotonic elapsed time**, printed in the summaries, so the Phase A artifact records reproducible request counts, retries, and wall-clock for Phase B sizing.
- The **live operational Phase A** runs inside this run against a Phase A database **resolved from the current published manifest, sha256-verified, and copied through SQLite's backup API**: real House 2015 + the historical Senate window, member join against the real legislators files, the **same acceptance re-run against the real Phase A database** (entity/file counts recorded), and every measured figure the brief names written into the Phase A decision artifact. The run then **halts and reports for the owner decision**; Phase B is authorized only by that recorded decision.

## Requirements

- **R1** — Lift the checkpoint-before-bytes + provenance-sidecar primitives (`_read_checkpoint`, `_commit_checkpoint`, `_sha256`) out of `inst13f.py:117-179` into a light shared module `populus.ingest.checkpoint` (one implementation, two callers); `inst13f` imports them and keeps back-compat aliases. Behaviour-identical; 1645 baseline preserved.
- **R2** — Make the House PTR fetch resumable with per-document provenance sidecars via the shared primitives: checkpoint written atomically **before** bytes; cache-first resume; §5.1 provenance fields recorded (`source_url`, `response_hash`, `retrieved_at`). The yearly-index sidecar gains `response_hash` for §5.1 parity. A non-200 PTR is never checkpointed/archived as durable.
- **R3** — **Settled eligibility depends on verified bytes, not on a database row alone.** `house._ingest_year` today skips any filing whose `raw_path IS NOT NULL` (`house.py:645-655`), so a row whose archive is missing or corrupt is silently skipped forever. Eligibility becomes: `raw_path` present **and** `response_hash` present **and** the archived document exists **and** its recomputed SHA-256 equals the stored `response_hash`. Anything else falls through to the checkpoint-first obtain path and refetches **exactly once**. Proven by: missing bytes and corrupt bytes on the **same** database (one refetch each, no second), and a **fresh-database** zero-transport resume over the verified archive (the `accept_m2_6.py:173-211` shape).
- **R4** — Per-era gate evaluator, DB-derived per `(chamber, year)`, tracking **two independent censuses**: (i) the **e-file filing census** — filings with `source != 'kadoa'` and `parse_status != 'needs_ocr'` — split into measurable (a known expected row count: `row_count` is a positive integer, `load.py:517,637-653`) and **unmeasurable** (expected row count unknown: `parse_status = 'failed'`, or `row_count` NULL or 0); (ii) the **e-file row census** — clean rows / total rows, "clean" via `has_parse_defect` (`normalize.py:11-16,58-60`), the single source of truth, threshold **0.97**, unchanged. **The row gate is `unmeasurable` whenever the era holds even one unmeasurable e-file filing** — the row denominator is then not known, so no row rate may certify the era. A row rate is still computed and printed over the measurable subset, explicitly labelled a floor over a partial denominator, never the verdict. The only n/a status is `no_efile_filings`, which requires the filing census to be exactly zero.
- **R5** — Gate-miss surfacing (non-silent): any era whose status is `miss` or `unmeasurable` emits an explicit `OWNER DECISION REQUIRED` report naming the era, the measured row rate (labelled as a floor when the era is unmeasurable), the unmeasurable filing count and its share, and the three options — (a) era-scoped gates in `stats.json`, (b) parser extension for the old template era, (c) counted `needs_ocr` — and the tooling never silently proceeds to Phase B or weakens the gate (`brief:48-53`). Surfaced eras are **severity-ranked** (unmeasurable share first, then row-rate shortfall, then era size) so a one-filing unknown and an era-wide blackout are visibly different without either being able to pass — ranking is presentation only and never suppresses an era.
- **R6** — `stats.json` per-year extensions, **additive** (existing keys and shape unchanged): a `totals` key carrying the per-`(chamber, year)` e-file gate figures (row rate over the measurable subset, measurable-filing share, unmeasurable count, status) and a second `totals` key carrying per-`(chamber, year)` member-join coverage; `tests/schemas/stats.schema.json` updated in lockstep; byte-stable render preserved.
- **R7** — `needs_ocr` counted per §5.2: historical paper filings → `needs_ocr`, retained with doc link, counted in dispositions, excluded from **both** e-file censuses — proven on the committed 2015 paper fixtures and measured on the real 2015 corpus.
- **R8** — `parser_version` discipline per §9.3: the archive-only reparse-by-version path re-stamps and re-evaluates historical filings with **no re-fetch** (readiness for owner option (b)); no parser fork; **no parser change is made in this run**.
- **R9** — Member-join coverage measured over the historical era via temporal aliases; unjoined filers stay visible + flagged + counted. The mechanism is proven hermetically **and** measured on the real 2015 era in the live Phase A.
- **R10** — Cross-year amendment-pair behaviour measured (Senate): an original/amendment pair spanning a year boundary links (`supersedes`), both sides carry `amendment_unresolved`, and `v_default_transactions` excludes the original (no double count). Proven hermetically and measured live. No amendment-semantics change (non-goal honored).
- **R11** — `make accept-m1-b`: synchronous hermetic acceptance (committed fixtures incl. real 2015 samples, zero sockets, never skips) proving the whole Phase A chain — discover → verified-settled + resumable fetch (+sidecars) → evaluate → load → member-join → amendment-pair → per-era gate eval → gate-miss surfacing → `stats.json` render/validate → build → publish → verify → consumer + budget assertions → fresh-database zero-transport resume sub-proof. It asserts the **chain + gate/surfacing behaviour** (both above and, via a crafted sub-gate era and a crafted zero-row era, below), **not** that the fixtures meet ≥97%.
- **R12** — Phase B planned + sized with truthful bounded-N request arithmetic (House + Senate per-source floors) and **gated behind the recorded Phase A decision**: it is not executed in this run, and the plan states the exact authorization condition rather than assuming one.
- **R13** — Gates green: `make test` (1645, no regressions), `make security` (dep_guard, no new deps), `make accept-m1-b`. Every behavioural fix mutation-verified; Changed Files reconciled against `git status`; deviations stated, never absorbed.
- **R14** — **Senate submitted-date window seam, default-inert.** `_index_post_body` hard-codes `"submitted_end_date": ""` (`senate.py:398`) and `run_senate_ingest` always derives the start from the watermark (`senate.py:838`, `senate.py:504-519`), so the client can request only "2012 → forever" or "watermark → forever" — it cannot execute a one-year Phase A. Thread an optional `submitted_start_date` / `submitted_end_date` (MM/DD/YYYY) through `_index_post_body` → `discover` → `run_senate_ingest`, defaulting to today's exact behaviour (derived start, empty end string). Expose `--submitted-start` / `--submitted-end` on `populus ingest congress-senate`. Tests prove: the start bound is sent, the end bound is sent, both bounds together select exactly the window, and with neither option the request body is **byte-identical** to today's watermark behaviour.
- **R15** — **Per-`(chamber, year)` member-join coverage measurement.** `stats.py:175` publishes only an aggregate primary join rate, so modern rows mask unresolved historical filers. Add a DB-derived per-era join report (filings joined/total/unresolved and rows joined/total, per `(chamber, year)`, primary sources only), surface it in the gate report and additively in `stats.json` (R6), and record the exact read-only cross-check query in the runbook. Verify the real `congress-legislators` historical inputs (`legislators-historical.yaml` present and carrying terms overlapping the era, `members.py:148-149`) before the era join is measured.
- **R16** — **Acceptance extended to publication, consumer-contract-aware.** The acceptance chain continues past `stats.json` through local **build → publish → verify** (`LocalDirBackend`, the `accept_m2_6.py:103-116` shape) and asserts the regenerated consumers (`build.py:1594-1646`) against their *actual* contracts: `congress/feed.json` is the **latest 500 rows by filed date** (`FEED_LIMIT = 500`, `build.py:81,1445-1454`), so it is asserted to match the database's expected latest-500 **exactly** — same `txn_id` set, same order — and is **never** asserted to contain an era row, which on a current corpus it cannot. Historical-row publication is proven instead by (i) the per-era `stats.json` keys (R6) carrying the era's filings and rows and (ii) **selected member/ticker slices that do carry era rows**, where the selection is DB-derived (entities whose latest-`SLICE_LIMIT` window contains ≥1 era row, mirroring `_feed_rows`) so the assertion is exact on both the fixture corpus and the enlarged real corpus. It also measures the entity/file budgets — member pages, ticker pages, total published files — against the §9.10 assumptions (~700 members, ~2,500 tickers) and the **hard ≤4,000-file M1 budget** (`ARCHITECTURE.md:582`), failing above the cap. Hermetic; zero sockets.
- **R17** — **Live operational Phase A, inside this run, on an explicitly resolved database.** After the hermetic gates pass and before the run is declared complete, an explicit operator stage first **resolves the canonical corpus from the current published manifest** — `latest.json` → `builds/<build_id>/manifest.json` → the `congress.db` artifact entry (`manifest.py:29`) → the asset at `releases/data-<build_id>/congress.db` (`build.py:236-258`) — **sha256-verifies it against that manifest entry**, copies it to `ops/m1-b/phase-a.db` through **SQLite's backup API** (the pattern `run_build` already uses at `build.py:1565-1576`), and asserts `PRAGMA integrity_check` plus the expected current-corpus row counts (filings, transactions, `v_default_transactions`) against the manifest-listed `stats.json` **before any ingestion**. There is no bare `populus.db` assumption: a missing or mismatching source is a hard stop, not an ad-hoc fresh database. The stage then fetches and ingests the real era into that copy: House **2015** (728 PTRs, `brief:18-24`) and the Senate window **01/01/2015 → 03/31/2016** (one historical year plus the Q1 amendment tail that makes cross-year pairing observable), then the real member join, `populus stats`, and the gate report. The measured figures the brief names — e-file/paper mix, parse coverage against ≥97%, per-era member-join coverage, cross-year amendment pairs, per-era disposition counts — are recorded verbatim in the Phase A decision artifact. Automated tests and gates stay hermetic (`conftest.py:14-28` blocks sockets in pytest); this stage is an operator-run CLI sequence, not a test.
- **R18** — **The same acceptance, re-run against the real Phase A database.** `scripts/accept_m1_b.py` exposes one shared assertion body used by two modes: hermetic fixtures (R11/R16, the `make accept-m1-b` gate) and `--db/--raw-root/--data-repo` against the real Phase A corpus. Because every consumer assertion is written against the published contract rather than against fixture-shaped data (R16), the body passes on a correctly generated enlarged corpus and can only fail on a real defect. The live run records the measured entity counts (members, tickers), the published file count against the ≤4,000 budget, the verify result, and the resume/transport counters before the run closes.
- **R19** — **The Phase A stop point.** With R17 and R18 complete, the run **halts and reports for the owner decision**: it prints/records the gate report, the decision artifact path, and the three options, and it performs no Phase B work. The run's completion condition is "Phase A measured, artifact written, halted at the stop point" — never "gate missed, proceeded anyway". Phase B begins in a subsequent operation authorized by the owner's recorded decision (R12).
- **R20** — **Request / retry / wall-clock instrumentation on both polite fetchers.** Today neither `house._PoliteFetcher` (`house.py:90-131`) nor `senate._PoliteSession` (`senate.py:186-264`) counts anything: every attempt, backoff retry, and status is invisible, so the figures stage B must record cannot be produced. Following the `inst_bulk.CountingTransport` pattern (`inst_bulk.py:713-740`: `attempts` = every request that left the process, retries included; `status_counts` a `Counter`; `retries` derived from the 429/5xx answers that triggered a backoff), give both fetchers `attempts`, `status_counts`, a derived `retries`, and a `backoff_sleep_s` total, surface them on `IngestReport` / `SenateIngestReport`, and capture **monotonic elapsed** per run from the already-injected `monotonic` callable (never the wall clock; `None` in cache mode where no clock is injected). `format_summary` prints attempts / retries / status mix / elapsed for both chambers. Tests cover the **retry path** (429 then 200 → attempts 2, retries 1, one backoff sleep) and the **no-retry path** (200 → attempts 1, retries 0, no sleep), plus elapsed derived from an injected fake `monotonic`. These figures land in the Phase A artifact and are the basis of the Phase B sizing arithmetic.

## Scope

- House PTR fetch (`src/populus/ingest/house.py`) made resumable with checkpoint-before-bytes provenance sidecars and **verified-archive settled eligibility**, reusing the lifted shared primitives (R1, R2, R3).
- A default-inert submitted-date window seam in the Senate client + CLI (R14).
- A new pure per-era gate evaluator (`src/populus/parse_gate.py`) with an independent e-file filing census + per-era member-join coverage, plus gate-miss surfacing wired into `format_summary` and `stats.json` (R4, R5, R6, R15).
- Reuse/verification of existing capabilities for the historical era: `needs_ocr` counting (R7), `parser_version` archive-only reparse discipline (R8), member-join via temporal aliases (R9), Senate cross-year amendment pairing (R10).
- `scripts/accept_m1_b.py` + `tests/test_accept_m1_b.py` + `make accept-m1-b` + committed era fixtures, driven through build → publish → verify + consumer/budget assertions (R11, R16).
- Attempt / retry / status / monotonic-elapsed instrumentation on both polite fetchers, surfaced in the reports and summaries (R20).
- A small `scripts/phase_a_snapshot.py` that resolves the published corpus from the manifest, sha256-verifies it, backup-copies it, and asserts integrity + expected counts (R17).
- **The live operational Phase A stage inside this run** (R17), its acceptance re-run on the real corpus (R18), the decision artifact, and the halt at the stop point (R19).
- Plan + sizing of Phase B, gated behind the recorded decision (R12).

Smallest coherent slice for the *code* = **four modules**: (1) resumable House fetch + verified-settled + shared checkpoint primitive; (2) Senate window seam + fetcher counters; (3) per-era gate + join-coverage evaluator + stats extension; (4) hermetic acceptance through publication + fixtures (plus the snapshot resolver it shares with stage B). Everything else is reuse/verification. The live Phase A adds no modules — it is the run's own operational stage using exactly that tooling.

## Non-goals

- **No OCR.** Paper stays `needs_ocr` — retained, counted, honest (`brief:76-78`, §5.2).
- **No new sources, no register changes** (House Clerk, Senate eFD, kadoa, congress-legislators all registered) (`brief:79-80`).
- **No dashboard code** (P3 separate) (`brief:81-82`).
- **No amendment-semantics changes**; the unresolved-pair rule stands; no House PTR amendment linkage is added (`brief:83-84`, §9.5).
- **No parser change** in this run; only the reparse machinery is verified ready. A parser extension (option b) is a contingent follow-up run.
- **No live network inside pytest or any `make` gate** — the autouse socket guard stands. The live Phase A (R17) is a separate, explicitly invoked operator stage of this run.
- **No Phase B execution in this run**: the 2013–2025 remainder waits on the recorded decision (R12, R19).
- **No DB schema migration**; `filings`/`transactions`/`ingest_runs` unchanged.
- **No production-database mutation**: the live Phase A works on a copy (`ops/m1-b/phase-a.db`), never on the canonical `populus.db` in place.

## Constraints

- Planning phase is read-only; repo writes and state-changing commands are denied. No `ExitPlanMode`.
- Hermetic tests: the autouse `tests/conftest.py::_no_network` guard (`conftest.py:14-28`) blocks sockets; **acceptance must depend only on committed `tests/fixtures/`** — `data-cache/` is gitignored (`.gitignore:1`), so it must not be a dependency of any test/acceptance. The live Phase A therefore cannot be a pytest, and is scheduled as an operator stage instead (R17).
- Library code never reads the wall clock/RNG: `now`/`run_id`/`host`/`sleep`/`monotonic`/`jitter` are injected (matches `house.py`, `senate.py`, `inst13f.py`).
- Politeness floors are in code, never config (G6), and are **unchanged**: House `MIN_SPACING_S = 0.25` (`house.py:53`); Senate `MIN_SPACING_S = 2.0` + jitter (`senate.py:60`).
- `has_parse_defect` is the single source of truth for "clean" (`normalize.py:11-16`) — the gate metric must not reimplement the flag taxonomy in SQL.
- The gate threshold stays **0.97**, unchanged, and applies to the **row census**; the filing census does not carry a threshold — it determines whether the row denominator is knowable at all (R4, LD10) — so the review's fix adds a dimension, never a looser number.
- `stats.schema.json` is `additionalProperties:false` throughout — any new key requires a lockstep schema update or `test_stats` fails.
- Runner is `uv`; canonical gates are `make test`/`make security` (`Makefile:22,28-29`); accept targets depend on `sync` to run in the frozen-lockfile env (`Makefile:48`).
- The live Phase A is bounded by the politeness floors and is resumable; it must be safe to interrupt and re-run (that is exactly what R3 buys).

## Current State

- **House ingest** (`house.py`) already ingests any year via `run_house_ingest(years=[…], cache_dir=…)`; discovers the `<YEAR>FD.zip` index (conditional-GET, `house.py:228-306`), filters `FilingType=='P'` (`house.py:191`), fetches PTR PDFs to `pdfs/<year>/<DocID>.pdf` (`house.py:681-708`), classifies e-file/paper (paper → `needs_ocr`, `house.py:349-360`), and reconciles per year. Resume today is **DB-level only** — `settled` = filings with `raw_path IS NOT NULL` (`house.py:645-655`), computed *before* `_obtain_document` can inspect any bytes, so a row with a missing or corrupt archive is skipped forever. There is **no per-document checkpoint sidecar**; the only index sidecar is `<YEAR>FD.zip.meta.json` = `{etag,last_modified}` (`house.py:266,297-305`). `filings.response_hash` **is** already stored per document (`house.py:762-764`), which is what makes verified-settled eligibility (R3) cheap to implement.
- **Senate ingest** (`senate.py`) backfills from a *derived* start only: empty store → `BACKFILL_START = date(2012,1,1)`, otherwise `MAX(filed_date) − 90 days` (`senate.py:504-519`), and the POST body pins `"submitted_end_date": ""` (`senate.py:398`). There is **no way to request a bounded historical window**; cache mode reads `<cache>/ptr-index.json` + `pages/<kind>_<uuid>.html` (`senate.py:430-441`). Cross-year amendment pairing already links on `title_date` reaching stored filings (`senate.py:1018-1066`). `--year` is explicitly rejected for `congress-senate` (`cli.py:186-190`).
- **stats.json** (`stats.py:196-224`) already emits `parse_coverage_primary_by_chamber_year_including_excluded` (per chamber×year×`parse_status` counts + `total`) and `needs_ocr_filing_count_including_excluded`. Join coverage is **aggregate only** (`stats.py:154-182`): `primary_rows`/`primary_joined`/`primary_join_rate` over the whole corpus, plus a by-source split — nothing per era. `v_default_transactions` carries `chamber`, `filed_date`, and `bioguide_id` (`schema.sql:62-72`), so a per-era join measurement is a pure query away.
- **The ≥97% gate is not encoded anywhere** (no `0.97` constant in `src/populus`). `format_summary` computes the e-file clean-row rate (`house.py:961-967`, `senate.py:1187-1194`) but never compares it to a threshold or surfaces a decision.
- **Checkpoint-before-bytes** exists only inside `inst13f.py`: `_read_checkpoint`/`_commit_checkpoint` (`inst13f.py:117-179`) write the expected hash to a `fetch-meta.json` sidecar via `atomic_write_bytes` **before** bytes land; `_LiveSource._obtain_resumable` resumes cache-first with a non-200 guard (`inst13f.py:347-409`). These helpers are generic in shape but inst-private; **no test imports them by name** (verified) → safe to lift.
- **Publication** already emits `congress/stats.json`, `congress/feed.json` (`FEED_LIMIT = 500`), per-member and per-ticker slices (`SLICE_LIMIT = 200`) from `v_default_transactions` (`build.py:1592-1646`), and `run_verify` recomputes hashes/digests (`build.py:2274-2288`). `accept_m2_6.py:103-116` already demonstrates hermetic local build → publish; nothing yet measures the M1 page budget against `ARCHITECTURE.md:582`.
- **Baseline:** `uv run pytest --collect-only -q` → 1645 tests. No `scripts/accept_m1_b.py` or `accept-m1-b` target exists yet.

## Detected Stack

- Python 3.12, `uv`-managed (`pyproject.toml`, `.python-version`); SQLite canonical store; published artifacts are the API (DR-3/DR-4).
- Test runner: `pytest` via `uv run pytest -q` (`Makefile:22`, `pyproject.toml` `testpaths=["tests"]`); `jsonschema` (dev) for schema validation.
- Security gate: bespoke stdlib `scripts/dep_guard.py` (paid-vendor denylist, G1) — **not** bandit/pip-audit; no new dependency will be added (keeps it green).
- Ingest libs: `httpx` (only in `ingest/house.py`, `ingest/senate.py`), `lxml`, `pdfplumber`/`pypdf` (`parse/house_ptr.py`), CLI `click` (`cli.py`).
- Publication: `populus.publish.build` (`run_build`/`run_publish`/`run_verify`, `LocalDirBackend`); durable writer `populus.publish.atomic_write_bytes` (`publish/__init__.py:20`). Shared ingest identity: `populus.ingest` (`TransportResponse`, `USER_AGENT`, `archive_path`, `UnsafeArchivePathError`).

## Reuse Map

| Need | Reuse (path) | How |
|---|---|---|
| Checkpoint-before-bytes + sidecar | `inst13f.py:117-179` `_read_checkpoint`/`_commit_checkpoint` | **Lift** into `populus.ingest.checkpoint` (R1); House + inst13f both call it |
| Atomic durable write | `publish/__init__.py:20` `atomic_write_bytes` | Sidecar + any file write |
| Transport/path identity | `populus.ingest` `TransportResponse`/`archive_path`/`UnsafeArchivePathError` | House already uses; sidecar path built from a validated DocID (`house.py:545-553`, `house.py:171`) |
| Stored per-document hash | `filings.response_hash` (`schema.sql:36`, written at `house.py:762-764`) | The oracle for verified-settled eligibility (R3) — no new column |
| Per-era coverage w/ threshold + flag | `inst13f.py:1241-1315` `PeriodCoverage`/`compute_period_coverage` | Pattern mirror for `parse_gate.compute_parse_gate` (R4) |
| "clean" definition | `normalize.py:29-60` `PARSE_DEFECT_FLAGS`/`has_parse_defect` | Gate metric reuses it (no SQL reimpl) |
| Per-year disposition counts | `stats.py:196-209` | Auto-extends by year; additive keys beside it (R6) |
| Aggregate join coverage shape | `stats.py:154-182` | Per-era analogue reuses the `_rate` helper + `v_default_transactions` (R15) |
| Byte-stable render | `stats.py:291-293` `render_stats` | Unchanged |
| e-file clean-row counters | `house.py:471-486,961-967`; `senate.py:1187-1194` | Feed the per-run gate line in `format_summary` (R5) |
| Archive-only reparse by version | `house.py:813-905` `select_reparse_targets`/`reparse_house`; CLI `cli.py:584-615` | R8 readiness (no fork) |
| Member-join via temporal aliases | `members.py:323-463` `MemberResolver`, `645-704` `apply_member_join`, `556-577` house hints | R9, R15 |
| Legislators historical input | `members.py:148-149` `legislators-historical.yaml` loader; `cli.py:318-322` | R15 verification step |
| Senate cross-year pairing | `senate.py:1018-1066` `_link_amendments`; `amendments.py` `flag_unresolved_pair_rows` | R10 (no change) |
| Hermetic acceptance skeleton | `scripts/accept_m2_6.py:42,59,214,316`; `tests/test_accept_m2_6.py`; `Makefile:48-49` | Model for `accept_m1_b.py` trio (R11) |
| Local build → publish in-acceptance | `accept_m2_6.py:103-116` `_build_and_publish` + `LocalDirBackend` | Extended with `run_verify` + consumer/budget checks (R16) |
| Fresh-DB zero-transport resume proof | `accept_m2_6.py:173-211` `_resume_zero_transport`; `CountingTransport` `inst_bulk.py:713` | House fake transport + the R3 fresh-database proof |
| Operational runbook shape | `RUN-M2-6-plan.md` Rollout (numbered, exact commands, measured figures recorded) | Model for the live Phase A stage (R17, R18, R19) |
| Synthetic amendment index rows → committed pages | `test_senate_ingest.py:134-140,1251-1277` | Cross-year pair fixture without new page HTML (R10/R11) |

**Not reused:** the `inst_bulk` per-filer **journal** envelope (`inst_bulk.py:623-707`) — House needs per-document checkpoint sidecars, not a coordinator journal; the per-year index bounds the work and verified-settled eligibility gives run-level resume. Adding a journal would be over-engineering.

## Architecture

**1. Shared checkpoint primitive (R1).** New `src/populus/ingest/checkpoint.py` exposes pure functions: `read_checkpoint(meta_path, doc_key) -> (response_hash|None, retrieved_at|None)`, `commit_checkpoint(meta_path, doc_key, *, url, response_hash, retrieved_at)`, `sha256_hex(bytes)` — moved verbatim from `inst13f.py:104-179`, depending only on stdlib + `atomic_write_bytes`. `inst13f.py` imports them and defines `_read_checkpoint = read_checkpoint`, `_commit_checkpoint = commit_checkpoint`, `_sha256 = sha256_hex` (back-compat aliases; internal call sites repointed).

**2. Resumable House PTR fetch + verified-settled eligibility (R2, R3).**
`house._obtain_document` (live branch, `house.py:701-708`) becomes checkpoint-first, cache-first, mirroring `inst13f._obtain_resumable` (`inst13f.py:347-409`): sidecar path `pdfs/<year>/<DocID>.pdf.fetch-meta.json` (single-doc slot, `doc_key=None`) built only from a validated DocID; bytes present + hash matches → return from disk (zero transport); mismatch/absent → fetch; on 200 → `commit_checkpoint(...)` (atomic) **then** `atomic_write_bytes(pdf)`; a non-200 returns `None` and is **never** checkpointed/archived (mirrors `inst13f.py:389-397`) so a 404 never freezes as a durable empty file. Cache-mode is unchanged. The index sidecar `<YEAR>FD.zip.meta.json` additionally records `response_hash` of the ZIP (additive); `stats.read_house_meta` (`stats.py:45-65`, reads only `last_modified`) is unaffected.

The `settled` set in `_ingest_year` (`house.py:647-655`) is replaced by a per-DocID predicate:

```
archive_verified(root, relpath, expected_hash) ->
    expected_hash is not None
    and (root / relpath).is_file()
    and sha256_hex((root / relpath).read_bytes()) == expected_hash

settled(doc_id) ->
    row = SELECT raw_path, response_hash FROM filings WHERE filing_id = 'house:<doc_id>'
    row is not None and row.raw_path is not None
    and archive_verified(raw_root_or_cache_dir, row.raw_path, row.response_hash)
```

The one query stays a single pre-pass (`SELECT filing_id, raw_path, response_hash FROM filings`), so the DB cost is unchanged; the added cost is one archive read + hash per candidate. Measured shape: 728 PTRs ≈ 100–150 MB of local reads per Phase A re-run — bounded, and the price of never silently skipping a corrupt document. Counters `settled_verified` / `settled_reobtained` are added to `YearReport` so the acceptance and `format_summary` can assert and print them.

**3. Senate submitted-date window seam (R14).** `_index_post_body(token, *, submitted_start_date, submitted_end_date, start)` sets `"submitted_end_date": submitted_end_date or ""` — with no argument the body is byte-identical to today. `discover(..., submitted_start_date=None, submitted_end_date=None)` threads it; `run_senate_ingest(..., submitted_start_date=None, submitted_end_date=None)` uses the explicit values when given and otherwise calls `_submitted_start_date(conn)` exactly as now (`senate.py:838`). CLI gains `--submitted-start` / `--submitted-end` (MM/DD/YYYY, `congress-senate` only, rejected for other jobs and validated for shape). Because the incremental window is derived as `MAX(filed_date) − 90d`, inserting *older* filings cannot regress it — a historical window is safe to run against a current corpus, and that invariant is asserted by a test.

**4. Per-era gate + join-coverage evaluator (R4, R5, R15).** New `src/populus/parse_gate.py`:

```
GATE_THRESHOLD = 0.97
@dataclass EraParseCoverage:
    chamber; year
    efile_filings; measurable_efile_filings; unmeasurable_efile_filings
    efile_filing_measurable_rate|None      # severity figure, NOT a gate threshold
    efile_rows; clean_efile_rows; efile_parse_rate|None
    row_denominator_known: bool            # False ⇒ efile_parse_rate is a floor
    needs_ocr_filings
    status: 'pass' | 'miss' | 'unmeasurable' | 'no_efile_filings'
    meets_gate: bool
    severity: float                        # ranking only; never suppresses an era
@dataclass EraJoinCoverage:
    chamber; year; filings; filings_joined; filings_unjoined
    rows; rows_joined; join_rate|None; unresolved_filers: tuple[str, ...]
@dataclass ParseGateReport:
    eras: tuple[EraParseCoverage, ...]
    join: tuple[EraJoinCoverage, ...]
    owner_decision_required: bool
compute_parse_gate(conn, *, threshold=GATE_THRESHOLD) -> ParseGateReport
format_gate_decision(report) -> str   # 'OWNER DECISION REQUIRED …' when any era is miss/unmeasurable
```

The **filing census** comes from `filings` (`source != 'kadoa'`, `parse_status != 'needs_ocr'`), grouped by `(chamber, substr(filed_date,1,4))`. A filing is **measurable** only when its expected row count is known — `parse_status != 'failed'` **and** `row_count` is a positive integer (persisted at `load.py:517,637-653`); a `failed` filing, a NULL `row_count`, and a zero `row_count` all mean the true denominator for that document is unknown. The **row census** reads e-file transaction rows joined to their filing and computes clean/total with `has_parse_defect` in Python — necessarily over the measurable subset only. Status:

| condition | status | `meets_gate` | decision surfaced |
|---|---|---|---|
| `efile_filings == 0` | `no_efile_filings` | True (n/a) | no |
| `unmeasurable_efile_filings > 0` (any unknown denominator) | `unmeasurable` | False | yes |
| all filings measurable and row rate `< 0.97` | `miss` | False | yes |
| all filings measurable and row rate `>= 0.97` | `pass` | True | no |

There is **no tolerance band on unknown denominators**: one unmeasured filing may hold disproportionately many transactions, so no share of measurable *filings* can bound true *row* coverage, and the row gate must not certify an era it cannot count. `row_denominator_known = (unmeasurable_efile_filings == 0)`; when it is False the printed `efile_parse_rate` is labelled a floor over a partial denominator. `efile_rows == 0` with `efile_filings > 0` therefore cannot pass — every such filing is unmeasurable by construction. `owner_decision_required = any(era.status in ('miss','unmeasurable'))`. `severity = unmeasurable share, then row-rate shortfall, then era size`, used only to order the surfaced eras so a one-filing unknown and an era-wide blackout read differently (banner fatigue is a presentation problem, never a gating one). `format_gate_decision` renders the era, the measured (or floor) row rate, the unmeasurable count and share, and options a/b/c verbatim from `brief:49-53`. `compute_join_coverage` (same module) groups `filings` and `v_default_transactions` by `(chamber, substr(filed_date,1,4))` over primary sources, counting `bioguide_id IS NOT NULL`, and lists the era's unresolved filer names. Both are surfaced in `house.format_summary`/`senate.format_summary` and by the acceptance.

**5. stats.json per-year extensions (R6).** `compute_stats` adds two additive `totals` keys sourced from `parse_gate`: `efile_parse_gate_by_chamber_year_including_excluded` = `{chamber:{year:{clean_efile_rows, efile_rows, efile_parse_rate, row_denominator_known, efile_filings, unmeasurable_efile_filings, efile_filing_measurable_rate, status, meets_gate}}}` and `member_join_primary_by_chamber_year_including_excluded` = `{chamber:{year:{filings, filings_joined, rows, rows_joined, join_rate}}}`. Existing keys/shape untouched; `render_stats` byte-stability preserved; `stats.schema.json` gains both keys (`additionalProperties:false` respected).

**6. Acceptance (R11, R16, R18).** `scripts/accept_m1_b.py` has **one** assertion body and two entry points:

```
assert_corpus(conn, *, raw_root, data_repo, out) -> bool   # shared, mode-independent
run_acceptance(out=print) -> int                            # hermetic fixtures (make accept-m1-b)
run_operational_acceptance(db, raw_root, data_repo, out=print) -> int   # real Phase A corpus
```

Hermetic mode, on committed fixtures in tempdirs: (1) build a House 2015 corpus from a committed minimal `2015FD.index.xml` (naming the 6 committed DocIDs) served with committed PDF bytes through a `_FakeHouseTransport`; run `run_house_ingest(years=[2015], raw_root=tmp, transport=…)` → sidecars checkpoint-first; (2) corrupt one archived PDF and delete another, re-run on the **same** DB with a `CountingTransport` → assert exactly two fetches and no third (R3); (3) re-run on a **fresh** DB over the verified archive → assert **zero** PTR transport and a fully reloaded corpus (R3, the `accept_m2_6.py:173-211` shape); (4) build a Senate historical corpus in a temp cache dir from a committed `hist-ptr-index.json` (e-file + paper + a **cross-year** pair) + committed `pages/` → `run_senate_ingest(cache_dir=…)`; assert the cross-year pair links and `v_default` excludes the original (R10); assert the live-mode window seam sends both bounds through a fake transport (R14); (5) seed members/aliases; `apply_member_join`; assert per-era join coverage reported and unjoined visible+flagged (R9, R15); (6) `compute_parse_gate` → print measured figures; drive a **crafted sub-gate era** and a **crafted zero-row e-file era** and assert `owner_decision_required` + the options string for both (R4, R5); (7) `compute_stats` → `render_stats` → schema-validate (R6); (8) `run_build` → `run_publish` → `run_verify` on a `LocalDirBackend` repo, then the **consumer-contract assertions** below; (9) measure and print `member_pages`, `ticker_pages`, `published_files` and assert `published_files <= 4000` (R16). It asserts the **chain + gate/surfacing**, never "fixtures ≥97%".

Step (8)'s consumer assertions are written against the published contracts, so they hold identically on the fixture corpus and on the enlarged real corpus (R16, R18):

```
# feed = the latest 500, exactly — NOT "contains an era row"
expected = conn.execute(
    "SELECT txn_id FROM v_default_transactions"
    " ORDER BY filed_date DESC, transaction_date DESC, txn_id LIMIT 500").fetchall()
assert [r["txn_id"] for r in feed["rows"]] == [t for (t,) in expected]

# historical publication, proven where it is actually observable:
#  (a) the per-era stats keys carry the era's filings and rows (R6)
#  (b) slices whose own latest-200 window contains an era row
era_members = conn.execute(
    "SELECT bioguide_id FROM (SELECT bioguide_id, filed_date,"
    "  ROW_NUMBER() OVER (PARTITION BY bioguide_id"
    "    ORDER BY filed_date DESC, transaction_date DESC, txn_id) AS rn"
    "  FROM v_default_transactions WHERE bioguide_id IS NOT NULL)"
    " WHERE rn <= 200 AND substr(filed_date,1,4) = ? GROUP BY bioguide_id", (ERA,))
# for each: the slice file exists and its rows include that era row (same for tickers)
```

`feed.json`'s 500-row latest-first contract (`build.py:81,1445-1454`) means a 2015 row can never appear in it on a current corpus; asserting otherwise would fail a correctly generated operational corpus, so the exact-match check replaces it and the era evidence moves to stats + the qualifying slices. If **no** entity qualifies on the real corpus, that is reported as a measured finding in the Phase A artifact (the era published no per-entity slice rows) rather than a false acceptance failure.

Operational mode runs steps (6) through (9) — the corpus-level assertions — plus the verified-settled/zero-transport counters, against the real Phase A database and archive, printing every measured number. `tests/test_accept_m1_b.py` is a thin importlib wrapper over `run_acceptance`.

**7. Fetcher instrumentation (R20).** Both fetchers gain `attempts`, `status_counts: Counter`, a derived `retries` property (the 429/5xx answers that triggered a backoff), and `backoff_sleep_s`, incremented inside their existing retry loops (`house.py:111-131`, `senate.py:232-264`) — the same shape as `inst_bulk.CountingTransport` (`inst_bulk.py:713-740`), which counts every request that left the process rather than wrapping the HTTP library. `run_house_ingest`/`run_senate_ingest` read `monotonic()` (already injected; `None` in cache mode) at entry and at every exit path, storing `elapsed_s` on the report alongside the counters, and `format_summary` prints `attempts / retries / status mix / backoff_sleep_s / elapsed_s` per run. No wall clock is read and no politeness constant changes.

**8. Phase A snapshot resolution (R17).** `scripts/phase_a_snapshot.py` resolves the corpus rather than assuming a path: read `<data_repo>/latest.json` → `builds/<build_id>/manifest.json` → the `congress.db` artifact entry (`manifest.py:29`, entry carries `sha256` + `bytes`, written at `build.py:1773-1774`) → the asset at `releases/data-<build_id>/congress.db` (`build.py:236-258`); **sha256 + size must equal the manifest entry** or the script exits nonzero. It then opens the verified asset read-only and writes `ops/m1-b/phase-a.db` through `source.backup(destination)` — the same SQLite backup API `run_build` uses (`build.py:1565-1576`) — and asserts on the copy: `PRAGMA integrity_check == 'ok'`, plus `filings`, `transactions`, and `v_default_transactions` counts equal to the manifest-listed `congress/stats.json` figures. Any mismatch is a hard stop before ingestion.

**9. Live Phase A stage + stop point (R17, R18, R19).** An operator stage of this run (exact commands in Rollout), writing `docs/build/RUN-M1-B-phase-a.md` — the decision artifact — with the measured e-file/paper mix, the per-era gate figures against 0.97 (row rate, unmeasurable count/share, status), per-era member-join joined/total/unresolved, cross-year amendment pairs found, disposition counts, entity/file counts vs the ≤4,000 budget, and the R20 request counts, retries, status mix, and elapsed. The run then **halts and reports for the owner decision**, listing options a/b/c; no Phase B command is issued by this run under any measured outcome.

## Locked Decisions

- **LD1 (gate metric).** Row gate = clean e-file transaction rows / total e-file transaction rows per `(chamber, year)`, "clean" via `has_parse_defect`; `needs_ocr`/`kadoa` excluded; threshold **0.97**, unchanged. Chosen to match the 2026-corpus precedent (`RUN-2-brief.md:20` "≥97% of e-filed **rows** parsed clean"; `STATUS.md:39` "97.5% … on the real 312-PTR 2026 corpus") so historical eras are measured on the **same ruler**.
- **LD2 (reuse, not fork).** Lift `_read_checkpoint`/`_commit_checkpoint`/`_sha256` into `populus.ingest.checkpoint`; inst13f imports + keeps `_`-aliases. House imports the **shared module, never `inst13f`** (avoids coupling the congressional module to the SEC/parse stack).
- **LD3 (House sidecar shape).** Per-document `pdfs/<year>/<DocID>.pdf.fetch-meta.json` = `{source_url, response_hash, retrieved_at}`; checkpoint atomic **before** bytes; cache-mode writes no sidecar; index sidecar gains `response_hash` (additive).
- **LD4 (acceptance semantics).** `accept-m1-b` asserts the chain + gate evaluation + gate-miss surfacing (above the gate, below the gate, and unmeasurable) + resume behaviour + build/publish/verify + budgets — it does **not** assert the fixtures meet ≥97%. This is the deliberate difference from `accept-m2-6` (which asserts its coverage gate passes), because a below-gate era is a *surfaced decision*, not a build failure ("surface, don't decide", `brief:48-53`).
- **LD5 (run sequencing — the brief's shape, restored).** This run has three stages in order: **(A) code + hermetic gates** (`make test`, `make security`, `make accept-m1-b`, all socket-free); **(B) the live operational Phase A** — real House 2015 + the real Senate historical window, real member join, the same acceptance re-run on the real corpus, measured figures recorded (R17, R18); **(C) the stop point** — the run halts and reports for the owner decision, and does no Phase B work (R19). Phase B is a later operation authorized by that recorded decision. The hermetic constraint applies to *tests and gates*, not to the run: stage B is an operator-run CLI sequence outside pytest, which is how M2-6 also ran its real operation.
- **LD6 (non-goal fences).** No House amendment linkage, no new sources/registers, no OCR, no dashboard code, **no parser change** this run. The reparse-by-version machinery is verified ready; a 2015 parser extension (option b) is a contingent follow-up.
- **LD7 (Senate scope).** The Senate needs exactly one code change — the default-inert window seam (R14) — and no other. Resumable-sidecar scope stays **House-only**. Senate multi-session resume continues to use the DB watermark + 90-day rescan (`senate.py:504-519`), which the seam leaves untouched when its options are absent.
- **LD8 (the Phase A Senate window).** `01/01/2015 → 03/31/2016`: one historical year on the same era as the House year, plus the Q1-2016 tail, because a 2015 original's amendment is *submitted* in 2016 and a 2015-only window could never observe the cross-year pair the brief asks Phase A to measure. Era figures are reported per `(chamber, year)`, so 2016 appears as an explicitly labelled partial window in the decision artifact and is never presented as a full year.
- **LD9 (verified-settled eligibility).** A House filing is settled only when `raw_path` and `response_hash` are present **and** the archived bytes re-hash to `response_hash`. Full re-hash (not size or mtime) because same-length corruption is exactly the case a cheaper check would miss, and the cost is one bounded local read per candidate.
- **LD10 (an unknown denominator is never a pass).** The e-file **filing** census is tracked independently of produced rows, and **any** filing whose expected row count is unknown (`failed`, or `row_count` NULL/0) makes the era's row gate `unmeasurable` — there is no tolerance band, because one unmeasured filing can hold disproportionately many transactions and a percentage of *filings* cannot bound *row* coverage. `no_efile_filings` is the single n/a status and is provable (census exactly zero). The measurable-filing share survives as a **severity figure** used to rank surfaced eras and is printed on every era line regardless of status; ranking never suppresses or downgrades an era.
- **LD11 (one acceptance body, two modes, contract-shaped assertions).** The hermetic gate and the real-corpus run execute literally the same assertion function; the modes differ only in how the connection, archive root, and data repo are obtained. Every consumer assertion is therefore written against the *published contract* (feed = exactly the latest 500; era evidence = stats keys + qualifying slices), never against a fixture-shaped expectation that a correct real corpus would violate. This is what makes R18 a re-run rather than a second, weaker script.
- **LD12 (Phase A database — explicitly resolved, never assumed).** Stage B does not copy a bare `populus.db` (no such file exists in this worktree). It resolves the canonical corpus from the **current published manifest** (`latest.json` → `builds/<id>/manifest.json` → the `congress.db` artifact entry → `releases/data-<id>/congress.db`), **sha256/size-verifies it against that entry**, copies it to `ops/m1-b/phase-a.db` via **SQLite's backup API** (the `build.py:1565-1576` pattern), and asserts `PRAGMA integrity_check` plus the manifest-listed current-corpus row counts before ingesting. This keeps (i) the entity/file budget measured on the genuinely *enlarged* corpus, (ii) production untouched with `rm` as rollback, (iii) the Senate watermark exercised under a real current corpus — the case the R14 seam exists for — and (iv) the provenance of the Phase A figures auditable back to a published build id.
- **LD13 (instrumentation lives in the fetchers).** Attempts, statuses, retries, and backoff sleep are counted inside `_PoliteFetcher`/`_PoliteSession` rather than in a wrapper, because those loops are the only place that sees a retry as distinct from a new request (a wrapper counts both identically). The shape is copied from `inst_bulk.CountingTransport` (`inst_bulk.py:713-740`), and elapsed time comes from the already-injected `monotonic` so library code still never reads a clock.

## Alternatives Considered

- **A1** — Import `inst13f`'s private helpers into `house.py` directly. **Rejected:** couples the congressional module to the whole SEC/parse stack and normalizes a `_`-private cross-module import (a fork smell). → LD2 shared module.
- **A2** — Compute the gate metric in SQL over the `flags` JSON. **Rejected:** duplicates `PARSE_DEFECT_FLAGS` into a second source of truth that `normalize.py:11-16` explicitly forbids. → Python `has_parse_defect` reuse.
- **A3** — Fail `accept-m1-b` when an era is below ≥97%. **Rejected:** contradicts "surface, don't decide"; a gate miss is a decision to be surfaced, not a build failure. → LD4.
- **A4** — Restructure the existing `parse_coverage_primary_by_chamber_year_*` key to embed rates. **Rejected:** mutates the shape the brief says to keep and risks the `congress_health` "no code change" assumption. → additive keys (R6).
- **A5** — Prove Phase A only on committed fixtures and defer the real measurement past this run. **Rejected (review F1):** the brief's core gate *is* the real historical measurement; fixture-only tooling can merge while nothing historical has ever been measured. → LD5 stage B inside the run, with the hermetic constraint honored by keeping stage B outside pytest.
- **A6** — Track the per-era rate only in the ephemeral House `YearReport`. **Rejected:** after a multi-session Phase B the per-era gate must be derivable from the persisted corpus, not one run's report. → DB-derived `parse_gate` module (R4).
- **A7** — Add the `inst_bulk` journal to House for resume. **Rejected:** the per-year index + verified-settled eligibility + per-doc sidecars already give run- and byte-level resume; a coordinator journal is unneeded scope.
- **A8** — Tolerate unknown row denominators up to a 0.97 filing-census share (the round-1 compromise: an era with ≤3% unmeasurable filings could still pass on its surviving row rate). **Rejected by review round 2, and the rejection is correct:** one unmeasured filing may contain disproportionately many transactions, so a percentage of *filings* cannot bound *row* coverage — the surviving rows could read 100% clean at a 97% filing census while true row coverage sits far below 0.97. **Adopted instead:** any filing with an unknown expected row count makes the era's row gate `unmeasurable`, non-passing, and surfaced; the measurable-filing share is retained only to severity-rank the surfaced eras, which the review explicitly allows as the answer to banner fatigue. → R4, LD10.
- **A9** — Validate the House archive by file size or mtime instead of re-hashing. **Rejected:** same-length corruption — the exact failure mode R3 names — passes a size check. `response_hash` is already stored, so the honest check is also the simplest. → LD9.
- **A10** — Give the Senate a `--year` option like the House. **Rejected:** the eFD index is one continuous submitted-date window (`cli.py:186-190`), and a `--year` flag would misdescribe it and hide the amendment tail. → explicit `--submitted-start`/`--submitted-end` (R14, LD8).
- **A11** — Write a separate lightweight script for the real-corpus checks. **Rejected:** two scripts drift, and the real corpus would end up held to the weaker one. → LD11 one body, two modes.
- **A12** — Run stage B against a canonical `populus.db` in place. **Rejected twice over:** an interrupted historical ingest would leave the production corpus mid-era with no cheap rollback, and review round 2 measured that no such file exists in this worktree at all — an unresolved source would have stopped stage B before its first fetch. → LD12 manifest-resolved, verified, backup-copied.
- **A13** — Assert that `congress/feed.json` contains a 2015 row (the round-1 wording). **Rejected by review round 2:** the feed is contractually the latest 500 by filed date (`build.py:81,1445-1454`); the published feed today is 500 rows all dated 2026-07-21 against 3,911 default rows, so an era row can never appear there on a current corpus and the mandatory real-corpus acceptance would fail on a correct build. → exact latest-500 match + stats keys + qualifying slices (R16, LD11).
- **A14** — Count requests by wrapping the transports instead of instrumenting the fetchers. **Rejected:** a transport wrapper cannot distinguish a backoff retry from a fresh request, which is exactly the figure Phase B sizing needs; the retry loop lives in the fetcher. → LD13 (with `CountingTransport`'s counter shape reused).
- **A15** — Take the Phase A copy with a filesystem `cp`. **Rejected:** a plain copy of a live SQLite file can capture a torn page set and has no integrity contract; `source.backup(destination)` is the pattern the build already relies on (`build.py:1565-1576`) and is followed by `PRAGMA integrity_check` + count assertions. → LD12.

## Planned Files

- `src/populus/ingest/checkpoint.py` — **NEW.** Shared `read_checkpoint`/`commit_checkpoint`/`sha256_hex` (R1).
- `src/populus/ingest/inst13f.py` — **MOD.** Import shared primitives; keep `_read_checkpoint`/`_commit_checkpoint`/`_sha256` aliases; repoint internal call sites (R1).
- `src/populus/ingest/house.py` — **MOD.** Checkpoint-before-bytes + cache-first PTR fetch and sidecar; verified-settled eligibility + `settled_verified`/`settled_reobtained` counters; `_PoliteFetcher` attempt/status/retry/backoff counters + `elapsed_s` on `IngestReport` (R20); index-sidecar `response_hash`; per-era gate line + surfacing banner and the instrumentation line in `format_summary` (R2, R3, R5, R20).
- `src/populus/ingest/senate.py` — **MOD.** Default-inert `submitted_start_date`/`submitted_end_date` seam through `_index_post_body`/`discover`/`run_senate_ingest` (R14); `_PoliteSession` attempt/status/retry/backoff counters + `elapsed_s` on `SenateIngestReport` (R20); reuse `format_gate_decision` for the gate line/banner in `format_summary` (R5).
- `src/populus/cli.py` — **MOD.** `--submitted-start`/`--submitted-end` for `ingest congress-senate`, rejected for other jobs (R14).
- `src/populus/parse_gate.py` — **NEW.** `compute_parse_gate` + `compute_join_coverage` + `EraParseCoverage`/`EraJoinCoverage`/`ParseGateReport` + `format_gate_decision` (R4, R5, R15).
- `src/populus/stats.py` — **MOD.** Two additive `totals` keys from `parse_gate` (R6, R15).
- `tests/schemas/stats.schema.json` — **MOD.** Add both keys (R6).
- `scripts/accept_m1_b.py` — **NEW.** Shared assertion body + hermetic and operational entry points, through build → publish → verify + budgets (R11, R16, R18).
- `tests/test_accept_m1_b.py` — **NEW.** Importlib pytest wrapper (R11).
- `scripts/phase_a_snapshot.py` — **NEW.** Manifest-resolved, sha256-verified, backup-API copy of the published corpus + `PRAGMA integrity_check` + expected-count assertions (R17).
- `tests/test_phase_a_snapshot.py` — **NEW.** Resolution from a fixture data repo; sha256 mismatch → nonzero; integrity + count assertions; missing manifest/asset → hard stop (R17).
- `Makefile` — **MOD.** `accept-m1-b: sync` target + `.PHONY` (R11, R13).
- `tests/fixtures/house/2015FD.index.xml` — **NEW.** Committed minimal 2015 index naming the 6 committed DocIDs with real filer/state (R11).
- `tests/fixtures/senate/hist-ptr-index.json` — **NEW.** Committed Senate historical index incl. a cross-year amendment/original pair, referencing committed `ptr_*.html`/`paper_*.html` pages (R10, R11).
- `tests/test_checkpoint.py` — **NEW.** Checkpoint round-trip + ordering + non-200 guard (R1, R2).
- `tests/test_parse_gate.py` — **NEW.** Both censuses, complete-failure / mixed-failure / single-unknown-filing eras, exclusions, surfacing, severity ranking, per-era join coverage (R4, R5, R15).
- `tests/test_house_ingest.py` — **MOD.** Resumable fetch + sidecar; verified-settled with missing and corrupt bytes on the same DB; fresh-DB zero-transport resume; `needs_ocr` counted; reparse-by-version archive-only (R2, R3, R7, R8).
- `tests/test_senate_ingest.py` — **MOD.** Window seam: start bound, end bound, both bounds, and byte-identical default body; cross-year amendment pair (R10, R14).
- `tests/test_cli.py` — **MOD.** `--submitted-start`/`--submitted-end` accepted for `congress-senate`, rejected elsewhere (R14).
- `tests/test_stats.py` — **MOD.** Both additive keys present + schema validates + byte-stable (R6, R15).
- `tests/test_members.py` — **MOD (if needed).** As-of join over the historical era via aliases (R9).
- `docs/build/RUN-M1-B-phase-a.md` — **NEW (stage B).** The Phase A decision artifact: every measured figure + the three options + the stop-point record (R17, R18, R19).
- `docs/build/RUN-M1-B-devnotes.md` — **NEW (DEV phase).** Dev notes incl. the Phase B sizing and the exact runbook actually executed (R12, R17).

## Implementation Tasks

1. **R1** — Create `ingest/checkpoint.py` with `read_checkpoint`/`commit_checkpoint`/`sha256_hex` moved verbatim from `inst13f.py:104-179`; in `inst13f.py` import them, add `_`-aliases, repoint `_LiveSource`/`_CacheSource` call sites. Run the full inst suite to confirm byte-identical behaviour.
2. **R2** — Rewrite `house._obtain_document` live branch to cache-first + checkpoint-before-bytes using the shared primitives; write `pdfs/<year>/<DocID>.pdf.fetch-meta.json`; add `response_hash` to the index sidecar in `discover`; keep cache-mode untouched; keep the non-200 → `None`/no-archive guard.
3. **R3** — Replace the `raw_path IS NOT NULL` settled set (`house.py:647-655`) with the verified-archive predicate (LD9): re-hash the archived document against `filings.response_hash`; unverified → fall through to the checkpoint-first obtain path (exactly one refetch); add `settled_verified`/`settled_reobtained` counters to `YearReport` and `format_summary`.
4. **R14** — Thread `submitted_start_date`/`submitted_end_date` through `_index_post_body` (`senate.py:390-406`), `discover` (`senate.py:409-501`), and `run_senate_ingest` (`senate.py:737-807`), defaulting to today's derived-start/empty-end behaviour; add `--submitted-start`/`--submitted-end` to `cli.ingest` for `congress-senate` with shape validation and a usage error for other jobs.
5. **R4** — Create `parse_gate.py`: the e-file filing census (measurable = `parse_status != 'failed'` and `row_count` a positive integer; everything else = unknown denominator), the e-file row census via `has_parse_defect`, the status table from Architecture §4 — **any unmeasurable filing ⇒ `unmeasurable`, no tolerance band** — `row_denominator_known`, `severity`, `EraParseCoverage`/`ParseGateReport`, threshold 0.97 on the row rate.
6. **R5** — Add `format_gate_decision` emitting the `OWNER DECISION REQUIRED` report (era, row rate labelled as a floor when the denominator is unknown, unmeasurable count and share, options a/b/c from `brief:49-53`) whenever any era is `miss` or `unmeasurable`, with eras severity-ranked in the report; wire the per-era gate line + banner into `house.format_summary` and `senate.format_summary`.
7. **R15** — Add `compute_join_coverage` (per-`(chamber, year)` filings/rows joined, unjoined, unresolved filer names, primary sources only) to `parse_gate`; include it in `ParseGateReport` and the formatted report; write the exact read-only cross-check queries into the runbook.
8. **R6** — Add both additive `totals` keys to `compute_stats` from `parse_gate`; update `stats.schema.json` in lockstep; confirm `render_stats` byte-stability.
9. **R7** — Prove `needs_ocr` counting on the committed 2015 paper fixtures: paper → `needs_ocr`, retained with `doc_url`, counted in dispositions, excluded from both e-file censuses.
10. **R8** — Verify (no parser change) that the archive-only reparse-by-version path over an archived 2015 fixture re-stamps `parser_version` and re-evaluates without transport; document the discipline (bump `house_ptr.PARSER_VERSION` → `populus reparse congress-house --parser-version <old>` / `--since`).
11. **R9** — Seed member/alias fixtures for the 2015 sample filers; run `apply_member_join` as-of `filed_date`; assert unjoined visible+flagged+counted and per-era coverage reported.
12. **R10** — Author `hist-ptr-index.json` with a cross-year original (title_date 2015-12-xx, filed 2015-12) + amendment (filed 2016-01) referencing committed pages; run Senate ingest; assert `supersedes` set, both sides flagged, `v_default` excludes the original.
13. **R11** — Write `scripts/accept_m1_b.py` (shared `assert_corpus` body + `run_acceptance`), the `2015FD.index.xml` fixture, `tests/test_accept_m1_b.py` importlib wrapper, and the `accept-m1-b: sync` Makefile target + `.PHONY`.
14. **R16** — Extend the acceptance chain past `stats.json` through `run_build` → `run_publish` → `run_verify` on a `LocalDirBackend` repo (the `accept_m2_6.py:103-116` shape); assert `congress/feed.json` **equals the DB's expected latest 500** (same ids, same order — never "contains an era row"), prove historical publication via the per-era `stats.json` keys plus the DB-selected member/ticker slices whose latest-`SLICE_LIMIT` window contains era rows, and assert `verify` is ok; measure and print `member_pages`/`ticker_pages`/`published_files` and fail above the 4,000-file M1 budget (`ARCHITECTURE.md:582`).
15. **R20** — Add `attempts`/`status_counts`/`retries`/`backoff_sleep_s` to `house._PoliteFetcher` (`house.py:111-131`) and `senate._PoliteSession` (`senate.py:232-264`) following `inst_bulk.CountingTransport` (`inst_bulk.py:713-740`); surface them plus `elapsed_s` (from the injected `monotonic`, `None` in cache mode) on `IngestReport`/`SenateIngestReport`; print them in both `format_summary`s; test the retry and no-retry paths and the elapsed capture.
16. **R13** — Run `make test` (confirm ≥1645, no regressions), `make security`, `make accept-m1-b`; mutation-verify each behavioural fix (see Verification Matrix); reconcile Changed Files vs `git status`; state any deviations. **Stage A ends here.**
17. **R17** — Execute the live operational Phase A (Rollout stage B, exact commands): resolve + sha256-verify + backup-copy the published corpus with `scripts/phase_a_snapshot.py` (integrity + expected counts asserted before ingestion), verify the `congress-legislators` historical inputs, ingest House 2015 and the Senate `01/01/2015 → 03/31/2016` window at the unchanged politeness floors, run the member join, `populus stats`, and the gate report; record every brief-named measured figure — including the R20 request counts, retries, status mix, and elapsed — in `docs/build/RUN-M1-B-phase-a.md`.
18. **R18** — Re-run the same acceptance against the real Phase A database (`scripts/accept_m1_b.py --db ops/m1-b/phase-a.db --raw-root ops/m1-b/raw --data-repo ops/m1-b/data-repo`); record the measured member/ticker entity counts, published file count vs the ≤4,000 budget, the verify result, and the transport/resume counters into the same artifact.
19. **R19** — Halt the run at the Phase A stop point: print and record the gate report plus options (a)/(b)/(c), state the artifact path, and issue no Phase B command. The dev notes state plainly that Phase B awaits the owner's recorded decision.
20. **R12** — Write the Phase B sizing (request arithmetic table below) into the dev notes with the authorization condition stated — Phase B runs only under the recorded Phase A decision — and confirm nothing of Phase B was executed here.

**Phase B request arithmetic (R12).** Floors from code, unchanged: House `0.25 s` (`house.py:53`), Senate `2.0 s + jitter(0..1 s) ≈ 2.5 s` (`senate.py:60`).

| Segment | N | Floor | Floor-bound | Latency-bound (~1 s/req House, ~2.5 s Senate) |
|---|---|---|---|---|
| Phase A House 2015 (stage B, this run) | 728 PTR + 1 index | 0.25 s | ~3 min | ~12–15 min |
| Phase A Senate 01/01/2015→03/31/2016 (stage B, this run) | N_win (index `recordsTotal`, measured at run time) | 2.5 s | — | N_win × 2.5 s (~10–40 min) |
| Phase B House 2013–2025 remainder | ~9,500–10,000 PTR (`brief:26-31`) + ~11 index | 0.25 s | ~42 min | ~2.8 h |
| Phase B Senate 2012→2025 remainder | N_sen (measured from `recordsTotal` at operation time) | 2.5 s | — | N_sen × 2.5 s → multi-night |

Bounded, resumable (House verified-settled + per-doc sidecars; Senate DB watermark + 90-day rescan); multi-session safe. N_win and N_sen are stated as measured-at-operation, never fabricated. The latency-bound column is a *prior*: stage B's R20 counters (attempts, retries, status mix, elapsed) replace it with measured per-request cost before any Phase B sizing is committed.

## Testing Strategy

- **Unit (`tests/test_checkpoint.py`):** commit→read round-trip; ordering (crash between checkpoint and bytes → absent bytes → exactly one refetch); non-200 never checkpointed/archived.
- **Unit (`tests/test_parse_gate.py`):** row rate above/at/below 0.97 on a fully measurable era; **complete-failure era** (all e-file filings `failed`, zero rows) → `unmeasurable`, `meets_gate` False, decision surfaced; **mixed-failure era** (100% clean surviving rows, some filings `failed`) → `unmeasurable`, decision surfaced; **single-unknown-filing era** (1 of 200 filings with an unknown row count, surviving rows 100% clean) → still `unmeasurable`, `meets_gate` False, surfaced — the no-tolerance rule; `row_count` NULL and `row_count = 0` each count as unknown; `no_efile_filings` only when the census is zero; `needs_ocr`/`kadoa` excluded from both censuses; `format_gate_decision` contains the three options, labels the row rate as a floor when the denominator is unknown, and orders eras by severity without dropping any; per-era join coverage counts and unresolved names.
- **House ingest (`tests/test_house_ingest.py`):** live fake transport + `raw_root` writes the sidecar checkpoint-first; **same-database** run with one deleted and one corrupted archive → exactly one refetch each and no third; **fresh-database** run over the verified archive → zero PTR transport and full reload; hash-mismatch refetch; cache-mode unchanged; 2015 paper fixtures → `needs_ocr` counted/excluded (R7); reparse-by-version archive-only re-stamp (R8).
- **Senate ingest (`tests/test_senate_ingest.py`):** POST body carries `submitted_start_date` when given; carries `submitted_end_date` when given; both together bound the window; with neither option the body is byte-identical to the watermark-derived body of today; a historical insert cannot regress the derived watermark; cross-year synthetic index → pair links, both flagged, `v_default` excludes the original (R10, R14).
- **CLI (`tests/test_cli.py`):** the two window options are accepted for `congress-senate` and rejected for the other jobs (R14).
- **Members (`tests/test_members.py`):** as-of resolve for a 2015 filer via alias; unjoined → NULL, counted (R9).
- **Stats (`tests/test_stats.py`):** both additive keys present, values match `parse_gate`, schema validates, byte-stable (R6, R15).
- **Fetcher instrumentation (`tests/test_house_ingest.py`, `tests/test_senate_ingest.py`):** **retry path** — a transport answering 429 then 200 yields `attempts == 2`, `retries == 1`, one recorded backoff sleep, and the summary prints them; **no-retry path** — a 200 yields `attempts == 1`, `retries == 0`, no sleep; `status_counts` reflects the mix; `elapsed_s` equals the difference of an injected fake `monotonic` and is `None` in cache mode (R20).
- **Snapshot resolver (`tests/test_phase_a_snapshot.py`):** resolves `latest.json` → manifest → asset on a fixture data repo; a tampered asset (sha256/size mismatch) exits nonzero; the copy passes `PRAGMA integrity_check` and the expected-count assertions; a missing manifest or asset is a hard stop, never a fallback to a fresh database (R17).
- **Acceptance (`tests/test_accept_m1_b.py`):** rc==0 + measured-evidence substrings (per-era rate line, all crafted `OWNER DECISION REQUIRED` eras, "ZERO transport" fresh-DB resume, the exact feed-match line, the qualifying-slice line, `verify: ok`, the budget line) (R11, R16).
- **Gates (R13):** `make test`/`make security`/`make accept-m1-b`.
- **Live measurement (R17, R18):** not a test — an operator stage whose evidence is the recorded measured figures plus the acceptance rc on the real corpus.

**Mutation checks (each behavioural fix must fail a test when reverted):** swap checkpoint-after-bytes → the fresh-DB resume test fails; drop the non-200 guard → the 404-freeze test fails; restore `raw_path IS NOT NULL` as settled → the corrupt-archive same-DB test fails; flip the `meets_gate` comparison → R4 tests fail; re-introduce any tolerance for unknown denominators → the single-unknown-filing test fails; count unmeasurable filings as measurable → the complete-failure test fails; include `kadoa`/`needs_ocr` in a census → the exclusion test fails; drop `submitted_end_date` from the body → the end-bound test fails; hard-code the default body start → the byte-identical-default test fails; omit the surfacing banner → the acceptance substring is missing; drop a schema key → `test_stats` validation fails; skip `flag_unresolved_pair_rows` → the double-count assertion fails; loosen the feed check from exact-latest-500 to "contains" → the feed-match test fails; stop counting retries separately from attempts → the retry-path test fails; skip the manifest sha256 comparison → the tampered-asset test fails; drop the budget assertion → the acceptance no longer fails on an over-budget corpus.

## Verification Matrix

| Req | Verification (gate / test / measurement) | Mutation |
|---|---|---|
| R1 | Full inst suite green after lift; `test_checkpoint.py` round-trip | Remove alias → inst import error |
| R2 | `test_house_ingest.py` sidecar written checkpoint-first (live path) | Write bytes before checkpoint → ordering test red |
| R3 | `test_house_ingest.py` missing + corrupt archive on the SAME db (one refetch each); fresh-db zero-transport resume; acceptance steps 2–3 | Restore `raw_path IS NOT NULL` settled → corrupt-archive test red |
| R4 | `test_parse_gate.py` two censuses; complete-failure, mixed-failure, and single-unknown-filing eras; NULL/zero `row_count`; exclusions; 0.97 row threshold | Allow any unknown-denominator tolerance → single-unknown-filing test red |
| R5 | `test_parse_gate.py` + acceptance `OWNER DECISION REQUIRED` substrings (sub-gate era and zero-row era); floor label; severity ordering keeps every era | Suppress or rank-away an era → substring missing |
| R6 | `test_stats.py` both additive keys + schema validate + byte-stable | Drop a schema key → validation fails |
| R7 | `test_house_ingest.py` paper→needs_ocr counted/excluded; live 2015 paper share measured | Count needs_ocr in a census → gate test red |
| R8 | `test_house_ingest.py` reparse-by-version archive-only re-stamp | Re-fetch on reparse → transport asserted |
| R9 | `test_members.py` as-of join; acceptance per-era join line; live 2015 figures | Ignore term overlap → wrong/ambiguous join |
| R10 | `test_senate_ingest.py` cross-year pair; acceptance; live pair count | Skip flag pass → double-count |
| R11 | `make accept-m1-b` rc==0 + `test_accept_m1_b.py` substrings | Break a chain step → rc≠0 |
| R12 | Dev notes carry the arithmetic table + the authorization condition; no Phase B command executed | — (documentation gate) |
| R13 | `make test` (≥1645), `make security`, `make accept-m1-b` all green | Any regression → gate red |
| R14 | `test_senate_ingest.py` start bound / end bound / both bounds / byte-identical default body; `test_cli.py` option scoping; live window request | Drop `submitted_end_date` → end-bound test red |
| R15 | `test_parse_gate.py` per-era join counts; `test_stats.py` key; runbook cross-check query reproduces the artifact's 2015 figures | Aggregate-only join → per-era test red |
| R16 | Acceptance runs build → publish → verify; feed equals the DB's expected latest-500 exactly; era rows proven via stats keys + DB-selected qualifying slices; `published_files <= 4000` | Loosen the feed check to "contains an era row" → the real-corpus mode fails on a correct build |
| R17 | `test_phase_a_snapshot.py` (manifest resolution, sha256 mismatch, integrity + counts); the live stage's recorded figures in `RUN-M1-B-phase-a.md` (source build id, e-file/paper mix, per-era gate figures vs 0.97, per-era join, amendment pairs, dispositions, elapsed, request/retry counts) | Skip the manifest sha256 check → tampered-asset test red; absent artifact = run incomplete |
| R18 | `scripts/accept_m1_b.py --db …` rc recorded on the real Phase A corpus; entity/file counts recorded vs the ≤4,000 budget | Weaken the operational mode → it stops sharing `assert_corpus` (code review) |
| R19 | The run's final report names the stop point, the artifact, and options (a)/(b)/(c); `git log`/dev notes show no Phase B execution | Issue a Phase B command → stop-point check red |
| R20 | `test_house_ingest.py` / `test_senate_ingest.py` retry path (429→200: attempts 2, retries 1, one backoff) and no-retry path (attempts 1, retries 0); injected-`monotonic` elapsed; summary lines; live figures recorded | Count retries as plain attempts → retry-path test red |

## Rollout / Rollback

**Stage A — ship the code (hermetic, this run).** Merge the shared checkpoint module + House resumable fetch/verified-settled + the Senate window seam + `parse_gate` + stats extensions + `accept-m1-b` + fixtures. Gates: `make test` (≥1645, no regressions), `make security`, `make accept-m1-b`. No network touched. All changes are additive/reuse; no DB migration. The Senate seam is default-inert, so reverting it cannot change incremental behaviour.

**Stage B — live operational Phase A (inside this run, after stage A's gates pass):**

1. **Resolve, verify, and snapshot the canonical corpus (R17, LD12)** — there is no bare `populus.db` to copy, so the source is the current published build:
   ```
   mkdir -p ops/m1-b
   uv run python scripts/phase_a_snapshot.py \
       --data-repo ../populus-data --out ops/m1-b/phase-a.db
   ```
   The script reads `../populus-data/latest.json` → `builds/<build_id>/manifest.json`, takes the `congress.db` artifact entry, resolves `releases/data-<build_id>/congress.db`, **compares sha256 + byte length to the manifest entry**, copies via `source.backup(destination)` (the `build.py:1565-1576` pattern), then asserts `PRAGMA integrity_check == 'ok'` and that `filings` / `transactions` / `v_default_transactions` counts equal the manifest-listed `congress/stats.json` figures. It prints and records the **source `build_id`** — the provenance of every Phase A figure — and exits nonzero on any mismatch. Nothing below runs until it exits 0; a fresh database is never substituted.
2. **Verify the historical legislators inputs first (R15).** Confirm `data-cache/legislators/legislators-historical.yaml` and `legislators-current.yaml` exist, then `populus ingest members --db ops/m1-b/phase-a.db --from-cache data-cache/legislators --house-index data-cache/house`. **Assert era coverage before ingesting filings**, read-only:
   ```sql
   SELECT m.chamber, COUNT(DISTINCT m.bioguide_id)
   FROM members m, json_each(m.terms) t
   WHERE json_extract(t.value, '$.start') <= '2015-12-31'
     AND json_extract(t.value, '$.end')   >= '2015-01-01'
   GROUP BY m.chamber;
   ```
   Both chambers must return non-zero, or the era join is unmeasurable and that is itself a recorded Phase A finding.
3. **House 2015** (~728 PTRs, ~12–15 min, resumable, interrupt-safe):
   `populus ingest congress-house --db ops/m1-b/phase-a.db --year 2015 --raw-root ops/m1-b/raw/house`
   The printed summary now ends with the R20 line — `attempts / retries / status mix / backoff_sleep_s / elapsed_s` — plus `settled_verified` / `settled_reobtained`; capture it verbatim (it is the Phase B sizing input).
4. **Senate historical window** (LD8, the R14 seam; ~10–40 min):
   `populus ingest congress-senate --db ops/m1-b/phase-a.db --raw-root ops/m1-b/raw/senate --submitted-start 01/01/2015 --submitted-end 03/31/2016`
   Capture the same R20 line for the Senate run (its per-request cost differs by an order of magnitude — 2.5 s floor vs 0.25 s).
5. **Member join over the enlarged corpus:** `populus ingest members --db ops/m1-b/phase-a.db --from-cache data-cache/legislators --house-index data-cache/house`.
6. **Stats + gate report:** `populus stats --db ops/m1-b/phase-a.db --raw-root ops/m1-b/raw/house --out ops/m1-b/stats.json`; read the per-era gate block and the per-era join block. Read-only cross-check of the 2015 join figures (R15):
   ```sql
   SELECT chamber, substr(filed_date,1,4) AS yr,
          COUNT(*) AS rows_total, COUNT(bioguide_id) AS rows_joined
   FROM v_default_transactions WHERE source != 'kadoa'
   GROUP BY chamber, yr ORDER BY chamber, yr;
   ```
7. **Re-run the same acceptance on the real corpus (R18):**
   `uv run python scripts/accept_m1_b.py --db ops/m1-b/phase-a.db --raw-root ops/m1-b/raw --data-repo ops/m1-b/data-repo`
   → local build → publish → verify on the enlarged corpus; the feed is checked to equal the DB's expected latest-500 exactly (an era row in the feed is neither expected nor required, `build.py:81`), historical publication is proven by the per-era stats keys plus the qualifying member/ticker slices, and the member-page / ticker-page / published-file counts are measured against the ≤4,000 budget.
8. **Record measured figures** (never asserted) into `docs/build/RUN-M1-B-phase-a.md`: the source `build_id` and verified sha256 from step 1; e-file vs paper mix per era; the per-era gate figures against 0.97 (row rate, whether the denominator was fully known, unmeasurable count and share, status); per-era member-join joined/total/unresolved with the unresolved filer names; cross-year amendment pairs found; per-era disposition counts; entity/file counts vs budget; verify result; the R20 attempts / retries / status mix / backoff seconds / elapsed for each live command; `settled_verified`/`settled_reobtained`.

**Stage C — the Phase A stop point (R19).** The run reports the gate outcome and **halts for the owner decision**, presenting the artifact and the three options: (a) era-scoped gates published honestly per year in `stats.json`, (b) a parser extension for the older template era (then `populus reparse congress-house --parser-version <old>`, archive-only, no refetch), (c) accepting a higher `needs_ocr` share as counted-not-parsed. The run issues no Phase B command under any measured outcome — including a clean pass, because the brief makes the decision itself the gate.

**Phase B (a later operation, authorized by the recorded decision).** 2013–2025 remainder (House per-year + Senate the remaining windows), same measured reporting per year; multi-session, resumable; then publish acceptance on the enlarged corpus and a re-check of the §9.10 page budgets against the real enlarged counts (`ARCHITECTURE.md:580-582`).

**Rollback.** Code: revert the merge commit → restores the 1645 baseline; no schema migration; the Senate seam is default-inert so its removal cannot change incremental behaviour. Stage B: `rm -rf ops/m1-b` — the Phase A database, archive, and local data repo are a copy and a scratch tree; the canonical corpus and the published data repo are untouched. House sidecars are additive files under the raw archive (ignorable). If the owner later picks option (b), a **follow-up** run adds the parser extension + `populus reparse` (never a silent fork).

## Simplicity Audit

- One checkpoint implementation, two callers (LD2) — no duplicated resume logic.
- One acceptance body, two modes (LD11) — the real corpus is held to exactly the gate's assertions, and there is no second script to drift.
- Verified-settled reuses the already-stored `filings.response_hash` — no new column, no new sidecar format, no journal.
- The Senate seam is two optional parameters and one CLI pair; the default path is byte-identical, so no branch of existing behaviour forks.
- The gate metric reuses `has_parse_defect` — no second flag taxonomy in SQL — and the filing census is two counts feeding one boolean, not a second gate system: still exactly one threshold constant, applied to the row rate.
- `stats.json` grows by two additive keys; the existing per-year key auto-extends by year with zero code.
- Acceptance reuses the `accept_m2_6` trio shape, its `_build_and_publish` helper shape, and the existing synthetic-index/committed-page test pattern — no new page HTML for the cross-year pair.
- The fetcher counters are four fields and a derived property per fetcher, copied from an existing counter shape (`inst_bulk.py:713-740`); no new abstraction, no wrapper layer.
- `phase_a_snapshot.py` is a resolver, not a new subsystem: it reads artifacts the publish path already writes and calls the backup API the build already uses.
- Stage B adds no ingest code: it is the merged tooling driven by the documented CLI plus that one resolver.

## Tech Debt Introduced

- Back-compat `_`-aliases in `inst13f` for the lifted primitives — a thin shim; removable once nothing references the private names (tracked, low).
- Verified-settled re-hashes every candidate archive on every run — bounded local I/O (~100–150 MB per 2015 re-run, ~1.5 GB across a full Phase B pass). Accepted deliberately over a cheaper size check (A9); if a future corpus makes it hot, the fix is a cached digest sidecar, not a weaker check.
- House per-doc sidecar stores `response_hash` that also lives on `filings.response_hash` — intentional dual provenance (filesystem-independent §5.1), and it is what makes both the resume and the verification checks possible; not debt.
- `hist-ptr-index.json` is a crafted fixture (like the inst crafted trees) — acceptable per the fixtures convention.
- `ops/m1-b/` is external operational state (like M2-6's journals) — never published, safe to delete.
- The unknown-denominator rule (LD10) is strict by design: an era with one unparseable document cannot pass until the owner rules on it. That is the intended cost of an honest gate, but it means historical eras will surface decisions more often than the 2026 baseline did — expected, and the severity ranking is what keeps the report readable.
- Fetcher counters add per-request state to two hot loops; they are integers and a `Counter`, no I/O, and the politeness constants are untouched.
- Pre-existing (not introduced, noted): House ingests only `FilingType=='P'` (no House amendment/annual-FD path); House PTR amendments have no `supersedes` linkage — out of scope (non-goal), a documented caveat.

## Memory Touch-Points

- [[populus-project]] — advances M1 corpus depth under ARCHITECTURE §9; congressional module.
- [[plan-v1-literal-rid-tokens]] — every R-id (R1 … R20) is enumerated **literally** in Implementation Tasks, Verification Matrix, and Definition of Done; no ranges.
- [[verify-against-a-frozen-tree]] — hash the tree before/after gate runs; a headless "completed" ≠ writes landed; reconcile Changed Files vs `git status` (R13).
- [[orchestrate-worktree-isolation]] — run the DEV/QA orchestration in a git worktree if a design session or the owner may write the checkout.
- [[specify-before-rewriting]] — the gate arithmetic (LD1, LD10) and the settled predicate (LD9) are pinned here as specs precisely because round 1 showed they were the churning mechanisms.
- John Baek profile — measured-never-asserted figures and the decision recorded verbatim before Phase B (decision-record discipline).

## Failure-Mode Sweep

- **"Measure in-run" vs hermetic no-sockets.** Resolved by LD5 rather than deferred: gates and tests stay socket-free; the real measurement is stage B, an operator-run CLI stage of this same run, exactly as M2-6 ran its real operation after its hermetic gate. Round 1's F1 rejected the earlier deferral, and no rescope is assumed.
- **Stage B interrupted mid-fetch** (network, breaker, laptop) → resumable by construction: House verified-settled + per-doc sidecars mean a re-run refetches only what is missing or corrupt; the Senate window is idempotent and its watermark cannot regress from a historical insert. The stop point is unreachable until stage B completes, so a partial stage B never masquerades as a measured Phase A.
- **A database row claims an archive that is gone or corrupt** → the old settled check skipped it forever (`house.py:645-655`). Closed by LD9's re-hash; tested with missing and corrupt bytes on the same database.
- **A same-database "zero transport" test that never exercises resume** → the zero-transport proof is done on a **fresh** database over the verified archive (the M2-6 shape), so it cannot pass by simply skipping settled rows.
- **Stage B cannot start because its database source does not exist** → measured in review round 2: there is no `populus.db` in this worktree. Closed by resolving the corpus from the published manifest with sha256 verification (R17, LD12); a missing or mismatching source is a hard stop with a named cause, and substituting a fresh database — which would silently invalidate the enlarged-corpus and watermark assumptions — is explicitly forbidden.
- **A torn or mismatched Phase A copy** → the snapshot goes through SQLite's backup API (`build.py:1565-1576`), then `PRAGMA integrity_check` and expected-count assertions against the manifest-listed `stats.json`, before any ingestion writes.
- **Senate Phase A runs away to a full backfill** → an empty store would request 2012 onward (`senate.py:504-519`) and a current store would never reach 2015. Closed by the R14 seam plus LD12's verified copy of the current corpus, with the exact bounded window in the runbook.
- **A historical template that parses nothing looks like "n/a/pass"** → closed by the independent filing census (LD10); any filing with an unknown expected row count makes the era `unmeasurable`, non-passing, and surfaced.
- **A percentage of filings used to bound row coverage** → rejected in round 2 (A8): one unmeasured filing can hold disproportionately many rows, so there is no tolerance band; the row gate refuses to certify a denominator it does not know.
- **Banner fatigue from strict unmeasurability** → answered by severity ranking (unmeasurable share, then shortfall, then era size) and by printing the unmeasurable count on every era line — presentation only; no era is ever suppressed or downgraded to a pass.
- **A consumer assertion that a correct real corpus must fail** → the feed is contractually the latest 500 (`build.py:81,1445-1454`), so it is asserted to equal the DB's expected latest-500 and never to contain an era row; era evidence comes from the stats keys and DB-selected qualifying slices, which hold on both the fixture and the enlarged corpus (R16, LD11, A13).
- **Operational figures that cannot be reproduced** → both fetchers count attempts, statuses, retries, and backoff seconds, and each live command reports monotonic elapsed (R20); the Phase B arithmetic is then re-derived from measurement instead of the planning prior.
- **Modern rows mask unresolved 2015 members** → per-era join coverage (R15) plus the runbook's read-only cross-check; aggregate join coverage is never used as the era's evidence.
- **`congress-legislators` lacks the historical file** → verified before the era join (Rollout stage B step 2); absence is a recorded Phase A finding, not an assumption.
- **The enlarged corpus breaks publication or blows the page budget** → the acceptance now runs build → publish → verify with feed/slice assertions and a hard `published_files <= 4000` check (R16), and the same body runs on the real Phase A corpus (R18).
- **404 PTR freezes as durable empty** → mirror the inst non-200 guard (`inst13f.py:389-397`): never checkpoint/archive a non-200; `raw_path` stays NULL, re-fetch-eligible.
- **Gate divide-by-zero** → row rate `None` when `efile_rows == 0`, measurable share `None` only when `efile_filings == 0`; the status table makes every combination explicit and `None` never reads as a pass except at a provably empty census.
- **Schema drift** → `stats.schema.json` `additionalProperties:false`; update in lockstep or `test_stats` fails (which is the guard).
- **Acceptance depends on gitignored `data-cache/`** → forbidden; every hermetic acceptance input is a committed `tests/fixtures/` file. Stage B is the only consumer of `data-cache/` and `ops/`.
- **Cross-year pair needs a new amendment page** → avoided by the synthetic-index pattern (`test_senate_ingest.py:1251-1277`) pointing at committed pages.
- **Byte-stability regressions** in `stats.json` → reuse `render_stats(sort_keys=True)`; nested dicts sorted.
- **dep_guard trip** → no new dependency is added; gate stays green.
- **Politeness drift under stage B** → the floors are code constants (`house.py:53`, `senate.py:60`) and are untouched; the runbook adds no concurrency and no override.

## Definition of Done

- **R1** — Shared `ingest/checkpoint.py` created; `inst13f` uses it with back-compat aliases; full inst suite green (byte-identical behaviour).
- **R2** — House PTR fetch writes `pdfs/<year>/<DocID>.pdf.fetch-meta.json` checkpoint-first with §5.1 fields; index sidecar carries `response_hash`; non-200 never archived; cache-mode unchanged.
- **R3** — Settled eligibility re-hashes the archive against `filings.response_hash`; missing and corrupt archives each refetch exactly once on the same database; a fresh database re-reads the verified archive with zero PTR transport — proven by tests + acceptance.
- **R4** — `parse_gate.compute_parse_gate` returns per-`(chamber, year)` e-file **filing** and **row** censuses, judges the row rate at 0.97, and yields `pass`/`miss`/`unmeasurable`/`no_efile_filings`; **any** filing with an unknown expected row count forces `unmeasurable` (no tolerance band), and `no_efile_filings` is reachable only at a zero census — tested, including complete-failure, mixed-failure, and single-unknown-filing eras.
- **R5** — `miss` and `unmeasurable` eras produce an explicit `OWNER DECISION REQUIRED` report (era, row rate labelled a floor when the denominator is unknown, unmeasurable count and share, options a/b/c) in `format_summary` and the acceptance, severity-ranked with no era suppressed; no silent proceed or weakened gate — tested.
- **R6** — `stats.json` carries both additive per-year keys with the existing shape intact; schema updated; render byte-stable — tested.
- **R7** — 2015 paper fixtures → `needs_ocr`, retained + counted + excluded from both censuses — tested; the real 2015 paper share is measured in stage B.
- **R8** — Archive-only reparse-by-version re-stamps + re-evaluates historical filings with no transport; discipline documented; no parser fork/change — tested.
- **R9** — Member-join measured over the era via temporal aliases; unjoined visible+flagged+counted — tested hermetically and measured on the real 2015 era.
- **R10** — Cross-year Senate pair links (`supersedes`), both sides flagged, `v_default` excludes the original; no amendment-semantics change — tested and measured live.
- **R11** — `make accept-m1-b` exits 0, hermetic, never skips, printing measured per-era figures and exercising both below-gate surfacings plus the resume proofs; committed era fixtures present.
- **R12** — Phase B sizing (bounded-N arithmetic table) written with its authorization condition stated; nothing of Phase B executed in this run.
- **R13** — `make test` (≥1645, no regressions), `make security`, `make accept-m1-b` all green; every behavioural fix mutation-verified; Changed Files reconciled vs `git status`; deviations stated.
- **R14** — The Senate client accepts optional submitted-date start/end bounds, defaults byte-identically to today's watermark behaviour, and exposes `--submitted-start`/`--submitted-end` scoped to `congress-senate` — both bounds and the unchanged default proven by tests, and used live in stage B.
- **R15** — Per-`(chamber, year)` member-join coverage is DB-derived, surfaced in the gate report and in `stats.json`, cross-checkable by the recorded read-only query; the `congress-legislators` historical inputs are verified before the era join; joined/total/unresolved 2015 figures appear in the Phase A artifact.
- **R16** — The acceptance chain runs build → publish → verify hermetically; `congress/feed.json` is asserted to equal the database's expected latest 500 (same ids, same order) and is never required to contain an era row; historical publication is proven by the per-era `stats.json` keys plus the DB-selected member/ticker slices that carry era rows; member pages, ticker pages, and published files are measured against the ≤4,000 M1 budget, failing above it.
- **R17** — The Phase A database was resolved from the current published manifest, sha256/size-verified against its `congress.db` artifact entry, copied through SQLite's backup API, and passed `PRAGMA integrity_check` plus the expected current-corpus counts before ingestion; the live Phase A then ran inside this run at the unchanged politeness floors (real House 2015 + the Senate `01/01/2015 → 03/31/2016` window), and every brief-named measured figure — including the source `build_id` — is recorded verbatim in `docs/build/RUN-M1-B-phase-a.md`.
- **R18** — `scripts/accept_m1_b.py` ran against the real Phase A database through the same shared assertion body and passed on the correctly generated enlarged corpus; its result, the measured entity counts, and the published file count vs the ≤4,000 budget are recorded before the run closes.
- **R19** — The run halted at the Phase A stop point: the gate report, the decision artifact, and options (a)/(b)/(c) are reported to the owner, and no Phase B work was performed or scheduled by this run.
- **R20** — Both polite fetchers report `attempts`, `status_counts`, derived `retries`, and `backoff_sleep_s`, and both ingests report monotonic `elapsed_s`; the values print in `format_summary`; retry and no-retry paths and the elapsed capture are tested; the live figures for each stage B command are recorded in the Phase A artifact and used to re-derive the Phase B arithmetic.
