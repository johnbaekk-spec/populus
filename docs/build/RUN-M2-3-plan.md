I now have every contract I need, all verified against source. Key resolutions confirmed:
- **F1**: `test_manifest_requires_congress_module` (`test_publish.py:1497`) calls `validate_manifest(base)` with defaults and only checks `"congress" in error` — a default `required_modules=frozenset({MODULE})` keeps it green while a `required_modules=frozenset()` call gives generic inst-only validation; unknown modules (`weather`/`senate`/`house`) get rejected too, which the test tolerates.
- **F2**: `securities-continuity.yaml` models exactly the reported-CUSIP-with-gap case; `security_id` is the correct cross-quarter identity.
- **F4**: `ssh_prnamt_type`/`put_call` are separate nullable columns (`normalize_inst.py:146-147`).
- **F7**: `_publish_rollback` (`build.py:1689`) is a one-line loop generalization; existing rollback-refusal tests (`test_publish.py:899/920`) are the template.
- **F8**: keep the journal-first ordering; the post-journal/pre-inst fresh-runner window is refused loudly and resolved by the *existing* drafts-only cleanup (`rollback.md` Appendix A) — consistent with the project's owner-accepted safe-refuse pattern.

Here is the complete, revised plan.

## Goal and Success Criteria

**Goal.** Deliver RUN M2-3: build cross-filer 13F aggregates into a fresh, reproducible `inst_agg.db` with historically-sound identity; wire an `inst` module through the M1 publish substrate (manifest, logical digest, verify, **rollback, recovery, snapshot access**); and enforce the M2 ≥95% value-coverage gate **fail-closed** — with the owner-accepted outcome that `inst` does not publish on the FTD-only corpus while `congress` publishes normally.

**Success criteria.**
- `make check` green (`make test` = `uv sync --frozen` + `uv run pytest -q`; `make security` = `uv run python scripts/dep_guard.py`) — all **1247** existing tests unchanged, plus new tests for aggregates, multi-module manifest, inst two-build reproducibility, the coverage gate, rollback, fresh-runner recovery, and module-aware snapshot access.
- `inst_agg.py` contains zero network primitives (`tests/test_dep_guard.py` green).
- **Two split acceptance cases:** (A10a) FTD-only real Berkshire data → gate withholds `inst`, `congress` publishes and verifies, Berkshire QoQ validated pre-publication; (A10b) a fully-covered deterministic corpus → both modules publish and `verify` recomputes both.
- QoQ deltas correct across a security's CUSIP change and reporting-gap; top-holders ranked per *issuer*; Δshares unit-safe; concentration NULL/zero-safe.
- The gate ships at exactly `COVERAGE_THRESHOLD = 0.95`, keyed on the `cover_failed` flag, consuming `compute_coverage(...).meets_threshold` — never re-derived, never widened by FTD inference.

## Requirements

- **R1 — Cross-filer aggregates** in `src/populus/inst_agg.py` from `v_default_holdings`/`v_default_inst_filings`, deterministic, with sound identity contracts: **(a) filer registry** (CIK, name, latest period, position count incl. NULL-value rows, total non-NULL `value_usd`); **(b) QoQ deltas** per filer×**security** keyed on as-of `security_id` first (reported-CUSIP reconciliation only where safe; never name, never G14 chaining), grain including `put_call`+`ssh_prnamt_type`, Δvalue always/Δshares unit-guarded; **(c) top-holders per *issuer*** (aggregate a filer's securities by issuer/entity before ranking); **(d) concentration** (per-filer top-N share + integer HHI) with defined NULL/zero-total behavior. Fresh `inst_agg.db`, schema owned here.
- **R2 — Manifest `inst` module (§5.5)**: `modules.inst` with `schema_version`, PEP 440 `client_compat`, `deprecation`, `normalization_version`, `digest_projection_version`, `watermarks` (latest `period_of_report`/`filed_date`), `artifacts[]` (`inst_agg.db` + `sha256`/`bytes`/locator/`license_ids` incl. `sec-edgar`), and an **inst logical-digest projection v1** (allowlist aggregate tables minus volatile `ingested_at`; RFC 8785 rows, PK-sorted, `T:<table>\n` framing).
- **R3 — Generalize `build.py`** to assemble `congress`+`inst` under `builds/<build_id>/` without breaking M1; journal stays congress-scoped; the inst asset upload preserves the journal-first / publish-release / pointer-last ordering.
- **R4 — `manifest.py` admits modules; `verify` recomputes both.** Generic structural validation admits ≥1 **known**, well-formed module (unknown modules rejected); the congress requirement becomes a separable **standard-build** parameter (default on) so an inst-only manifest can validate generically. `populus verify` recomputes **all** artifact hashes + **both** module logical digests + pointer/manifest consistency.
- **R5 — Two-build reproducibility (P1 gate, §17):** two independent inst builds yield an identical inst logical digest.
- **R6 — Snapshot serve:** `SnapshotClient(module="inst")` reads back an aggregate **through the public DB accessor** (not private cache layout).
- **R7 — M2 ≥95% gate, fail-closed, in build/publish.** Consume `compute_coverage(conn).meets_threshold` (threshold `0.95`); keep `certifiable` distinct; cover-failure via the `cover_failed` flag (`cover_failed_count`), never `total IS NULL`; refuse when `meets_threshold` false (coverage<0.95, `denominator=0`, or `cover_failed_count>0`). No threshold change, no FTD widening. Notice-only regression test included. Acceptance asserts the gate refuses `inst` on the FTD-only corpus while `congress` publishes.
- **R8 — CLI wiring:** aggregate build + gate into `populus build`/`publish`, plus a `populus inst-agg` builder, in `cli.py`.
- **R9 — No regressions / canonical gate:** `make check` green (frozen install + full suite + G1 dep-guard) with 1247 prior tests unchanged; `inst_agg.py` trips no network-primitive/vendor guard.
- **R10 — Acceptance (split):** **R10a** FTD-only real Berkshire → `inst` withheld (below-threshold), `congress` publishes/verifies, Berkshire 2025-Q4→2026-Q1 QoQ validated pre-publication, second build bumps `pointer_version`, unchanged re-poll idempotent; **R10b** fully-covered deterministic corpus → both modules publish and `verify` recomputes both.
- **R11 — Rollback preflight generalized** across every module and artifact (`_publish_rollback`), refusing a rollback whose `inst_agg.db` is missing/corrupt.
- **R12 — Multi-module recovery boundary** specified and executable: the inst asset upload's crash boundaries on a fresh runner are enumerated; the narrow post-journal/pre-inst-upload window refuses loudly and resolves via the existing drafts-only cleanup + rebuild; fresh-runner crash-boundary tests cover it.
- **R13 — Module-aware snapshot DB accessor:** `SnapshotClient.db_path()` (and any public artifact accessor) resolves the *module's* DB artifact, not the hardcoded `congress.db`.

## Scope

One coherent slice — cross-filer aggregates + multi-module publish integration — one new module plus edits to the publish substrate, the snapshot client, the CLI, and one runbook:

- **New:** `src/populus/inst_agg.py`, `src/populus/inst_agg.sql`, `tests/test_inst_agg.py`.
- **Edit (source):** `src/populus/publish/digests.py`, `src/populus/publish/manifest.py`, `src/populus/publish/build.py`, `src/populus/client/snapshot.py`, `src/populus/cli.py`.
- **Edit (docs):** `docs/runbooks/disaster-recovery.md` (multi-module recovery boundary).
- **Edit (tests):** `tests/test_publish.py`, `tests/test_digests.py`, `tests/test_inst_ingest.py`.

## Non-goals

- **Inst MCP tools / `populus_health` inst module** (`mcp_server/*` hardcodes `modules:["congress"]`) — RUN M2-4.
- **`scripts/monitor.py` inst-awareness** — the monitor consumes only standard-build manifests (congress guaranteed present by R4's standard-build default), so its unconditional congress dereference stays safe; no monitor change this run.
- **Dashboard JSON slices / `/institutional`** — P3; `inst_agg.db` is the sole `inst` artifact.
- **Widening the recovery journal to a multi-DB envelope** — kept congress-scoped (DR-5 git-size); the inst asset is recovered as a draft asset / regenerated (R12).
- **Making the gate pass** — no identifier-history source admitted; FTD-only stays fail-closed per the OWNER DECISION.
- **Attestations / `verify --remote` (P2); dist/inventory tree digest (§12.1, dashboard/P3)** — `inventory.py`/`dist_digest` are not wired into the build pipeline.

## Constraints

- **Gate ships exactly as specified** (OWNER DECISION 2026-07-24): threshold `≥0.95`, fail-closed accepted; do not lower it, do not widen FTD by inference. Reuse `compute_coverage`; never re-key cover-failure off `total IS NULL`.
- **Canonical gate is `make check`** (`Makefile:15-31`): `make test` runs `uv sync --frozen` then `uv run pytest -q`; `make security` runs `uv run python scripts/dep_guard.py`. `scripts/dep_guard.py` is invoked as `uv run python scripts/dep_guard.py`, not as a bare executable.
- **No regressions:** every one of the 1247 tests stays green; `test_manifest_requires_congress_module` (`test_publish.py:1497`) and `test_manifest_requires_full_mandatory_artifact_set` (`:1521`) stay green unchanged.
- **Determinism:** explicit `ORDER BY`/`sorted()`; integer-only numeric columns in projected tables (dollar sums, share counts, basis-point shares, integer HHI); no floats in any digest-projected column. A legitimately unavailable concentration is stored **NULL** (distinguishable from `0` in the digest), never a fake zero.
- **G14 (no identity time-travel):** QoQ joins on as-of `security_id`; reported-CUSIP reconciliation is within one filer's own consecutive filings only; never CUSIP→current-ticker→CIK, never issuer-name matching across quarters.
- **G3 (never drop):** unmapped/unkeyable/NULL-value holdings are retained, counted, and flagged.
- **No network in library code/tests:** `inst_agg.py` is pure DB→DB (guarded by `tests/test_dep_guard.py:227` + autouse `_no_network`, `conftest.py:14`).
- **G1 (no vendor deps):** reuse only declared deps (`pyproject.toml:10-20`).
- **Python 3.12 + uv; SQLite via stdlib `sqlite3`; RFC 8785 via `rfc8785`;** packaged `.sql` applied via `importlib.resources`+`executescript`.

## Current State

- **Publish substrate (M1):** `run_build`/`run_publish`/`run_verify` (`build.py:1285/1741/1912`); `_complete_build` (`build.py:981`) drives the P1 order **journal-first → `congress.db` (from journal) → `publish_release` → materialize → pointer-last**; `reconcile_inflight` (`build.py:1126`) completes an in-flight build from the data-repo + remote journal alone; `_recover_journal` sources the journal (remote first, staged else). Backend Protocol (`build.py:125-155`): `upload`/`verify_asset`/`ensure_draft`/`publish_release`/`delete_release` (drafts-only, operator-only). `_publish_rollback` verifies **only** `manifest["modules"][MODULE]["artifacts"]` (`build.py:1689`).
- **Recovery contract** (`docs/runbooks/disaster-recovery.md:76-116`): the journal is the durable recovery anchor; a draft *before* the journal, or a draft with no valid remote journal, is **safe-refuse + rebuild** / drafts-only cleanup — never silently completed. `rollback.md:71-88` Appendix A is the executable drafts-only cleanup (`gh release delete` + `rm -rf .staging/<id>`); `next_build_id` burns interrupted ids. Fresh-runner drill: `test_fresh_runner_completes_same_build_at_every_boundary` (`test_publish.py:610`).
- **Manifest (`manifest.py`):** `MODULE="congress"` (`:26`); `validate_manifest(manifest, *, register_ids=None)` (`:268`) requires `congress` (`:307`), enforces `REQUIRED_CONGRESS_ARTIFACTS` only for congress (`:379`), validates watermarks against `WATERMARK_KEYS` (`:348`); `_validate_artifact` requires `logical_digest` only for `DB_ARTIFACT` (`:258`). Callers — all standard-build: `snapshot.py:529`, `build.py:739/1543/1680/2003`.
- **Digests (`digests.py`):** single global `LOGICAL_PROJECTION_V1` (`:27`); `logical_digest(conn)` (`:117`); `_table_columns` requires a PK; BLOB fails hard.
- **Snapshot client (`snapshot.py`):** module-keyed (`module=`, grammar `:57`), but `db_path()` hardcodes `DB_ARTIFACT` (`:308`); the integrity check is module-agnostic (`.endswith(".db")`, `:595`); `validate_manifest(manifest)` at `:529`.
- **Identity substrate (`registry.sql`):** `securities(security_id PK, entity_id → entities, entity_link_state ∈ {unresolved,resolved,conflict}, …)` (`:31-50`); `security_identifiers` one-to-many dated CUSIP intervals (`:63-80`). ARCHITECTURE.md:247: "A company has many securities; CUSIPs change on corporate actions." `securities-continuity.yaml` fixtures model a reported-CUSIP reporting-gap.
- **M2-2 layer:** `inst.sql` (`inst_holdings` has `security_id` `:104`, `value_usd` `:111` nullable, `ssh_prnamt`/`ssh_prnamt_type` `:112-113`, `put_call` `:114`, `cusip` `:106`); `views.sql` (`v_default_inst_filings` `:55`, `v_default_holdings` `:86`); `compute_coverage`/`InstCoverage`/`COVERAGE_THRESHOLD=0.95` (`ingest/inst13f.py:835-891`), reported but **not enforced** (CLI exits only on `not report.ok`, `cli.py:310`). `normalize_inst`: `ssh_prnamt_type`/`put_call` (`:146-147`), `_PUT_CALL` map + `put_call_unparsed` (`:206-210`).
- **DB idiom:** `init_db`→`ensure_registry`/`ensure_inst_schema`/`ensure_views` (`db.py:40-77`); `ensure_inst_schema` reads packaged `inst.sql` (`load.py:23`).
- **CLI:** Click; `build`/`publish`/`verify` (`cli.py:591/643/690`); `ingest inst-13f` (`:254`); no `inst-agg` yet.
- **Licenses:** `licenses.ingestible_ids(register)` includes `sec-edgar`+`sec-ftd` (`licenses.py:88`); `run_build` tags data artifacts with them (`build.py:1505`).

## Detected Stack

- Python `>=3.12`; Hatchling (packages `src/populus`, so packaged `.sql`/`.json` ship in the wheel).
- **Runner `uv`; canonical repository gate `make check`** = `make test` (`uv sync --frozen` + `uv run pytest -q`) + `make security` (`uv run python scripts/dep_guard.py`), `Makefile:15-31`.
- CLI: Click (`cli.py:49`); entry `populus = populus.cli:main`.
- SQLite via stdlib `sqlite3` (FK-on via `db.connect`); packaged DDL `.sql` + `executescript`.
- Canonicalization: `rfc8785` via `populus.canonical.canonical_json` (`canonical.py:35`).
- Deps: `httpx`, `lxml`, `packaging`, `pdfplumber`, `pypdf`, `pyyaml`, `click`, `rfc8785`, `mcp`; test deps `pytest`, `jsonschema`.
- Tests: `testpaths=["tests"]`; flat `tests/` (~1247 collected); autouse network block; guards `scripts/dep_guard.py` + `tests/test_dep_guard.py`.

## Reuse Map

| Existing symbol / path | Decision | Why |
|---|---|---|
| `compute_coverage`/`InstCoverage`/`COVERAGE_THRESHOLD` (`ingest/inst13f.py:835-891`) | **Reuse verbatim** as the gate | Never-inflated inputs; flag-keyed cover-failure; `certifiable` vs `meets_threshold` already separated. |
| `v_default_holdings`/`v_default_inst_filings` (`views.sql:55-89`) | **Reuse** as aggregate + gate source | Authoritative default population. |
| `securities`/`security_identifiers` (`registry.sql:31-80`) | **Reuse** for identity | `security_id` = stable cross-quarter identity (F2); `securities.entity_id` = issuer link (F3). |
| `logical_digest`/`_table_columns`/`DigestError`/`LOGICAL_PROJECTION_V1` (`digests.py`) | **Extend** — add `projection` param + `LOGICAL_PROJECTIONS` map | Byte-exact framing exists; inst needs a second allowlist. |
| `validate_manifest`/`build_manifest`/`ArtifactEntry`/`find_artifact`/`module_artifacts`/`REQUIRED_CONGRESS_ARTIFACTS`/`WATERMARK_KEYS`/`MODULE` (`manifest.py`) | **Extend** — per-module policy + `required_modules` param; inject `inst` post-assembly | Shape+loop already generic; only policy is congress-pinned. |
| `run_build`/`run_publish`/`run_verify`/`_complete_build`/`reconcile_inflight`/`_publish_rollback`/backends (`build.py`) | **Extend** minimally | Keep journal/pointer/P1 order; add inst assembly, gate, one asset upload, all-modules verify+rollback loops. |
| `SnapshotClient`/`db_path` (`snapshot.py`) | **Extend** — module-aware DB accessor (F6/R13) | `db_path` hardcodes `DB_ARTIFACT`; the client is otherwise module-keyed. |
| `_complete_build` journal/DB verify-then-upload block (`build.py:1030-1066`) | **Mirror** for the inst asset | Same verify-then-upload-from-staging shape, sourced from staged `assets/`. |
| `test_fresh_runner_completes_same_build_at_every_boundary` (`test_publish.py:610`); rollback-refusal tests (`:899/920`); `seed_db`/`pin`/`make_repo`/`publish_build` (`:61-122`); `make_security_identifier` (`conftest.py:266`); real Berkshire + crafted + `securities-continuity.yaml` fixtures | **Reuse / mirror** | Proven harnesses for recovery, rollback, digest, gate, and identity tests. |
| `licenses.ingestible_ids`/`register_ids`; `canonical_json`; `init_db`/`ensure_*` | **Reuse** | License ids (`sec-edgar`+`sec-ftd`), RFC 8785 seam, packaged-`.sql` DB idiom. |

## Architecture

**1. `inst_agg.py` + `inst_agg.sql` (R1).** `build_inst_agg(source_conn, dest_path)`: `ensure_views(source_conn)`; create `inst_agg.db`, `executescript` `inst_agg.sql` (idempotent DDL); populate deterministically from `v_default_holdings`/`v_default_inst_filings` joined to `securities` (for issuer/entity link), integer math throughout. Tables (all with explicit PKs; each carries a volatile `ingested_at` excluded from the projection):

- **`agg_filer_registry`** (PK `cik`): `filer_name`, `latest_period` (`MAX(period_of_report)`), `position_count` (**all** retained holdings, incl. NULL-value), `total_value_usd` (`COALESCE(SUM(value_usd),0)` over non-NULL), `null_value_positions`, `unkeyed_positions`.
- **`agg_qoq_deltas`** (PK `cik, position_key, put_call, curr_period`) — **F2/F4 identity contract:**
  - `position_key` = `'sid:'||security_id` when resolved on the holding; else `'cusip:'||cusip`; else the holding is **unkeyable** (counted in `unkeyed_positions`, excluded from QoQ).
  - Matching across a filer's two consecutive `period_of_report`s: **pass 1** equal as-of `security_id` (correct across a CUSIP change — the registry resolves both CUSIPs to one `security_id`); **pass 2** for still-unmatched rows, an **exact reported-CUSIP** match within the same filer's adjacent quarters (bridging a resolved/unresolved boundary), flagged `identity_reconciled_by_cusip`; remaining unmatched → genuine `new`/`exit`. Never match by issuer name; never chain to current mappings (G14).
  - **Grain** includes `put_call` (PUT/CALL/long are distinct positions) and `ssh_prnamt_type`. `change_kind ∈ {new,add,trim,exit}`. `delta_value_usd` always computed; `delta_shares` computed only when `ssh_prnamt_type` is equal both quarters, else NULL + flag `shares_unit_mismatch`. add/trim classified by Δshares when units compatible, else by `delta_value_usd` + flag `classified_by_value`.
- **`agg_issuer_top_holders`** (PK `issuer_key, period_of_report, rank`) — **F3 issuer contract:** `issuer_key` = `'entity:'||entity_id` when the security resolves to a `securities` row with `entity_link_state='resolved'` and non-null `entity_id`; else `'cusip6:'||substr(cusip,1,6)` (issuer block, flag `issuer_from_cusip6`); else `'name:'||normalized(issuer_name_raw)` (flag `issuer_from_name`). A filer's `value_usd` is **summed across all its securities sharing an `issuer_key`** for the period **before** ranking `value_usd DESC, cik ASC`; top-N (default 25, recorded in `agg_build_meta`). Carries `issuer_name`, `security_count`.
- **`agg_filer_concentration`** (PK `cik, period_of_report`) — **F5 null/zero contract:** `position_count` (all), `total_value_usd` (`COALESCE(SUM(value_usd),0)`), `null_value_positions`, `topn_value_usd`, `topn_share_bps` (`topn_value_usd*10000/total_value_usd`) and `hhi` (`Σ(value_i^2)*10000/total^2`, integer) computed **only when `total_value_usd>0`**; when `total_value_usd=0` (or all values NULL) both are **NULL** + flag `concentration_unavailable`. Never divide by zero.
- **`agg_build_meta`** (PK `key`) — `topn`, source `normalization_version`, params; **excluded entirely** from the projection (the `ingest_runs` analogue).

**2. Per-module logical digest (`digests.py`, R2/R4/R5).**
```python
LOGICAL_PROJECTIONS = {"congress": {...current...},
                       "inst": {t: frozenset({"ingested_at"}) for t in
                                ("agg_filer_registry","agg_qoq_deltas",
                                 "agg_issuer_top_holders","agg_filer_concentration")}}
LOGICAL_PROJECTION_V1 = LOGICAL_PROJECTIONS["congress"]        # back-compat alias
LOGICAL_PROJECTION_VERSIONS = {"congress": "1", "inst": "1"}
def logical_digest(conn, projection=LOGICAL_PROJECTION_V1) -> str: ...
def _table_columns(conn, table, projection): ...
```
Existing callers pass nothing (congress default); the inst caller passes the inst projection. Framing/`# nosec B608`/BLOB-fails-hard unchanged; nullable aggregate columns emit SQL `NULL`→JSON `null` (distinguishable from `0`).

**3. Manifest admits `inst` (`manifest.py`, R4/F1).**
```python
INST_MODULE="inst"; INST_DB_ARTIFACT="inst_agg.db"; INST_SCHEMA_VERSION="1.0"
INST_CLIENT_COMPAT=">=0.0.1,<1"; REQUIRED_INST_ARTIFACTS=("inst_agg.db",)
INST_WATERMARK_KEYS=("latest_period_of_report","latest_filed_date")
_MODULE_POLICY={"congress":{"required":REQUIRED_CONGRESS_ARTIFACTS,"watermarks":WATERMARK_KEYS,"db_artifact":DB_ARTIFACT},
                "inst":{"required":REQUIRED_INST_ARTIFACTS,"watermarks":INST_WATERMARK_KEYS,"db_artifact":INST_DB_ARTIFACT}}
_DB_ARTIFACTS={DB_ARTIFACT, INST_DB_ARTIFACT}
def module_db_artifact(module) -> str: return _MODULE_POLICY[module]["db_artifact"]
def validate_manifest(manifest, *, required_modules=frozenset({MODULE}), register_ids=None): ...
```
Generic validation (always): `modules` non-empty; **every present module name ∈ `_MODULE_POLICY`** (unknown → defect); each module well-formed per its policy (watermark keys, required artifacts); any name in `_DB_ARTIFACTS` requires `logical_digest`. **Standard-build requirement (separable):** `required_modules` (default `{congress}`) additionally requires those names present. All five existing callers keep the default → congress enforced → `test_manifest_requires_congress_module`/`…full_mandatory_artifact_set` stay green; generic/inst-only validation is `validate_manifest(m, required_modules=frozenset())`. `build_manifest` unchanged; `build.py` injects the `inst` module into `manifest["modules"]` before validation.

**4. `build.py` emits `inst` + gate (R3/R7) with recovery-safe upload (R12).** In `run_build`, guard on inst data (`SELECT 1 FROM v_default_inst_filings LIMIT 1`); absent → byte-identical M1 build. Present: build `inst_agg.db` into staged `assets/`; `coverage = compute_coverage(snapshot)`; if `not meets_threshold` → record `BuildReport.inst_withheld={reason∈{cover_failed,not_measurable,below_threshold}, denominator, numerator, coverage, cover_failed_count, certifiable}` and omit the inst module; else compute `inst_logical = logical_digest(agg_conn, LOGICAL_PROJECTIONS["inst"])`, inst watermarks (`MAX(period_of_report)`/`MAX(filed_date)`), inject the inst module (artifact `inst_agg.db` with `logical_digest`/`sha256`/`bytes`/`license_ids=sorted(ingestible_ids(register))`). `_complete_build`: **keep journal-first / publish-release / pointer-last**; add, after the `congress.db` step and before `publish_release`, a verify-then-upload of `inst_agg.db` sourced from staged `assets/` (mirroring `build.py:1051-1064`); the published-immutable `else` branch also verifies `INST_DB_ARTIFACT`. `run_verify`: iterate **all** `manifest["modules"]`, recompute every local `path` artifact's size+sha and each module's DB artifact `logical_digest` under `LOGICAL_PROJECTIONS[module_name]`; keep identity + licensing checks.

**5. Rollback preflight generalized (`build.py:1689`, R11).** Replace `for entry in manifest["modules"][MODULE]["artifacts"]` with `for module in sorted(manifest["modules"]): for entry in manifest["modules"][module]["artifacts"]:` — the existing per-artifact path/URL verification then covers `inst_agg.db`; a missing/corrupt inst asset refuses the repoint.

**6. Recovery boundary (R12/F8), executable + documented.** Ordering unchanged (journal remains the recovery anchor). Fresh-runner crash boundaries for an inst-bearing build: **(i)** before the journal → existing safe-refuse + rebuild-from-source (regenerates `inst_agg.db`); **(ii)** after `congress.db`, before the inst upload, staging lost → `reconcile_inflight`/`_complete_build` finds the inst module in the journal's manifest but `inst_agg.db` is neither a present draft asset nor in staging → **refuse loudly** (specific error: regenerable asset unrecoverable from the congress-scoped journal; release still a draft, pointer unmoved) → operator runs the **drafts-only cleanup** (`rollback.md` Appendix A) → rebuild under a new `build_id` regenerates it; **(iii)** after the inst upload → `verify_asset` finds it present → completes; **same-runner** recovery (staging intact) re-uploads from staging → completes automatically. `docs/runbooks/disaster-recovery.md` gains this boundary statement.

**7. Snapshot DB accessor (`snapshot.py`, R6/R13).** `db_path()` resolves `module_db_artifact(self._module)` instead of `DB_ARTIFACT`; the R6 integration test opens `inst_agg.db` through `SnapshotClient(module="inst").db_path()`.

**8. CLI (`cli.py`, R8).** Add `populus inst-agg --db <populus.db> --out <inst_agg.db>` (wraps `build_inst_agg`). `populus build` runs the inst assembly + gate atomically; `build`/`publish` surface the withheld-notice.

## Locked Decisions

1. **Manifest: generic-first validation with a separable standard-build congress requirement** (`required_modules` param, default `{congress}`); unknown modules rejected. Keeps all callers + existing tests green; admits generic inst-only validation. (F1)
2. **QoQ identity is `security_id`-first**, with exact reported-CUSIP reconciliation only within a filer's own adjacent filings, flagged; never name, never G14 chaining. Correct across CUSIP changes and reporting gaps. (F2)
3. **Top-holders ranked per *issuer*** — a filer's securities summed by `issuer_key` (`entity_id` resolved, else CUSIP-6, else name, flagged) before ranking. (F3)
4. **QoQ grain includes `put_call` + `ssh_prnamt_type`;** Δshares only within equal `ssh_prnamt_type` (else NULL+flag); Δvalue always. (F4)
5. **NULL/zero contracts:** `position_count` counts all rows; `total_value_usd` sums non-NULL (`null_value_positions` surfaced); concentration NULL+flag when total ≤ 0 — never divide by zero, never a fake-zero HHI. (F5)
6. **Snapshot `db_path()` is module-aware** via `module_db_artifact`; R6 uses the public accessor. (F6)
7. **Rollback preflight loops all modules' artifacts.** (F7)
8. **Recovery keeps the journal congress-scoped and journal-first**; the inst asset is recovered as a present draft asset or regenerated; the narrow fresh-runner window refuses loudly and uses the existing drafts-only cleanup + rebuild. (F8)
9. **Acceptance is split** into R10a (FTD-only real → withhold inst, publish/verify congress, Berkshire QoQ pre-publication) and R10b (fully-covered deterministic → publish/verify both). (F9)
10. **Gate command is `make check`** (frozen install + suite + G1); `dep_guard` invoked as `uv run python scripts/dep_guard.py`. (F10)
11. **Integer-only projected numerics; volatile `ingested_at` and `agg_build_meta` excluded from the inst projection.**
12. **The gate is enforced at build time** by conditionally emitting the inst module; `build_manifest` unchanged (post-assembly injection).

## Alternatives Considered

- **Drop the universal congress requirement from `validate_manifest`.** Rejected — would regress `test_manifest_requires_congress_module`; the parameterized default preserves it while separating the generic contract. (F1)
- **QoQ keyed on reported CUSIP always.** Rejected — a CUSIP change fabricates false exit+new; `security_id`-first is the historically-safe key. (F2)
- **Backfill a filer's `security_id` across its own quarters to bridge registry gaps.** Rejected as too aggressive; the conservative exact-reported-CUSIP reconciliation (flagged) is safer and G14-clean. (F2)
- **Top-holders keyed by CUSIP/security.** Rejected — splits an issuer's share classes; issuer/entity aggregation is required. (F3)
- **Upload `inst_agg.db` *before* the journal for fully-automatic fresh-runner recovery.** Considered; rejected in favor of preserving the documented journal-first ordering — the same-runner path auto-completes and the rare fresh-runner window uses the existing owner-accepted drafts-only cleanup, matching the project's established safe-refuse pattern with no ordering change. (F8)
- **Commit `inst_agg.db` to git / inline it in the journal.** Rejected — DR-5 git-bloat.
- **Parameterize `build_manifest` for multiple modules.** Rejected — post-assembly injection is zero-regression.
- **Float concentration/HHI.** Rejected — integer bps/points keep the digest reproducible and nullness explicit.

## Planned Files

- `src/populus/inst_agg.py` — NEW: `build_inst_agg(source_conn, dest_path)` + aggregate logic (R1).
- `src/populus/inst_agg.sql` — NEW: `agg_filer_registry`, `agg_qoq_deltas`, `agg_issuer_top_holders`, `agg_filer_concentration`, `agg_build_meta` (R1).
- `src/populus/publish/digests.py` — EDIT: `LOGICAL_PROJECTIONS`/`LOGICAL_PROJECTION_VERSIONS`/`logical_digest(conn, projection=...)`/`_table_columns(...,projection)` (R2/R4/R5).
- `src/populus/publish/manifest.py` — EDIT: `INST_*`, `_MODULE_POLICY`, `_DB_ARTIFACTS`, `module_db_artifact`, `validate_manifest(..., required_modules=...)`, `_validate_artifact` (R2/R4/R13).
- `src/populus/publish/build.py` — EDIT: inst assembly + gate + `BuildReport.inst_withheld` (`run_build`); inst asset verify-then-upload (`_complete_build`); all-modules `run_verify`; all-modules `_publish_rollback`; recovery-boundary handling (R3/R4/R7/R11/R12).
- `src/populus/client/snapshot.py` — EDIT: module-aware `db_path()` (R6/R13).
- `src/populus/cli.py` — EDIT: `populus inst-agg`; surface withheld-notice (R8).
- `docs/runbooks/disaster-recovery.md` — EDIT: multi-module recovery boundary + drafts-only cleanup reference (R12).
- `tests/test_inst_agg.py` — NEW: aggregate contracts (R1a-d), CUSIP-change/gap continuity (R1b/F2), issuer aggregation (R1c/F3), SH/PRN + put_call grain (R1b/F4), NULL/zero concentration (R1d/F5), inst two-build reproducibility (R5), real Berkshire QoQ (R10a).
- `tests/test_publish.py` — EDIT: generic/inst-only + unknown-module + inst-defect manifest validation (R4/F1), fail-closed/notice-only/certifiable-vs-threshold gate (R7), both-module publish + verify (R4/R10b), module-aware snapshot serve (R6/R13), all-modules rollback refusal (R11), fresh-runner inst crash-boundary + drafts-only recovery (R12), pointer bump + idempotent re-poll (R10a).
- `tests/test_digests.py` — EDIT: inst projection framing/exclusions/nullness + reproducibility (R2/R5).
- `tests/test_inst_ingest.py` — EDIT: extend the notice-only guard into the gate/build path (R7).

## Implementation Tasks

1. **(R1)** Author `inst_agg.sql` (five tables, integer columns, explicit PKs, nullable-where-specified) and `build_inst_agg`: filer registry with NULL-aware counts/sums (R1a/F5); QoQ with `security_id`-first identity + reported-CUSIP reconciliation + `put_call`/`ssh_prnamt_type` grain + unit-guarded Δshares (R1b/F2/F4); issuer-aggregated top-N holders via `securities.entity_id`→CUSIP-6→name fallback (R1c/F3); concentration with zero-total NULL contract (R1d/F5); `agg_build_meta`. Zero network primitives.
2. **(R2/R5)** Add `LOGICAL_PROJECTIONS`/versions + `logical_digest(conn, projection=...)`; inst allowlist minus `ingested_at`; keep the congress alias/default and `# nosec B608`; update docstrings.
3. **(R4/R13)** Generalize `manifest.py`: `INST_*`, `_MODULE_POLICY`, `_DB_ARTIFACTS`, `module_db_artifact`, generic-first `validate_manifest(..., required_modules=frozenset({MODULE}))`, per-module watermark/artifact/DB-logical-digest rules, unknown-module rejection.
4. **(R3/R7)** In `run_build`: detect inst data; build `inst_agg.db` to staging; `compute_coverage`; on pass inject the inst module (watermarks, artifact, logical digest), on fail record `inst_withheld` with typed reason; journal stays congress-scoped.
5. **(R3/R4/R11/R12)** In `build.py`: `_complete_build` verify-then-upload `inst_agg.db` from staging before `publish_release` (journal-first order preserved), plus the published-immutable verify; generalize `run_verify` and `_publish_rollback` to all modules; add the fresh-runner refuse-loudly path for the missing inst asset.
6. **(R13/R6)** Make `snapshot.db_path()` module-aware via `module_db_artifact`.
7. **(R8)** Wire `populus inst-agg`; surface the withheld-notice in `build`/`publish`.
8. **(R12)** Update `docs/runbooks/disaster-recovery.md` with the multi-module recovery boundary + drafts-only cleanup reference.
9. **(R1/R5/R10a)** `tests/test_inst_agg.py`: aggregate values; CUSIP-change + reporting-gap continuity (using `securities-continuity.yaml` / seeded two-CUSIP-one-`security_id`); multi-security issuer aggregation; SH↔PRN + put_call grain; NULL/zero concentration; inst two-build reproducibility; real Berkshire 2025-Q4→2026-Q1 QoQ (100% row match).
10. **(R4/R6/R7/R10b/R11/R12/R13)** Extend `tests/test_publish.py`: manifest generic/inst-only/unknown/defect; fail-closed + certifiable-below-threshold + cover-failed + notice-only gate; both-module publish + verify-both; snapshot serve via `db_path()`; all-modules rollback refusal (inst asset missing/corrupt); fresh-runner inst crash-boundary + drafts-only recovery; second-build pointer bump + idempotent re-poll.
11. **(R2/R5)** Extend `tests/test_digests.py`: inst projection framing/exclusions/nullness + reproducibility.
12. **(R7)** Extend `tests/test_inst_ingest.py`: notice-only guard through the gate/build path.
13. **(R9)** Run `make check` (frozen install + `uv run pytest -q` + `uv run python scripts/dep_guard.py`) and `tests/test_dep_guard.py`; confirm 1247 prior + new tests green and `inst_agg.py` clean.
14. **(R10 — R10a/R10b)** Execute both real/deterministic acceptance flows against `../populus-data` (LocalDirBackend); capture module sets, verify recomputation, pointer bump, idempotent re-poll, Berkshire QoQ — in the Dev Notes.

## Testing Strategy

- **Aggregate identity (R1/F2-F5), behavioral (fail-if-removed):** CUSIP-change (two CUSIPs → one `security_id`) classified add/trim not exit+new; reporting-gap reconciliation flagged; multi-security issuer summed into one ranking; PUT vs long kept distinct; SH↔PRN transition → `delta_shares` NULL + `shares_unit_mismatch`; NULL-value holdings counted in `position_count` but not `total_value_usd`; zero-total → `concentration_unavailable` NULL (no div-by-zero).
- **Manifest (R4/F1):** `validate_manifest(base)` green; unknown module rejected; inst-only accepted with `required_modules=frozenset()`; inst missing-artifact / wrong-watermark / missing-logical-digest rejected; `test_manifest_requires_congress_module` + `…full_mandatory_artifact_set` unchanged-green.
- **Gate (R7):** FTD-only real → `below_threshold` withhold; certifiable-but-94% crafted → withhold; cover-failed → `cover_failed` withhold; notice-only → `not_measurable`, `cover_failed_count==0`; fully-covered → publish; threshold asserted `0.95`; decision via `meets_threshold`.
- **Reproducibility (R5):** two inst builds → identical inst `logical_digest` (`test_inst_agg.py` + `test_digests.py`), different `run_id`/`host`/clock.
- **Snapshot (R6/R13):** publish fully-covered corpus; `SnapshotClient(module="inst").db_path()` opens `inst_agg.db`; `SnapshotClient(module="congress").db_path()` still opens `congress.db` (no regression).
- **Verify/rollback/recovery (R4/R10/R11/R12):** `run_verify` recomputes both modules; rollback refused when inst asset missing/corrupt (mirroring `test_publish.py:899/920`); fresh-runner: inst-bearing build completes at journal-onward boundaries, refuses loudly at the post-journal/pre-inst window with release-still-draft + pointer-unmoved, and the drafts-only cleanup + rebuild completes; second build bumps `pointer_version`; unchanged re-poll idempotent.
- **No-regression / gate (R9):** `make check`; `tests/test_dep_guard.py` (incl. `inst_agg.py` network-primitive guard).
- **Fixtures:** real Berkshire + crafted `0009000007/0008/0010` + `securities-continuity.yaml`; covered/under-covered/multi-security/SH-PRN corpora seeded programmatically via `make_security_identifier` (no large new on-disk trees).

## Verification Matrix

| Req | Verification |
|---|---|
| **R1** | `tests/test_inst_agg.py` asserts all four families incl. F2 CUSIP-change/gap, F3 issuer aggregation, F4 SH/PRN grain, F5 NULL/zero — each fails if the contract is removed. |
| **R2** | Manifest inst-module validation + `tests/test_digests.py` inst projection framing/exclusions/nullness. |
| **R3** | Congress-only build unchanged when no inst data; two-module build materializes + uploads `inst_agg.db` with journal-first/pointer-last order; journal remains congress-scoped (asserted). |
| **R4** | Generic/inst-only/unknown/defect manifest tests; `test_manifest_requires_congress_module`+`…full_mandatory_artifact_set` green; `run_verify` recomputes both modules' hashes+digests. |
| **R5** | Identical inst `logical_digest` across two independent builds. |
| **R6** | `SnapshotClient(module="inst").db_path()` opens the aggregate through the public accessor. |
| **R7** | Fail-closed (below-threshold), certifiable-below-threshold, cover-failed, and notice-only (`cover_failed_count==0`) gate tests; threshold `0.95`; decision via `meets_threshold`. |
| **R8** | `populus inst-agg` builds a valid `inst_agg.db`; `populus build` runs the gate atomically; withheld-notice surfaced. |
| **R9** | `make check` green (frozen install + `uv run pytest -q` + `uv run python scripts/dep_guard.py`); 1247 prior + new tests; `inst_agg.py` clean. |
| **R10** | **R10a** FTD-only real: manifest has no inst module, `below_threshold` notice, congress verify green, Berkshire QoQ validated pre-publication, pointer bump, idempotent re-poll. **R10b** covered corpus: both modules publish and `verify` recomputes both. |
| **R11** | Rollback refused when a target module's `inst_agg.db` is missing/corrupt (new tests mirroring `:899/920`). |
| **R12** | Fresh-runner: completion at inst-onward boundaries; loud refusal at the post-journal/pre-inst window (draft intact, pointer unmoved); drafts-only cleanup + rebuild completes. |
| **R13** | `db_path()` module-aware for both `inst` and `congress` (regression-checked). |

## Rollout / Rollback

- **Rollout:** additive, behind the "inst data present" guard — a no-inst build is byte-identical to M1. Land on a feature branch; gate merge on `make check` + both acceptance flows (R10a/R10b), matching the M2-1/M2-2 pragmatic bar. On the current FTD-only corpus the gate withholds `inst` — the correct owner-accepted outcome, not a rollback trigger.
- **Rollback:** revert the feature commit; because `inst_agg.db` is a separate derived asset and the journal/pointer/publish ordering is unchanged, reverting cannot corrupt existing congress builds; aggregates regenerate from ingested tables. A bad published build is superseded by the existing signed-rollback pointer machinery (`_publish_rollback`, now all-modules).

## Simplicity Audit

Minimum coherent design: **2 new files** (`inst_agg.py`, `inst_agg.sql`), **5 edited source files** (`digests.py`, `manifest.py`, `build.py`, `snapshot.py`, `cli.py`), **1 doc**, **4 test files**. New public surface: `build_inst_agg`, `logical_digest`'s `projection` param, `module_db_artifact`, `validate_manifest`'s `required_modules` param, `run_verify`/`_publish_rollback` all-modules loops, `BuildReport.inst_withheld`, module-aware `db_path`, `populus inst-agg`. **Rejected abstractions:** module registry/plugin system (a policy dict suffices); multi-DB journal envelope (congress-scoped kept); re-derived coverage (reuse `compute_coverage`); `build_manifest` refactor (post-injection); float concentration; inst-before-journal reordering (existing drafts-only cleanup reused); large new on-disk fixtures (programmatic seeding). Every new file/function is enumerated in Planned Files/Tasks.

## Tech Debt Introduced

- **TD-M2-3-1 (bounded, executable — supersedes the earlier vague note):** the recovery journal stays congress-scoped; `inst_agg.db` is recovered as a present draft asset (same-runner: re-uploaded from staging → auto-completes) or regenerated. **Precise boundary:** a fresh-runner crash after the journal upload but before the inst-asset upload leaves an inst-bearing draft whose aggregate bytes are unrecoverable from the journal → recovery **refuses loudly** (release still a draft, pointer unmoved) → the operator runs the **drafts-only cleanup** (`rollback.md` Appendix A) and rebuilds under a new `build_id` (regenerating `inst_agg.db`). *Impact:* one rare fresh-runner window needs a documented one-command operator step; nothing consumer-visible is ever stranded. *Removal condition:* widen the journal to a multi-DB envelope (accepting DR-5 git-size) or upload the inst asset ahead of the journal for full automation. Documented in `disaster-recovery.md`; tested on a fresh runner (R12).
- **TD-M2-3-2 (bounded):** per-issuer top-holders capped at N=25 (recorded in `agg_build_meta`) — the long tail is not in the aggregate slice (consistent with §5.6). *Removal:* raise/parameterize N.
- Otherwise **None** — no hidden debt; monitor/MCP inst-awareness and dashboard slices are declared **non-goals**.

## Memory Touch-Points

- **`populus-project.md`** (project) — run decomposition, pragmatic acceptance bar, 1247-test baseline, data repo `../populus-data`, gitignored `data-cache`, committed goldens. *Effect:* Rollout, no-regression framing, acceptance-transcript expectation.
- **`john-baek-profile.md`** (user) — quant-grade rigor, primary-source verification, honest data-limitation-as-feature. *Effect:* fail-closed treated as the correct honest outcome; typed withheld-reasons, integer-deterministic aggregates, path:line grounding, and executable recovery (bus-factor).
- Reviewer-cited feedback classes applied: anchor/live-tree verification and by-name (not by-index) column handling drove the consumer sweep (rollback/recovery/snapshot); executable-wiring + explicit-contract + decision-lock drove the F1-F5/F9/F10 contracts; tech-debt-declaration + self-heal-verification drove TD-M2-3-1; digest-nullness-binding drove the NULL concentration handling.
- **No memory writes** at plan time; a post-merge project-memory update is a docs-commit-phase action.

## Failure-Mode Sweep

- **F0 full-set sweep [[full-tree-gate-scope]] [[shared-validator-rejection-required]] [[full-write-scope-disclosure]]:** applied — swept **every** manifest consumer/writer (`build.py` run_build/complete_build/verify/**rollback**/reconcile; `snapshot.py` db_path/validate; `monitor.py`) and generalized or explicitly scoped each; `validate_manifest` **rejects** unknown modules + inst defects, tested per case.
- **F0 verify-don't-assume [[verify-claims-before-stating-fact]] [[feedback-verify-function-not-liveness]]:** applied — R10a/R10b exercise the gate/aggregates/verify/rollback/recovery end-to-end.
- **F1 enumerate consumers [[plan-api-route-enumeration]]:** all manifest/DB consumers enumerated (verify, rollback, recovery, snapshot, monitor, MCP); monitor/MCP scoped as non-goals with the congress-guaranteed rationale.
- **F1 exact gate set [[gate-list-completeness]]:** canonical gate is `make check` (frozen install + `uv run pytest -q` + `uv run python scripts/dep_guard.py`), stated in R9/Constraints.
- **F1 units + NULL/awaiting state [[rs_rank_pct_fraction_contract]] [[awaiting_baseline_rows_null_guard]] [[digest_nullness_binding]]:** every aggregate field's units + NULL/zero/unit-mismatch behavior defined; unavailable concentration stored NULL (not fake-0), preserved in the digest.
- **F1 simplicity audit complete [[simplicity-audit-must-be-complete]]:** every new file/function enumerated.
- **F1 rebaseline [[rebaseline-plan-when-code-lands]]:** grounded in current `main` (`91e4697`), all citations re-verified.
- **F2 dynamic-SQL nosec [[bandit_b608_sql_in_clause_nosec]]:** reused `logical_digest` framing keeps `# nosec B608`; aggregate SQL uses parameterized values + static identifiers.
- **F2 behavioral validity [[behavioral-test-validity]]:** every new boundary (gate, inst module, digest, rollback, recovery, snapshot accessor) has a fail-if-removed test.
- **F2 stale comments [[stale-comments-after-splits]]:** `digests.py`/`manifest.py`/`snapshot.py`/`disaster-recovery.md` wording updated away from congress-only.
- **F3 self-heal verification [[feedback-live-system-self-heal-verification]]:** the fresh-runner recovery boundary is specified and tested, not assumed.
- **Non-applicable:** F1 prod-write/auth (local staging), F2 connection-pooler (SQLite), F2 dead-CSS (no UI), F3 RLS/ACL-cloud (no cloud), F5 transport internals (orchestrator-owned).

## Definition of Done

- **R1** — `inst_agg.py`/`inst_agg.sql` build a deterministic `inst_agg.db` with filer registry, `security_id`-first QoQ (F2), issuer-aggregated top-holders (F3), unit-guarded Δshares (F4), and NULL/zero-safe concentration (F5); `tests/test_inst_agg.py` green.
- **R2** — manifest carries a well-formed `inst` module (PEP 440 `client_compat`, inst watermarks, `inst_agg.db` with `logical_digest`+`license_ids` incl. `sec-edgar`) under inst projection v1; digest/manifest tests green.
- **R3** — both modules assembled under `builds/<build_id>/` with journal congress-scoped and journal-first/pointer-last order preserved; M1-only builds unchanged.
- **R4** — generic validation admits inst-only + rejects unknown/defective modules while `test_manifest_requires_congress_module`/`…full_mandatory_artifact_set` stay green; `run_verify` recomputes both modules' hashes+logical digests.
- **R5** — two independent inst builds yield an identical inst `logical_digest`.
- **R6** — `SnapshotClient(module="inst").db_path()` reads an aggregate via the public accessor.
- **R7** — gate consumes `meets_threshold` at `0.95`, keeps `certifiable` distinct, keys cover-failure on the flag, includes the notice-only test, and refuses `inst` on the FTD-only corpus while `congress` publishes; threshold not lowered, FTD not widened.
- **R8** — `populus inst-agg` builds `inst_agg.db`; `populus build`/`publish` run the gate atomically and surface the withheld-notice.
- **R9** — `make check` green (frozen install + full suite + G1 dep-guard); 1247 prior tests unchanged; `inst_agg.py` passes the network-primitive guard.
- **R10** — **R10a** FTD-only real: manifest omits inst (`below_threshold`), congress publishes/verifies, Berkshire 2025-Q4→2026-Q1 QoQ validated pre-publication, second build bumps `pointer_version`, unchanged re-poll idempotent; **R10b** covered corpus: both modules publish and `verify` recomputes both — captured in Dev Notes.
- **R11** — rollback preflight verifies every module's artifacts and refuses a target with a missing/corrupt `inst_agg.db`.
- **R12** — the multi-module recovery boundary is documented and tested on a fresh runner: completion at inst-onward boundaries, loud refusal + drafts-only-cleanup + rebuild at the post-journal/pre-inst window.
- **R13** — `db_path()` is module-aware for both `inst` and `congress` (regression-checked).
