**Plan tracking (truthful):** this plan is delivered inline as the source of record for review. The planning phase has no write permission, so no plan file exists in the repository. The implementer's **first DEV action (T0)** is to write this plan to `docs/build/RUN-M2-1-plan.md` and commit it on the feature branch before T1.

**Rebaseline check (this session):** `git log --oneline -1` → `0dfd18d`, `git status --porcelain` → empty. The base ref has not advanced since the previous revision; every `path:line` anchor cited below was re-grepped on this base.

# plan-v1 — RUN M2-1: identity registries + SEC federated client + conditions register

## Goal and Success Criteria

Build the **shared M2 substrate** — §5.4 temporal identity registries, the §11.4 conservative SEC federated client, and the §15 conditions-register entries that must exist **before** any SEC ingest (G11) — on top of the merged M1 substrate, importing rather than reimplementing it. No 13F data is touched in this run; M2-2/M2-3/M2-4 and M3 consume what this run lands.

Success = all of the following observable facts:

1. `populus db init PATH` creates the §5.4 registry tables plus their no-overlap indexes, and every M1 table/DDL/view is byte-for-byte unchanged.
2. As-of resolution (`resolve_cusip`, `resolve_entity_by_cik`, `resolve_ticker_as_of`) is interval-bounded and **fail-closed**: any lookup without a unique, undisputed, applicable mapping returns `None`, and no API maps an identifier to an entity without an as-of date (G14 enforced structurally).
3. **Durable identity is declared, not derived.** `src/populus/securities.yaml` is the stable class-ID authority: each class owns identifier values over explicit **date-bounded ownership windows**, so a class can hand one of its identifiers to another class at a boundary — a split — while **keeping its own `security_id`, its other identifiers, and its metadata**. Provisional ids for identifiers named by no class are deterministic across clean rebuilds, explicitly labelled `provisional`, and promoted only through a transactional migration.
4. **Registry revisions converge, including boundary-crossing intervals.** Applying a revised `securities.yaml` to an already-populated database and re-running the same corpus produces `securities` and `security_identifiers` rows identical to a clean build with that registry and corpus — any persisted validity interval that crosses a declared ownership boundary is **cut** at the boundary and each piece assigned to its owner. The only permitted difference is the append-only supersession ledger a clean build legitimately lacks.
5. **A bootstrap run is all-or-nothing.** Reconciliation and both seeding passes execute inside **one** data transaction; a failure anywhere rolls back every registry change, while the `ingest_runs` audit row — opened in autocommit before the transaction — persists with `status='failed'`.
6. `populus identity bootstrap --from-cache data-cache/inst/registry --db /tmp/i.db` seeds `entities`/`entity_names`/`entity_tickers` from the real cached `company_tickers.json` and prints a three-family reconciliation summary in which every counter has a stated unit and every stated total holds.
7. `SecClient` enforces a **client-wide** ≤2 req/s floor, true single-flight coalescing with shared results and shared exceptions, a breaker latch rechecked **inside** the request gate, an ETag-aware per-endpoint-class TTL cache, and 429/5xx backoff — all with an injected transport and clock — and emits the **exact SEC-verified** User-Agent bytes.
8. `sec-edgar` and `sec-ftd` exist in `licenses.json`, validate, and are mirrored into the regenerated `DATA-LICENSE.md` / `NOTICE` with zero drift.
9. `uv run pytest -q` is green over the whole repository — all 936 pre-existing tests still pass — and `uv run python scripts/dep_guard.py` exits 0. **No test opens a socket**; the autouse `_no_network` guard at `tests/conftest.py:14` stays in force.
10. DC1–DC5 each have dedicated failing-if-removed tests, and both provider-facing acceptance gates run as copy-pasteable commands that exercise the shipped code and fail loudly.

## Requirements

- **R1 — Registry schema.** `entities(entity_id PK, cik UNIQUE NOT NULL)`, `entity_names(entity_id, name, valid_from, valid_to, source)`, `securities(security_id PK, class)`, `security_identifiers(security_id, id_type CHECK IN ('cusip'), value, valid_from, valid_to, provenance, confidence, review_state)`, `entity_tickers(entity_id, ticker, valid_from, valid_to, provenance, confidence, review_state)`, plus `security_supersessions` for one-to-many superseded-id resolution; dated-validity no-overlap unique keys analogous to `member_aliases.alias_no_overlap` (`src/populus/schema.sql:21`); `raw` JSON where a source row exists; created by `populus db init`; all M1 tables unchanged.
- **R2 — As-of resolution, fail-closed (G14).** `resolve_cusip(conn, cusip, as_of_date) -> security_id|None`, `resolve_entity_by_cik(conn, cik, as_of_date) -> EntityRef|None`, `resolve_ticker_as_of(conn, ticker, as_of_date) -> entity_id|None`. A mapping row applies only when `valid_from <= as_of_date < valid_to` (`valid_to IS NULL` = open), only when it is the unique applicable row, and only when its `review_state` is not `disputed`. `EntityRef.name` is non-null; the entity resolver returns `None` whenever no unique applicable name interval exists. Chaining CUSIP→current-ticker→CIK is impossible by construction.
- **R3 — Bootstrap: tickers.** Ingest `company_tickers.json` from an injectable path → upsert `entities` by CIK, open current-interval `entity_names` and `entity_tickers` rows (`valid_from` = injected snapshot date, `valid_to` NULL, provenance `company_tickers`, confidence `high`, review_state `auto`). No network anywhere in the code path.
- **R4 — Bootstrap: CUSIPs (OQ-8), deterministic.** Parse SEC fails-to-deliver rows (settlement date, CUSIP, symbol, issuer name) from an injectable file/zip input → seed `securities` + `security_identifiers` and link to `entities` via as-of symbol→ticker where resolvable, provenance `sec-ftd`, review_state recorded. Output is a pure function of `(observation set, packaged identity registry)`: identical inputs give identical rows and identical `security_id` values regardless of file partitioning, order, or incremental arrival.
- **R5 — Federated SEC client (§11.4 + M2-CONTRACT §1).** `SecClient` with injectable transport **and** clock. Enforced in code, never config (G6): a **client-wide** ≤2 req/s min-interval floor across different URLs; single-flight coalescing where followers receive the leader's result **or** its exception irrespective of cache TTL; an ETag-aware response cache with per-endpoint-class TTL; exponential backoff on 429/5xx; and a latching circuit breaker on sustained 403 checked both before flight registration **and again inside the request gate immediately before transport**. No retry storm, no IP/UA rotation. UA policy: the SEC-accepted `"<app> <contact>"` form from `$POPULUS_CONTACT`, startup warning when unset, `Accept-Encoding: gzip, deflate` on every request, and the parenthesized form **never** sent to `*.sec.gov`.
- **R6 — Conditions register (§15, G11).** `sec-edgar` and `sec-ftd` entries — legal instrument, permitted uses, restrictions, required notices, attribution, determination basis + date + review-by — added **before** any ingest path or SEC-derived fixture exists, with `DATA-LICENSE.md` and `NOTICE` regenerated drift-free; a test asserts both entries exist and are well-formed, and `scripts/dep_guard.py` stays clean (G1).
- **R7 — CLI, single data transaction, and audit lifecycle.** `populus identity bootstrap --from-cache DIR [--ftd PATH ...] [--securities PATH] --db PATH [--as-of DATE]` runs registry reconciliation and both seeding passes **inside one `BEGIN IMMEDIATE`/`COMMIT`**; any failure rolls back *all* of them. The `ingest_runs` audit row is opened in autocommit **before** that transaction and completed with `status='ok'` or `status='failed'` on every attempted run.
- **R8 — DC1: one title per CIK per snapshot.** Name reconciliation yields exactly one normalized entity name per CIK per snapshot; conflicting titles are rejected and counted, never both kept valid. `resolve_entity_by_cik` returns that single name in `EntityRef(entity_id, cik, name)` or `None`.
- **R9 — DC2: no fabricated FTD continuity (G14).** FTD rows are point-in-time settlement-date observations. `security_identifiers` **validity** intervals are built only from calendar-adjacent observations **belonging to the same owner**: adjacency merging never spans a declared ownership boundary, and no gap is ever bridged. Gap-refusal tests, not day-merge tests.
- **R10 — DC3: durable identity via a declared class-ID authority.** A **declared** `security_id` is assigned once in `src/populus/securities.yaml` and **never changes** when its identifier bindings are added, changed, bounded, or handed off at a split boundary — CUSIP is retained only as a dated attribute, and a split of one binding preserves the class's remaining identifiers and metadata. Identifiers named by no class receive an explicitly-labelled **provisional** id, deterministic across clean rebuilds, carrying no durability claim. Observations never change any id. Identifier reuse cannot conflate distinct securities. Partition, order, backfill, CUSIP-change, declared-class-split, and CUSIP-reuse cases are tested **by comparing actual `security_id` values**.
- **R11 — DC4: as-of symbol→entity per observation.** Every `(symbol, settlement_date)` is resolved independently; `securities.entity_id` is stamped only when all resolved observations agree, otherwise an explicit unresolved/conflict state is retained.
- **R12 — DC5: honest reconciliation accounting (G3).** Three structurally separate counter families, each field carrying a stated **unit**, an **observation phase**, and a **first-run → replay transition rule**: `Disposition` (parse phase; mutually exclusive source-row buckets summing to rows read; identical on replay), `Mutations` (write phase; rows/objects actually inserted, updated, cut, or deleted; **zero** on replay), and `RegistryState` (**post-write** state metrics; identical on replay by construction). Every stated total is expressed in **one** unit on both sides and is asserted against the declared-split fixture, where one anchor maps to two securities.
- **R13 — Gates.** `uv run pytest -q` green over the whole repo (936 pre-existing tests still passing), `uv run python scripts/dep_guard.py` exit 0, `make check` green, and no live network in any test.
- **R14 — Provider-format acceptance (FTD), executable.** A committed, provenance-recorded excerpt of a **real** SEC `cnsfails` archive is parsed under gate with asserted row, value, and disposition counts; a **mandatory** acceptance run against the named full archive is executed via the exact commands in Rollout, with parsed-row and disposition counts recorded.
- **R15 — Provider-format acceptance (SEC User-Agent), executable.** The exact emitted UA byte string is pinned in hermetic tests, and a **mandatory** smoke check invokes the **shipped** `SecClient` + `HttpxSecTransport`, prints the exact bytes sent, and exits non-zero unless SEC returns 200.
- **R16 — The identity authority (`securities.yaml`).** A packaged, version-controlled file with two sections: `classes` (a stable `security_id`, its metadata, and its identifier values each with an optional half-open **ownership window** `from`/`to`) and `continuities` (a reviewed clearance of a specific flagged reuse gap). A split is expressed as two classes owning one identifier value over complementary windows — so an existing class keeps its id, its other identifiers, and its metadata. Validated on load with actionable errors, injectable via `--securities PATH`, applied before every bootstrap pass.
- **R17 — Registry-revision migration with interval cutting.** `reconcile_identity_registry(conn, registry)` applies the current authority to an existing database: renames provisional → declared, merges anchors into a declared class, **cuts every persisted validity interval that crosses a declared ownership boundary** and assigns each piece to its owner, repoints **every** table with a foreign key to `securities` (covered by an enforced constant), and records a one-to-many `security_supersessions` ledger with chain collapsing. It requires an already-open transaction and never opens or commits one itself. Convergence is tested for empty→class, class-chain extension, singleton→split, and **declared-class→split with a boundary-crossing interval**, each applied to a **populated** database and compared against a clean build.
- **R18 — Fail-closed disputed reuse.** An identifier whose observed dates contain a gap ≥ the reuse-review horizon with no declared ownership boundary inside the gap and no declared continuity is marked `disputed`, and **every mapping for that identifier resolves to `None`** until a reviewed declaration exists. Disputed identifiers are never dropped: they are counted and listed for review, and downstream surfaces them by issuer name with a flag (G3).

## Scope

Three cohesive modules, all shared substrate, delivered as one slice because they are mutually dependent through the register gate (G11 requires the register entries before any code or fixture derived from those sources exists):

1. **Identity registries** — `src/populus/registry.sql`, `src/populus/securities.yaml`, `src/populus/identity/` (`__init__.py`, `registry.py`, `bootstrap.py`), `db.init_db` wiring.
2. **SEC federated client** — `src/populus/net/` (`__init__.py`, `sec_client.py`), built and unit-tested but **not wired to any live library path this run** (M2-2 is its first caller).
3. **Conditions register + CLI** — two `licenses.json` entries with regenerated `DATA-LICENSE.md`/`NOTICE`, and `populus identity bootstrap` in `cli.py`.

## Non-goals

- Any 13F data: `inst_filers`/`inst_filings`/`inst_holdings`, cover/info-table parsing, `unit_basis`, amendments, affiliated-filer de-dup (RUN M2-2).
- Aggregates, `inst_agg.db`, `build.py`/`manifest.py` generalization, admitting registry tables into the §5.5 logical-digest projection at `src/populus/publish/digests.py:27` (RUN M2-3).
- `inst_*` MCP tools, `populus_health` inst module, envelope/`data_note` (RUN M2-4).
- Wiring the `POPULUS_CONTACT` startup warning into `populus-mcp` server startup (M2-4).
- A persistent on-disk SEC response cache; a review UI or automated corporate-action discovery for populating `securities.yaml`.
- Populating `securities.yaml` with real declarations: it ships **empty and documented**; real entries arrive when M2-2 surfaces cases.

## Constraints

- **`schema.sql` is byte-locked.** `tests/test_schema.py:112` asserts `src/populus/schema.sql` equals the §9.4 DDL block in `ARCHITECTURE.md` exactly. Registry DDL therefore follows the `views.sql` precedent (`src/populus/db.py:43-47`, `src/populus/views.sql:1-4`), not the brief's literal "append to schema.sql".
- **Network primitives are statically banned.** `tests/test_dep_guard.py:219` scans every `src/populus/**/*.py` and permits `httpx` only in `HTTPX_ALLOWED` (`tests/test_dep_guard.py:208`). `net/sec_client.py` must be added there, and `urllib.parse` **may not be used at all** — URL host validation is plain string work.
- **Library code never reads the wall clock** (`src/populus/cli.py:10-13`). Snapshot dates, run ids, host, sleep, and monotonic are injected. Identity requires **no** injected randomness.
- **SQLite transactions do not nest.** `connect()` is autocommit (`isolation_level=None`, `src/populus/db.py:24`), so exactly one function may issue `BEGIN IMMEDIATE`. The registry write functions are therefore transaction-agnostic and assert `conn.in_transaction`; only `run_identity_bootstrap` brackets. This is also what lets the audit row survive a rolled-back data transaction.
- **Politeness floors live in code, never config** (G6), mirroring `src/populus/ingest/senate.py:59-62`.
- **G11:** register entries are committed in the same change as, and ordered before, the code and fixtures derived from those sources.
- `uv`-managed Python 3.12; existing dependency set only — **no new third-party dependency** (`pyyaml` already ships and is used by `members.py`; `zipfile`/`threading`/`hashlib` are stdlib).
- `data-cache/` is gitignored: no test may depend on it. Real-corpus runs are named acceptance gates with exact commands.

## Current State

- **M1 is complete and merged**: 936 tests green, `main` clean at `0dfd18d` (re-verified this session). Substrate: `src/populus/db.py`, `src/populus/canonical.py` (RFC 8785 `canonical_json`, `nfc`), `src/populus/licenses.py`, `src/populus/cli.py`, `src/populus/schema.sql`.
- **No identity substrate exists yet.** `src/populus/` has no `identity/` or `net/` package; `schema.sql` contains only the five M1 tables.
- **The temporal-mapping idiom exists**: `member_aliases` + `alias_no_overlap` (`src/populus/schema.sql:10-25`), half-open resolution (`src/populus/members.py:408-409`), and the overlap invariant a UNIQUE index cannot express (`members.alias_overlap_errors`, `src/populus/members.py:258`).
- **The reviewed, version-controlled registry-file idiom exists**: `src/populus/aliases.yaml` (packaged) declares that "every fuzzy-match decision is a reviewed commit"; `members.default_aliases_text`/`load_aliases` (`src/populus/members.py:193,202`) load it with a **required reviewed `note`**, full-replace inside `BEGIN IMMEDIATE`; the CLI exposes `--aliases PATH` (`src/populus/cli.py:116-121`); `tests/test_schema.py:248` asserts an invariant over the packaged file. This supplies the file/loader/override/validation idiom; id stability across revisions comes from the declared `security_id` plus the R17 migration, for which `aliases.yaml` has no analogue.
- **The audit lifecycle exists and already survives rollback**: `run_members_ingest` inserts the `ingest_runs` row in autocommit *before* the data work (`src/populus/members.py:728-732`) and on any exception updates it to `status='failed'` before re-raising (`src/populus/members.py:739-745`); the write pass owns its own `BEGIN IMMEDIATE`/`ROLLBACK` (`src/populus/members.py:681-693`). Note the M1 shape runs *several* independently-committed passes under one audit row — RUN M2-1 tightens this to one bracket around all passes (R7).
- **A sequential polite client exists but does not cover concurrency**: `_PoliteSession` (`src/populus/ingest/senate.py:189`) has in-code floors and injected clock hooks but assumes one thread, has no coalescing, no response cache, and a non-latching breaker.
- **The register carries a generic SEC entry**, `us-govworks-sec` (`src/populus/licenses.json:29`), pinned by `SECTION_15_2_IDS` (`tests/test_licenses.py:21`) and the exact-date assertion (`tests/test_licenses.py:79`).
- **The real ticker corpus is cached**: `data-cache/inst/registry/company_tickers.json` (797 KB). **No FTD archive is cached** — R14 names the archive and the commands to fetch it.
- `licenses.json` is a published artifact (`src/populus/publish/manifest.py:33`) but no test pins its bytes; the §5.5 logical digest is a four-table allowlist (`src/populus/publish/digests.py:27`), so new tables and entries do not disturb the publish gates.
- `ARCHITECTURE.md:639` still documents the parenthesized UA; M2-CONTRACT §1 (`docs/build/M2-CONTRACT.md:36`) records the verified 2026-07-24 correction naming `Populus johnbaekk@gmail.com` as the form that returned 200, and the FTD archive path pattern (`docs/build/M2-CONTRACT.md:24`).
- `docs/build/` holds the run briefs and the M2 contract; it is where T0 commits this plan.

## Detected Stack

- Python 3.12 (`.python-version`), `uv`-managed with a frozen lockfile, hatchling build backend, package root `src/populus` (`pyproject.toml`).
- Runtime deps: `httpx`, `lxml`, `packaging`, `pdfplumber`, `pypdf`, `pyyaml`, `click`, `rfc8785`, `mcp>=1.28.1`. Dev: `pytest`, `jsonschema`.
- Storage: SQLite (stdlib `sqlite3`, JSON1 required). CLI: `click`. Tests: `pytest` with autouse socket blocking.
- Gates: `make test` → `uv sync --frozen && uv run pytest -q`; `make security` → `uv run python scripts/dep_guard.py`; `make check` runs both (`Makefile`).

## Reuse Map

| Existing symbol / path | Decision | Why |
|---|---|---|
| `populus.db.connect` / `init_db` (`src/populus/db.py:17,38`) | **Extend** — `init_db` calls `ensure_registry(conn)` after `ensure_views` | One chokepoint owns FK pragma + schema creation |
| `populus.amendments.ensure_views` (`src/populus/amendments.py:23`) | **Copy the idiom** into `ensure_registry` | Precedent for packaged, idempotent, out-of-`schema.sql` DDL |
| `src/populus/views.sql` | **Copy the idiom** into `src/populus/registry.sql` | Keeps `schema.sql` byte-identical to §9.4 |
| `src/populus/aliases.yaml` + `default_aliases_text`/`load_aliases` (`src/populus/members.py:193,202`) | **Reuse the file/loader/override/validation idiom**; **do not** rely on it for id stability | Supplies "reviewed commit is the only door", a required `note`, a packaged-file invariant test, and a `--securities` override matching `--aliases` (`src/populus/cli.py:116-121`) |
| `member_aliases` + `alias_no_overlap` (`src/populus/schema.sql:10-25`) | **Mirror** for the registry mapping tables | Same dated-validity model |
| `populus.members.alias_overlap_errors` (`src/populus/members.py:258`) | **Mirror** as `registry_overlap_errors` | The invariant a UNIQUE index cannot express |
| `populus.members` half-open resolution (`src/populus/members.py:408-409`) | **Mirror** in every `resolve_*` | Identical `[valid_from, valid_to)` semantics |
| `run_members_ingest` audit lifecycle (`src/populus/members.py:728-750`) | **Mirror the audit half; tighten the data half** | The autocommit pre-insert + `status='failed'` path is reused verbatim; unlike M1's several independently-committed passes, all M2-1 registry work goes in **one** bracket (R7/F4) |
| `apply_member_join` transaction bracket (`src/populus/members.py:681-693`) | **Mirror the bracket shape** at the `run_identity_bootstrap` level only | `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`-and-re-raise; the inner functions stay transaction-agnostic because SQLite does not nest transactions |
| `populus.canonical.canonical_json` (`src/populus/canonical.py:35`) | **Import and reuse** to serialize a single anchor before hashing a provisional id | Key-order-invariant, length-delimited byte envelope |
| `populus.canonical.nfc` (`src/populus/canonical.py:30`) | **Import and reuse** for extracted text | NFC once, at extraction |
| `populus.ingest.TransportResponse` (`src/populus/ingest/__init__.py:24`) | **Import and reuse** in `net/` | One transport response shape |
| `populus.ingest.USER_AGENT` (`src/populus/ingest/__init__.py:18`) | **Deliberately NOT reused** | The parenthesized form 403s at SEC's WAF; a test asserts it is never sent |
| `populus.ingest.senate._PoliteSession` (`src/populus/ingest/senate.py:189`) | **Take the floors-in-code idiom only; write a new client** | Single-threaded, no coalescing, no ETag cache, non-latching breaker |
| `HttpxSenateTransport` per-call `httpx.get` (`src/populus/ingest/senate.py:125-130`) | **Reuse the shape** for `HttpxSecTransport` | No persistent `httpx.Client` to leak (`feedback_httpx_client_cleanup.md`) |
| `populus.licenses.*` (`src/populus/licenses.py`) | **Reuse unchanged**; only `licenses.json` data changes | Validation/render/drift-guard already covers new entries |
| `scripts/render_licenses.py` | **Run, do not modify** | Drift-guarded by `tests/test_licenses.py:102` |
| `JoinReport` / `format_join_summary` (`src/populus/members.py:629,759`) | **Mirror** the report+formatter split | Established printed-summary shape |
| `tests/conftest.py` factories | **Extend** with `make_entity`, `make_entity_ticker`, `make_security_identifier` | conftest is this repo's factory home |

## Architecture

### 1. Registry DDL — `src/populus/registry.sql`, applied by `ensure_registry`

```sql
CREATE TABLE IF NOT EXISTS entities (
  entity_id TEXT PRIMARY KEY,             -- 'cik:0000320193' — CIK never changes
  cik       TEXT NOT NULL UNIQUE,
  raw       JSON CHECK (raw IS NULL OR (json_valid(raw) AND json_type(raw)='object'))
);

CREATE TABLE IF NOT EXISTS entity_names (
  entity_id  TEXT NOT NULL REFERENCES entities(entity_id),
  name       TEXT NOT NULL,               -- NFC + collapsed whitespace, case preserved
  valid_from DATE NOT NULL, valid_to DATE,
  source     TEXT NOT NULL,               -- 'company_tickers'
  license_id TEXT NOT NULL,               -- §5.1 record-level (sources mix here)
  raw        JSON CHECK (...),
  PRIMARY KEY (entity_id, valid_from)     -- DC1 no-overlap key
);

CREATE TABLE IF NOT EXISTS securities (
  security_id       TEXT PRIMARY KEY,     -- declared literal, or 'sec:prov:<32 hex>'
  id_state          TEXT NOT NULL CHECK (id_state IN ('declared','provisional')),
  class             TEXT,                 -- instrument class; NULL = source is silent
  entity_id         TEXT REFERENCES entities(entity_id),
  entity_candidates TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(entity_candidates) AND json_type(entity_candidates)='array'),
  entity_link_state TEXT NOT NULL DEFAULT 'unresolved'
        CHECK (entity_link_state IN ('unresolved','resolved','conflict')),
  review_state      TEXT NOT NULL DEFAULT 'auto'
        CHECK (review_state IN ('auto','reviewed','disputed')),
  CHECK ((entity_id IS NULL     AND entity_link_state IN ('unresolved','conflict'))
      OR (entity_id IS NOT NULL AND entity_link_state = 'resolved'))
);

CREATE TABLE IF NOT EXISTS security_supersessions ( -- one-to-many, append-only
  old_security_id TEXT NOT NULL,
  security_id     TEXT NOT NULL REFERENCES securities(security_id),
  reason          TEXT NOT NULL CHECK (reason IN ('promotion','merge','split')),
  source          TEXT NOT NULL,          -- 'securities.yaml'
  PRIMARY KEY (old_security_id, security_id)
);

CREATE TABLE IF NOT EXISTS security_identifiers (
  security_id TEXT NOT NULL REFERENCES securities(security_id),
  id_type     TEXT NOT NULL CHECK (id_type IN ('cusip')),
  value       TEXT NOT NULL,
  valid_from  DATE NOT NULL, valid_to DATE,   -- half-open VALIDITY; FTD always closed
  provenance  TEXT NOT NULL,                  -- 'sec-ftd'
  confidence  TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  review_state TEXT NOT NULL CHECK (review_state IN ('auto','reviewed','disputed')),
  license_id  TEXT NOT NULL,
  raw         JSON CHECK (...),
  PRIMARY KEY (security_id, id_type, value, valid_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS security_identifier_no_overlap
  ON security_identifiers (id_type, value, valid_from);

CREATE TABLE IF NOT EXISTS entity_tickers (
  entity_id TEXT NOT NULL REFERENCES entities(entity_id),
  ticker    TEXT NOT NULL,
  valid_from DATE NOT NULL, valid_to DATE,
  provenance TEXT NOT NULL,                   -- 'company_tickers'
  confidence TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  review_state TEXT NOT NULL CHECK (review_state IN ('auto','reviewed','disputed')),
  license_id TEXT NOT NULL,
  raw       JSON CHECK (...),
  PRIMARY KEY (entity_id, ticker, valid_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS entity_ticker_no_overlap
  ON entity_tickers (ticker, valid_from);
```

The two extra UNIQUE indexes key on the **lookup side** (`(id_type,value)`, `ticker`) — `alias_no_overlap`'s role; for `entity_names` the natural PK is already the no-overlap key. Because `security_identifier_no_overlap` is **global**, two securities can never hold the same `(id_type, value, valid_from)`, which is what makes merges and boundary cuts collision-free (§4). `registry_overlap_errors(conn)` covers the temporal-intersection invariant the indexes cannot express.

### 2. Identity authority — declared ids over dated ownership windows

Identity has two tiers with explicitly different guarantees:

| Tier | `id_state` | Assigned by | Guarantee |
|---|---|---|---|
| **Declared** | `declared` | `src/populus/securities.yaml` — a literal `security_id` written once by reviewed commit | **Durable.** Adding an identifier, bounding one, or handing one to another class at a boundary never changes it, and never disturbs the class's other identifiers or metadata. This is DC3's durable surrogate. |
| **Provisional** | `provisional` | derived: `"sec:prov:" + sha256(canonical_json(anchor)).hexdigest()[:32]`, anchor = `{"id_type","value"}` | **Deterministic across clean rebuilds, explicitly not durable.** Superseded exactly once, by a one-way promotion, with a recorded supersession. Never published as a stable identity. |

**Ownership windows are the whole model.** A class lists identifier values, each with an optional half-open ownership window `from`/`to`. For every `(id_type, value)` named anywhere in the file, the union of its windows across all classes must be **pairwise disjoint, contiguous, and cover all time** — validated on load. A "split" is simply two classes owning one value over complementary windows; a "merge"/CUSIP change is one class owning two values. There is no separate `splits` section, no closure algorithm, and no derived successor ids.

```
target_for(id_type, value, date) -> (security_id, id_state, class)
  = the class whose ownership window for (id_type, value) contains date, if the value is
    named in the file (guaranteed to exist and be unique by the covering validation);
  = (provisional_security_id(anchor), 'provisional', None) otherwise.
```

Because the covering rule makes declared values total over time, a value is either fully governed by the authority or fully provisional — a provisional id is always one id per value, never per window.

**Reuse-review horizon.** `REUSE_REVIEW_HORIZON_DAYS = 3650` (10 years), an in-code labeled constant. An identifier whose complete observed-date set contains a gap of at least the horizon, with **no** declared ownership boundary inside that gap and **no** declared continuity clearing it, is `disputed` — and per R18 **every** mapping for that identifier resolves to `None` until reviewed. Stated assumption, not a verified rule: CUSIP issue numbers are not reassigned within a short window, so a decade-scale gap is chosen to make benign fails-reporting gaps essentially never trip the flag; `continuities` is the escape hatch when it does.

**Interlock A/B.** *A: declared ids are literals from the authority file.* *B: observations never assign or change an id — they only add dated bindings and may raise a review flag.* Remove B and identity becomes history-dependent; remove A and durability across reviewed revisions collapses. `test_observations_never_change_any_security_id` and `test_declared_id_survives_binding_revision` fail if either side is removed.

**Interlock C/D.** *C: validity intervals merge only calendar-adjacent observations **of the same owner** (DC2/R9).* *D: the reuse horizon is a review/fail-closed trigger, never a validity or identity rule.* Remove D's restriction and a decade-wide window would silently bridge validity gaps (G14); remove C's owner scoping and an interval could span an ownership boundary, so a boundary-crossing run would resolve to the wrong security. `test_horizon_flag_does_not_widen_validity` and `test_union_never_spans_an_ownership_boundary` fail if either leaks.

**Interlock E/F.** *E: `Mutations` counts writes only.* *F: the replay assertion requires every `Mutations` field to be zero.* Remove E and F becomes unsatisfiable. `test_replay_zeroes_every_mutation` fails if either drifts.

### 3. `src/populus/securities.yaml` (R16)

Ships **empty and documented**, mirroring `aliases.yaml`'s header. Loaded by `load_identity_registry`, overridable with `--securities PATH`.

```yaml
# Guidance: leave an identifier's window UNBOUNDED unless you are declaring a boundary
# between two owners. Every value named here must be owned for ALL time by exactly one
# class at each instant — the loader enforces disjoint, contiguous, covering windows.
classes:
  - security_id: "sec:example-issuer-common"   # stable; assigned once, NEVER changes
    class: equity
    identifiers:
      - {id_type: cusip, value: "111111111"}                  # owned for all time
      - {id_type: cusip, value: "222222222"}                  # the corporate-action CUSIP
      - {id_type: cusip, value: "333333333", to: "2020-01-01"} # handed off at the boundary
    note: REQUIRED — the corporate action / reassignment and its primary-source citation
    review_state: reviewed
  - security_id: "sec:example-successor"
    class: equity
    identifiers:
      - {id_type: cusip, value: "333333333", from: "2020-01-01"}  # the reused identifier
    note: REQUIRED
    review_state: reviewed
continuities:
  - anchor: {id_type: cusip, value: "444444444"}
    gap_from: "2013-02-01"
    gap_to: "2024-05-01"
    note: REQUIRED — evidence the gap is a fails-reporting gap, not reuse
    review_state: reviewed
```

The example is exactly the F1 case: `sec:example-issuer-common` splits off `333333333` at a boundary while **keeping its id, its two other identifiers, its `class`, and its `review_state`.**

Validation, each with an actionable `IdentityRegistryError` and a test: non-empty `note` on every entry; `security_id` matches `^sec:[a-z0-9][a-z0-9._-]{0,62}$` and must not use the reserved `sec:prov:` prefix; `security_id` unique across `classes`; `identifiers` non-empty with a permitted `id_type`; `from < to` when both are present; **for each `(id_type, value)`: windows pairwise disjoint, contiguous, and covering all time** (first window unbounded below, last unbounded above, adjacent windows meeting exactly), with the error naming the offending value and the gap or overlap; no duplicate identical identifier entries; `continuities` require `gap_from < gap_to` and an anchor owned by exactly one class (a boundary already resolves the ambiguity).

### 4. Registry-revision migration with interval cutting (R17) — `reconcile_identity_registry`

Runs as the **first step inside the single bootstrap transaction**, and is directly callable inside a caller-supplied transaction. It **asserts `conn.in_transaction`** and never issues `BEGIN`/`COMMIT`/`ROLLBACK` itself, so nothing it does can be committed independently of the seeding passes.

1. **Owner windows.** For each `(id_type, value)` present in the database or the authority, build the sorted window list `((from|None, to|None, security_id, id_state, class), …)` — a single unbounded provisional window when the value is undeclared.
2. **Cut.** For each persisted `security_identifiers` row, compute `cut_interval(row_interval, windows)` — the pure partition of `[valid_from, valid_to)` at every boundary it crosses, yielding one or more `(security_id, from, to)` pieces. A row wholly inside one window with the right owner is untouched; a row crossing a boundary is deleted and replaced by its pieces under their owners (`Mutations.intervals_cut` counts predecessor rows so partitioned).
3. **Rename (all of a security's pieces land on one target ≠ current)** — promotion (provisional → declared) or merge (anchors joining a declared class). FK-safe statement order: `INSERT OR IGNORE INTO securities(target…)`; `UPDATE <each referencing table> SET security_id = target WHERE security_id = old`; `UPDATE security_supersessions SET security_id = target WHERE security_id = old` (**chain collapsing**, so an older predecessor resolves to the newest successor); `DELETE FROM securities WHERE security_id = old`; `INSERT INTO security_supersessions(old, target, reason, 'securities.yaml')`. Merged `entity_candidates` are unioned; link state re-derived (≥2 distinct → `conflict`).
4. **Fan-out (pieces land on more than one target — a split).** First test whether the predecessor `security_id` is itself one of the split targets — i.e. a **declared owner that must survive** the split (the common case: a declared class hands *one* identifier value to another class at a boundary while keeping its own id, its other identifier bindings, and its metadata). Two branches:
   - **Retained-owner branch (the predecessor is a target and survives):** do **not** delete the predecessor. Preserve its `securities` row and every binding whose owner did **not** change; move only the pieces whose owner actually changed to their new owners; recompute/reset link state only for the securities actually affected; and insert `security_supersessions` rows (`reason='split'`) **only for identities actually superseded** (the moved pieces), never for the retained id. FK-safe statement order throughout (insert successors → repoint referencing rows → record supersessions), so the retained id is never orphaned or deleted.
   - **Full fan-out branch (the predecessor is provisional or not itself a target):** insert each successor; move each piece to its owner; delete the predecessor; insert one `security_supersessions` row per successor (`reason='split'`), and re-point any supersession rows that pointed at the predecessor to **each** successor, preserving one-to-many semantics.

   In both branches each successor's `entity_candidates` is **reset** to `[]`/`unresolved` (per-observation candidates cannot be redistributed) and `Mutations.links_reset_on_split` counts it; the observation pass that follows in the same transaction re-derives them. A test applies a **declared-class → split with a boundary-crossing interval** to a **populated** database and asserts the retained class keeps its `security_id`, metadata, and unaffected bindings, with no foreign-key violation and convergence to the clean build.
5. **Totality.** The covering validation guarantees every date has exactly one owner, so every piece has exactly one destination; the migration asserts that the piece set exactly reconstructs each predecessor interval (no lost or duplicated days).
6. **Collision safety.** Cutting and moving preserve `(id_type, value, valid_from)` for the first piece and introduce new `valid_from`s equal to boundary dates, which no other security can hold for that value because the boundary is owned by exactly one class — so `security_identifier_no_overlap` cannot be violated; asserted by test.
7. **Referencing-table coverage.** `SECURITY_ID_REFERENCING_TABLES = ("security_identifiers", "security_supersessions")` is a module constant; `test_every_fk_to_securities_is_repointed` reads `PRAGMA foreign_key_list` for every registry table and fails if any table with an FK to `securities` is missing from the constant.

**Convergence contract (tested).** For any registry revision applied to a populated database followed by re-running the same corpus **in the same command**, `securities` and `security_identifiers` are **row-identical** to a clean build with that registry and corpus. The append-only `security_supersessions` ledger is the only permitted difference. A reconcile-only run (no re-fed corpus) additionally leaves split successors' links `unresolved` — stated, counted, and tested.

### 5. Validity interval derivation (DC2/R9) — owner-scoped adjacency-only union

Each accepted FTD row contributes the unit **validity** interval `[d, d+1)`. For one `(id_type, value)`, observed dates are first **grouped by owner window**, then unioned within each group, merging only when calendar-adjacent (`prev.valid_to == next.valid_from`). Union with adjacency merging is commutative, associative, and idempotent, so any partition or order yields the identical canonical partition; owner grouping means a run of adjacent observations spanning a boundary produces **two** intervals under **two** securities — exactly what the migration's cut produces from the pre-split state, which is why populated-then-revised converges with clean-build.

Consequence, stated plainly: observations on Jan 5 and Jan 7 produce two intervals; Jan 6 resolves to `None`; weekend gaps are not bridged; and an ownership boundary always ends an interval.

### 6. Entity link (DC4) — monotone candidate set

For each accepted FTD row, resolve `(symbol, settlement_date)` **independently** via `resolve_ticker_as_of`. Distinct resolved `entity_id`s accumulate into `securities.entity_candidates` (a sorted JSON array — a set union, order-independent). Derived: 0 → `unresolved`; 1 → `resolved` with `entity_id` stamped; ≥2 → `conflict` with `entity_id NULL` (sticky). Because `entity_tickers` intervals open at the `company_tickers` snapshot date, FTD observations earlier than that snapshot resolve to `None` — an intended G14 consequence, asserted by test.

### 7. Snapshot semantics (DC1)

Reconciliation runs in memory before any write. A CIK with two distinct normalized titles in one snapshot has **all** its rows routed to `rejected_title_conflict`, keeping buckets exclusive. Multiple tickers per CIK with an identical title are normal one-to-many data. On write: an unchanged open name row is left alone; a changed title closes the open row at the snapshot date and opens a new one; a snapshot older than the recorded `valid_from` is refused (history never rewritten). A ticker whose open row belongs to a different entity in this snapshot is closed and reopened; plain absence leaves the row open.

### 8. Reconciliation accounting (DC5) — phases, units, transition rules

```
Disposition   — PARSE phase.      Mutually exclusive source-row buckets; sum == rows_read.
Mutations     — WRITE phase.      Rows/objects this run inserted, updated, cut, or deleted.
RegistryState — POST-WRITE phase. Metrics measured against the registry AFTER the write
                                  passes, relative to this run's input.
```

No `RegistryState` field describes what existed before the run — every field is a function of `(resulting registry, this run's input)`, both identical on replay, so "identical on replay" is true by construction. "How much was new" is a write fact and lives in `Mutations`. **Every stated total is expressed in one unit on both sides.**

**company_tickers**

| Family · field | Unit | Phase | First run → replay |
|---|---|---|---|
| `Disposition.accepted` / `rejected_malformed` / `rejected_duplicate` / `rejected_title_conflict` | source entries; sum == `rows_read` | parse | identical |
| `Mutations.entities_inserted` | `entities` rows | write | → 0 |
| `Mutations.names_opened` / `names_closed` | `entity_names` rows | write | → 0 |
| `Mutations.tickers_opened` / `tickers_closed_reassigned` | `entity_tickers` rows | write | → 0 |
| `RegistryState.entities_in_registry` | **entities** (distinct accepted CIKs present after the run) | post-write | identical |
| `RegistryState.names_current` / `names_ahead_of_snapshot` | **CIKs** (partition of distinct accepted CIKs) | post-write | identical; `names_ahead_of_snapshot` **non-zero on both runs** for the out-of-order fixture |
| `RegistryState.tickers_current` / `tickers_ahead_of_snapshot` | **accepted rows** (partition of `Disposition.accepted`) | post-write | identical; **non-zero on both runs** for the out-of-order fixture |
| `RegistryState.entities_absent_from_snapshot` | **entities** | post-write | identical; **non-zero on both runs** for the snapshot-2 fixture |
| `RegistryState.tickers_absent_from_snapshot` | **open ticker rows** | post-write | identical; **non-zero on both runs** for the snapshot-2 fixture |

Stated totals (each asserted, both sides in one unit): `names_current + names_ahead_of_snapshot == distinct accepted CIKs` (CIKs); `tickers_current + tickers_ahead_of_snapshot == Disposition.accepted` (rows).

**FTD**

| Family · field | Unit | Phase | First run → replay |
|---|---|---|---|
| `Disposition.accepted` / `rejected_blank` / `rejected_malformed` / `rejected_duplicate` | input lines after the header; sum == `rows_read` | parse | identical |
| `Mutations.securities_created` | securities rows inserted | write | → 0 |
| `Mutations.securities_promoted` / `securities_merged` / `securities_split` | **predecessor securities** renamed / absorbed / fanned out | write | → 0 |
| `Mutations.supersessions_recorded` | `security_supersessions` rows | write | → 0 |
| `Mutations.intervals_cut` | **predecessor `security_identifiers` rows** partitioned at a boundary | write | → 0 |
| `Mutations.intervals_inserted` / `intervals_extended` / `intervals_removed` / `intervals_moved` | `security_identifiers` rows | write | → 0 |
| `Mutations.links_stamped` / `links_conflicted` / `links_cleared` / `links_reset_on_split` | **securities** updated | write | → 0 |
| `Mutations.securities_flagged_disputed` / `securities_cleared_by_continuity` | **securities** updated | write | → 0 |
| `RegistryState.anchors_in_registry` | **anchors** (distinct accepted `(id_type, value)`) | post-write | identical |
| `RegistryState.securities_in_registry` | **securities** (distinct securities the accepted anchors map to) | post-write | identical |
| `RegistryState.securities_declared` / `securities_provisional` | **securities** (partition of `securities_in_registry`) | post-write | identical |
| `RegistryState.links_resolved` / `links_conflicted` / `links_unresolved` | **securities** (partition of `securities_in_registry`) | post-write | identical |
| `RegistryState.observations_covered` / `observations_disputed` | **distinct `(value, settlement_date)` pairs** (partition of distinct accepted pairs) | post-write | identical; `observations_disputed` **non-zero on both runs** for the reuse fixture |
| `RegistryState.symbols_resolved` / `symbols_unresolved` / `symbols_blank` | **link attempts** (partition of `Disposition.accepted`) | post-write | identical |
| `RegistryState.identity_reuse_candidates` | **anchors** | post-write | identical; **non-zero on both runs** for the reuse fixture |
| `RegistryState.classes_in_force` / `continuities_in_force` | authority-file entries | post-write | identical |

Stated totals, each in one unit and each asserted **against the declared-split fixture** (where one anchor maps to two securities, so `anchors_in_registry == 1` and `securities_in_registry == 2`):
`securities_declared + securities_provisional == securities_in_registry` (securities);
`links_resolved + links_conflicted + links_unresolved == securities_in_registry` (securities);
`observations_covered + observations_disputed == distinct accepted (value, date) pairs` (pairs);
`symbols_resolved + symbols_unresolved + symbols_blank == Disposition.accepted` (link attempts — a labeled cross-family cross-check, never a bucket).

### 9. `SecClient` (§11.4, M2-CONTRACT §1)

`net/__init__.py` holds the SEC UA/host policy and re-exports `TransportResponse`; `net/sec_client.py` holds the client, `SecTransport` Protocol, and `HttpxSecTransport` (`transport` is a required positional argument, no default).

In-code constants, no config seam: `MIN_INTERVAL_S = 0.5`, `BACKOFF_SCHEDULE = (1.0, 2.0, 4.0, 8.0)`, `CIRCUIT_403_THRESHOLD = 3`, `TTL_S = {"submissions": 3600, "archives": 86400, "bootstrap": 86400, "default": 900}`. `endpoint_class(url)` is a pure prefix-matching function.

**Concurrency** — two independent mechanisms:

```
_gate:   threading.Lock   # CLIENT-WIDE. Serializes spacing + every transport call, so the
                          # ≤2 req/s floor applies ACROSS different URLs.
_state:  threading.Lock   # guards _flights, _cache, and the breaker counters
_flights: dict[str, _Flight]      # _Flight: event, result, error
```

`get(url)`: (1) under `_state`, raise immediately if the breaker is latched; (2) validate scheme/host; (3) under `_state`, a fresh cache entry → return it, else join an existing flight as a **follower** (`coalesced += 1`), else register a flight as **leader**; (4) follower releases `_state`, waits on the event, then re-raises `flight.error` or returns `flight.result` — irrespective of TTL, so TTL-0 waiters share the leader's response; (5) leader releases `_state`, takes `_gate`, **re-checks the latch under `_state` before spacing or transport** — if it opened while queued, it makes **zero** transport calls, completes the flight with `SecCircuitOpenError`, and raises — otherwise performs spacing, the conditional/plain GET, and 429/5xx backoff retries inside the gate; then releases the gate and, under `_state`, stores the cache entry, sets result/error, deletes the flight, and signals.

Lock ordering is fixed: `_state` is held only in short non-I/O sections and never while waiting or during I/O; `_gate` is held around spacing/transport and briefly takes `_state` for the latch re-check. Failed flights are removed, never cached.

Remaining behavior: **host guard** (https only; `www.sec.gov`/`data.sec.gov`/`.sec.gov` subdomain; userinfo and embedded-host tricks rejected; string operations only, since `urllib` is banned); **ETag cache** (fresh→served; stale→conditional GET; `304`→refresh and return cached with `revalidated=True`; `200`→replace; in-memory per instance); **backoff** (schedule, honoring `Retry-After` only when longer; exhaustion returns the last response); **breaker** (consecutive 403s reset by any non-403; latches; the same exception reaches leader and followers; 403 never retried; UA never varied); **UA** (`SEC_APP_NAME = "Populus"`; `sec_user_agent(contact) -> f"Populus {contact}"`, which with the default contact is exactly the byte string M2-CONTRACT §1 recorded at 200; no version segment; `sec_contact(environ)` is pure and warns through an injected callable; `Accept-Encoding: gzip, deflate` always); **`HttpxSecTransport`** uses module-level `httpx.get` per call so no `httpx.Client` is held.

### 10. Register + CLI + the single data transaction

Two new `licenses.json` entries, `register_version` → `licenses-1.1.0`, both dated `2026-07-24` / review-by `2026-10-24`, recorded as endpoint-level determinations under the §15.2 `us-govworks-sec` umbrella. `sec-edgar`'s restrictions record the verified UA correction; `sec-ftd`'s permitted uses cover redistributing a provenance-recorded excerpt as a fixture (R14) — which is why T1 precedes T8/T14.

`run_identity_bootstrap` owns the only transaction bracket:

```
INSERT ingest_runs (... status='running')        # autocommit, BEFORE the transaction
try:
    conn.execute("BEGIN IMMEDIATE")
    try:
        reconcile_identity_registry(conn, registry)   # asserts conn.in_transaction
        bootstrap_tickers(conn, ...)                  # asserts conn.in_transaction
        bootstrap_ftd(conn, ...)                      # asserts conn.in_transaction
        UPDATE ingest_runs SET finished_at=?, status='ok',       # audit SUCCESS finalized
               rows_loaded=?, parse_failures=? WHERE run_id=?    # INSIDE the data txn
        conn.execute("COMMIT")                        # registry data + 'ok' audit commit atomically
    except BaseException:
        conn.execute("ROLLBACK"); raise
except BaseException:
    UPDATE ingest_runs SET finished_at=?, status='failed' WHERE run_id=?   # autocommit, after rollback
    raise
```

The success-finalization UPDATE runs **inside** the data transaction immediately before `COMMIT`, so registry data and the `ok` audit row commit atomically — there is no window in which registry data is committed while the audit row is left `running`/incomplete. A failure anywhere — including in the FTD pass **after** a non-no-op registry revision, **or in the success-finalization UPDATE itself** — rolls back the migration, both seeders, the supersession ledger, and the not-yet-committed `ok` update together, then routes through the `except` that autocommits the `failed` status; the audit row therefore always ends `ok` (all data committed) or `failed` (all data rolled back), never `running`. An **injected success-finalization failure** test asserts exactly this (data rolled back, row `failed`). `reconcile_only(conn, registry)` is a thin public wrapper that brackets, for reconcile-only tests. `format_bootstrap_summary` prints all three counter families per source with units, plus disputed identifiers awaiting review; the command exits non-zero when the run is not ok.

## Locked Decisions

1. **Registry DDL lives in `src/populus/registry.sql`** (`tests/test_schema.py:112`; `views.sql` precedent). `db.init_db` applies it.
2. **`entity_id = "cik:<10-digit>"`.** CIK is a permanent registrant key.
3. **Durable `security_id`s are declared literals in `src/populus/securities.yaml`, never derived.**
4. **Identity is expressed as dated ownership windows over identifier values.** A split is two classes owning one value over complementary windows; a merge/CUSIP change is one class owning two values. There is no separate `splits` section, so an existing declared class can hand off one identifier at a boundary while keeping its id, its other identifiers, and its metadata — and which successor keeps the id is stated explicitly by the author.
5. **Ownership windows for a value must be disjoint, contiguous, and cover all time.** Validated on load; guidance is to leave windows unbounded unless declaring a boundary. This makes `target_for` total and keeps a provisional id one-per-value.
6. **Undeclared identifiers get an explicitly-labelled provisional id** `"sec:prov:" + sha256(canonical_json(anchor))[:32]`, deterministic across clean rebuilds, with no durability claim, superseded exactly once by a recorded promotion. The `sec:prov:` prefix is reserved and rejected in the authority file.
7. **Observations never assign or change an id.** Interlock A/B.
8. **Validity union is owner-scoped:** adjacency merging never spans an ownership boundary, so a clean build and a migrated populated build produce identical intervals. Interlock C/D.
9. **Migration cuts every persisted interval that crosses a boundary** and asserts the pieces exactly reconstruct the predecessor — no lost or duplicated days.
10. **`security_supersessions` is one-to-many** (`PRIMARY KEY (old_security_id, security_id)`). `resolve_superseded` returns all successors; `resolve_security_successor` is **fail-closed**, returning an id only when there is exactly one. Renames collapse chains.
11. **`reconcile_identity_registry` and both seeders are transaction-agnostic and assert `conn.in_transaction`;** only `run_identity_bootstrap` brackets, with one `BEGIN IMMEDIATE` around all three. SQLite does not nest transactions, so this is the only shape that can honor the all-or-nothing guarantee.
12. **Undeclared reuse is fail-closed (R18).** A disputed identifier's mappings resolve to `None` for every date until a reviewed declaration exists; disputed identifiers are counted and listed, never dropped (G3).
13. **`REUSE_REVIEW_HORIZON_DAYS = 3650`**, an in-code labeled policy constant with `continuities` as the reviewed escape hatch; stated as a conservative assumption, not a verified CGS rule.
14. **`EntityRef.name` is non-null; `resolve_entity_by_cik` returns `None`** when no unique applicable name interval exists.
15. **No FTD observations table.** Owner-scoped intervals plus the monotone `entity_candidates` set give order-independence at O(#securities) storage, honoring M2-CONTRACT §3's ≤ low-MB budget.
16. **A snapshot-internal title conflict rejects that CIK's rows entirely.**
17. **`entity_link_state` is sticky at `conflict`.**
18. **Three counter families with per-field unit, phase, and transition rule.** Every stated total is single-unit on both sides; `anchors_in_registry` (anchors) is kept separate from `securities_in_registry` (securities), and all security-state partitions sum to the latter.
19. **The audit row is opened in autocommit before the single data transaction and completed on both paths.**
20. **The emitted SEC User-Agent is the exact verified `"Populus <contact>"` form with no version segment.**
21. **Both provider-facing acceptance gates are mandatory and executable**, with exact commands in Rollout including the named archive and a substitution rule.
22. **Two new register entries (`sec-edgar`, `sec-ftd`)** under the retained `us-govworks-sec` umbrella, dated `2026-07-24`; `tests/test_licenses.py:79` extended to pin M1 dates and assert a quarter-cadence invariant.
23. **`net/sec_client.py` is added to `HTTPX_ALLOWED`;** `urllib` stays banned.
24. **`SecClient` ships unwired to any live library path this run.**
25. **`license_id` columns on `entity_names`, `entity_tickers`, `security_identifiers`.**
26. **The FTD parser is header-driven, matched by column name**, with a hard `FtdFormatError`; the header is verified by a committed real-archive excerpt.
27. **This plan is committed to `docs/build/RUN-M2-1-plan.md` as T0**, the implementer's first DEV action, because planning-phase writes were denied.

## Alternatives Considered

- **A separate `splits` section with derived or standalone successor ids (previous revision).** Rejected: it forbade a split segment from referencing an existing declared class, so splitting a class-owned CUSIP would have discarded the class's other identifiers or replaced its id. Ownership windows express the same thing without a second section.
- **Assigning a whole persisted interval to the owner of its `valid_from` (previous revision).** Rejected: a run of adjacent observations spanning a boundary would stay with the first successor, giving wrong as-of resolution and breaking clean-build convergence. Replaced by `cut_interval` plus owner-scoped union.
- **Content-addressed class key over the anchor set.** Rejected: adding a reviewed relationship rekeyed existing securities.
- **UUID minting.** Rejected: identical clean bootstraps produced different identities.
- **`security_id = sha256("cusip:" + X)`.** Rejected: could not represent identifier reuse.
- **BRP horizon auto-split + deferred bridges.** Rejected: arrival-order dependent.
- **All ids declared, none provisional.** Rejected: the FTD bootstrap meets ~10k undeclared CUSIPs.
- **A database-side id allocator.** Rejected: breaks clean-rebuild determinism.
- **Committing reconciliation before the seeding passes (previous revision).** Rejected: a seeder failure would leave a partially rekeyed registry committed under a `failed` run.
- **Counting anchors in the security-state family (previous revision).** Rejected: a split anchor maps to two securities, so the stated totals were false.
- **Leaving disputed reuse resolvable.** Rejected: distinct instruments could share a security.
- **A short (365-day) reuse horizon.** Rejected once resolution became fail-closed.
- **Per-cache-key locks alone; breaker checked only before flight registration.** Rejected: neither rate-limits distinct URLs nor stops queued leaders.
- **A persistent `httpx.Client`.** Rejected: no `__del__`, must be explicitly closed.
- **Crafted-fixture-only FTD coverage.** Rejected: a hand-written header can pass every gate while the real archive fails.

## Planned Files

New:

- `docs/build/RUN-M2-1-plan.md` (T0 — this plan, committed as the first DEV action)
- `src/populus/registry.sql`
- `src/populus/securities.yaml`
- `src/populus/identity/__init__.py`
- `src/populus/identity/registry.py`
- `src/populus/identity/bootstrap.py`
- `src/populus/net/__init__.py`
- `src/populus/net/sec_client.py`
- `tests/test_identity.py`
- `tests/test_identity_bootstrap.py`
- `tests/test_identity_migration.py`
- `tests/test_sec_client.py`
- `tests/fixtures/inst/registry/company_tickers-sample.json`
- `tests/fixtures/inst/registry/company_tickers-conflict.json`
- `tests/fixtures/inst/registry/company_tickers-snapshot2.json`
- `tests/fixtures/inst/identity/securities-class.yaml`
- `tests/fixtures/inst/identity/securities-class-extended.yaml`
- `tests/fixtures/inst/identity/securities-class-split.yaml`
- `tests/fixtures/inst/identity/securities-fresh-split.yaml`
- `tests/fixtures/inst/identity/securities-continuity.yaml`
- `tests/fixtures/inst/identity/securities-invalid.yaml`
- `tests/fixtures/inst/ftd/cnsfails-real-excerpt.txt`
- `tests/fixtures/inst/ftd/PROVENANCE.md`
- `tests/fixtures/inst/ftd/cnsfails-partition-a.txt`
- `tests/fixtures/inst/ftd/cnsfails-partition-b.txt`
- `tests/fixtures/inst/ftd/cnsfails-boundary-span.txt`
- `tests/fixtures/inst/ftd/cnsfails-reuse.txt`
- `tests/fixtures/inst/ftd/cnsfails-malformed.txt`

Modified:

- `src/populus/db.py`
- `src/populus/cli.py`
- `src/populus/licenses.json`
- `DATA-LICENSE.md` (regenerated)
- `NOTICE` (regenerated)
- `tests/conftest.py`
- `tests/test_licenses.py`
- `tests/test_dep_guard.py`

## Implementation Tasks

**T0 — Commit this plan.** [R7 traceability]
Write this plan to `docs/build/RUN-M2-1-plan.md` and commit it on the feature branch before any code change, because planning-phase writes were denied.

**T1 — Register entries first (G11).** [R6]
Add `sec-edgar` and `sec-ftd` to `licenses.json` with full §15.1 field sets; `sec-edgar` records the SEC-accepted UA requirement and the verified 403 on the parenthesized form; `sec-ftd` records identifier-seed-only use, the no-inference-across-gaps condition, and permission to redistribute a provenance-recorded excerpt as a fixture. Bump `register_version` to `licenses-1.1.0`. Regenerate `DATA-LICENSE.md`/`NOTICE`. Extend `tests/test_licenses.py` and add `test_m2_register_entries_well_formed` + `test_sec_edgar_records_the_ua_condition`. Precedes T8 and T14.

**T2 — Registry DDL + loader.** [R1, R2]
Write `src/populus/registry.sql` per Architecture §1 (including `security_supersessions` and `securities.id_state`). Add `ensure_registry(conn)` mirroring `amendments.ensure_views`; wire into `db.init_db`. Add `registry_overlap_errors(conn)`.

**T3 — Identity authority file + loader.** [R16, R10]
Create `src/populus/securities.yaml` (empty, documented header including the unbounded-unless-declaring-a-boundary guidance). Add `default_securities_text()`, `IdentityRegistry`, `IdentityRegistryError`, `load_identity_registry(text_or_path)` with every §3 validation (notably the disjoint/contiguous/covering window check with an error naming the value and the gap or overlap), `owner_windows(registry, id_type, value)`, and `target_for(id_type, value, date)`.

**T4 — Provisional ids + supersession resolvers.** [R10, R17]
`anchor(id_type, value)`, `provisional_security_id(anchor)`, `resolve_superseded(conn, old_id)`, fail-closed `resolve_security_successor(conn, old_id)`.

**T5 — Interval cutting + migration.** [R17, R10, R9]
`cut_interval(interval, windows)` — a pure partition function. `SECURITY_ID_REFERENCING_TABLES` constant. `reconcile_identity_registry(conn, registry)` implementing Architecture §4 steps 1–7, asserting `conn.in_transaction` and never opening or committing a transaction; plus the `reconcile_only(conn, registry)` bracketing wrapper for reconcile-only callers.

**T6 — Normalizers.** [R1, R8, R10]
`normalize_cik`, `normalize_ticker`, `normalize_entity_name` (via `canonical.nfc`), `normalize_cusip` (9-char `[0-9A-Z]`), `entity_id_for(cik)`, private `_upsert_entity`.

**T7 — As-of resolution API (fail-closed).** [R2, R8, R18]
`EntityRef(entity_id: str, cik: str, name: str)` with a **non-null** `name`; `resolve_entity_by_cik`, `resolve_cusip`, `resolve_ticker_as_of` — required `as_of_date`, half-open bounded, `None` on no-match, on ambiguity, on a `disputed` row, and (for the entity resolver) when no unique applicable name interval exists. Re-export from `identity/__init__.py`.

**T8 — Acquire the real FTD archive and commit a provenance-recorded excerpt.** [R14, R4]
Fetch the archive named in Rollout into `data-cache/inst/ftd/` (gitignored). Commit `cnsfails-real-excerpt.txt` (verbatim header + ~20 verbatim rows) and `PROVENANCE.md` recording source URL, filename, retrieval date, sha256 of the archive and of the excerpt, any substitution, and `license_id: sec-ftd`. Record the observed header in the dev notes.

**T9 — Owner-scoped validity union + reuse-review flag.** [R9, R18]
`union_intervals(existing, observed_dates)` — pure, adjacency-only, `None`-as-open-ended safe; `rewrite_identifier_intervals(...)` grouping observed dates **by owner window** before unioning; `reuse_review_decisions(conn, anchor, registry, horizon_days=REUSE_REVIEW_HORIZON_DAYS)` honoring declared boundaries and continuities and touching only `review_state`/`confidence`.

**T10 — Entity-link derivation (DC4).** [R11]
`apply_entity_candidates(conn, security_id, candidates)` with the sticky-conflict rule.

**T11 — Three-family accounting types (DC5).** [R12]
`Disposition` (with a `__post_init__` sum assertion), `Mutations` (writes only), `RegistryState` (post-write metrics, with `anchors_in_registry` separate from `securities_in_registry`), the three report dataclasses, and `format_bootstrap_summary` printing every counter with its unit plus disputed identifiers awaiting review.

**T12 — company_tickers bootstrap.** [R3, R8, R12]
`load_company_tickers(path)` → rows + `Disposition`; `bootstrap_tickers(conn, rows, *, snapshot_date, license_id, provenance)` applying §7 semantics, asserting `conn.in_transaction`, with in-memory reconciliation before any write.

**T13 — FTD bootstrap.** [R4, R9, R10, R11, R12, R14, R16, R18]
`parse_ftd(paths)` — header-driven, `.txt` and `.zip`, CRLF-safe, `errors="replace"` + `canonical.nfc`, per-row `Disposition`, `FtdFormatError` naming the columns found. `bootstrap_ftd(conn, observations, *, registry, license_id)` — asserting `conn.in_transaction`; resolve each `(anchor, date)` through `target_for`, create securities, union intervals **per owner window**, resolve every `(symbol, settlement_date)` independently, accumulate candidates, derive link state, and apply reuse-review decisions. Accepted observations are applied in a canonical `(id_type, value, settlement_date, symbol)` order.

**T14 — Test fixtures.** [R3, R4, R8, R9, R10, R14, R16, R17, R18]
Two ticker snapshots (multi-ticker one-CIK, absence), a conflicting-title snapshot, an out-of-order snapshot, two FTD partitions with a settlement-date gap and a within-corpus ticker change, a **boundary-span** FTD fixture with adjacent observations on both sides of a declared boundary, a reuse fixture (>horizon gap), a malformed-header FTD file, and six `securities.yaml` fixtures (class, extended class, **class-split** where an existing class keeps its id and other identifiers, fresh split, continuity, invalid).

**T15 — CLI, single transaction, and audit lifecycle.** [R7, R3, R4, R16, R17]
`identity` group + `bootstrap` command (`--from-cache`, repeatable `--ftd`, `--securities`, `--db`, `--as-of`), auto-init/`ensure_registry`, and `run_identity_bootstrap` per Architecture §10: autocommit audit INSERT, one `BEGIN IMMEDIATE` around reconcile + both seeders, `ROLLBACK` and `status='failed'` on any exception, printed summary, non-zero exit when not ok, clean `UsageError`/`ClickException` — never a traceback.

**T16 — `SecClient`.** [R5, R15]
`net/__init__.py` and `net/sec_client.py` per Architecture §9, including the client-wide `_gate`, the `_flights` map with shared result/exception, the in-gate latch re-check, documented lock ordering, and `HttpxSecTransport`. Add `"net/sec_client.py"` to `HTTPX_ALLOWED`.

**T17 — Test suites.** [R1–R18]
`tests/test_identity.py`, `tests/test_identity_bootstrap.py`, `tests/test_identity_migration.py`, `tests/test_sec_client.py`; add the three row factories to `tests/conftest.py`.

**T18 — Gate run and mandatory provider acceptance.** [R13, R14, R15, R3, R7]
Run `uv run pytest -q`, `uv run python scripts/dep_guard.py`, `make check`. Then execute the exact Rollout commands and record their outputs in the dev notes: the real-corpus ticker bootstrap; **R14** the full-archive `--ftd` run with parsed-row and disposition counts; **R15** the shipped-client smoke check with the exact bytes sent and the observed status. A non-200 on R15 blocks completion.

## Testing Strategy

All tests are hermetic — the autouse `_no_network` fixture (`tests/conftest.py:14`) blocks `socket` in every test, and `SecClient` requires an injected transport. R14/R15 acceptance runs are operator commands outside `pytest`.

**`tests/test_identity.py` (R1, R2, R8, R9, R10, R16, R18)**
- Schema: all tables (including `security_supersessions`) + both no-overlap indexes exist after `db init`; every M1 table still present; `ensure_registry` is idempotent and upgrades a pre-existing M1 database.
- Constraint proofs, one per test: `entities.cik` UNIQUE; `id_type` CHECK rejects `'isin'`; `id_state`, `confidence`, `review_state`, `entity_link_state`, `supersession.reason` CHECKs; the `entity_id`↔`entity_link_state` CHECK; `entity_names` PK; both no-overlap indexes; `security_supersessions` accepts two successors for one predecessor.
- `registry_overlap_errors`: reports intersecting windows per mapping table; `[]` for windows meeting at a boundary.
- **G14 refusal:** `resolve_cusip`/`resolve_ticker_as_of` return the value inside `[from, to)` and `None` one day before `valid_from` and on `valid_to`.
- **G14 no-chaining:** CUSIP X bound only in January while ticker `FOO` is open-ended → `resolve_cusip(X, february)` is `None`; a structural test asserts every public `resolve_*` has a **required** `as_of_date`.
- **Fail-closed entity resolution** and **R18 disputed resolution** (a disputed row never resolves, at any date, in either era).
- **DC2/R9 gap refusal:** Jan 5 + Jan 7 → two intervals, Jan 6 → `None`, Jan 8 → `None`; Jan 5 + Jan 6 → one merged `[Jan 5, Jan 7)`.
- **`test_union_never_spans_an_ownership_boundary`:** with a boundary at B, adjacent observations on B−1 and B produce two intervals under two securities.
- **`cut_interval` unit table:** wholly inside one window; crossing one boundary; crossing two boundaries; starting exactly on a boundary; ending exactly on a boundary; open-ended `valid_to`; single-day interval. Each asserts the pieces exactly reconstruct the input.
- **Identity unit tests:** `provisional_security_id` is pure and always prefixed `sec:prov:`; `target_for` returns the declared owner for a date inside its window and the provisional id for an unnamed value; `resolve_security_successor` returns the id for one successor and `None` for two.
- **Interlock `test_observations_never_change_any_security_id`.**
- **Interlock `test_declared_id_survives_binding_revision`:** loading `securities-class.yaml` then `securities-class-extended.yaml` then `securities-class-split.yaml` leaves that class's `security_id` byte-identical, and after the split it still owns its other identifiers with its `class` and `review_state` unchanged.
- **Interlock `test_horizon_flag_does_not_widen_validity`.**
- **R16 loader:** all five valid fixtures parse; each validation failure (missing `note`, bad anchor, reserved prefix, malformed id, duplicate id, `from >= to`, **non-covering windows**, **overlapping windows**, duplicate identifier entry, `gap_from >= gap_to`, continuity anchor with two owners) raises `IdentityRegistryError` with an actionable message naming the offending value; the **packaged** `securities.yaml` loads and validates (mirroring `tests/test_schema.py:248`).
- `union_intervals` unit table: empty, single, adjacent, gapped, duplicate, out-of-order, open-ended-existing.

**`tests/test_identity_migration.py` (R17, R10, R2, R9)**
- **Empty → class:** populate with an empty authority (two provisional securities for `OLD` and `NEW`), apply a registry declaring one class owning both, re-run the corpus → one declared security with both bindings; two supersessions; `resolve_security_successor` returns the class id for each; **row-identical** to a clean build for `securities` and `security_identifiers`, with the ledger the only difference.
- **Class-chain extension:** a second revision adding a third identifier → the class's `security_id` is **byte-identical**; the third provisional id is superseded into it; an earlier predecessor still resolves to it (chain collapsing); convergence holds.
- **Declared-class → split (F1/F2 case):** a populated DB built with `securities-class.yaml` and the **boundary-span** corpus (adjacent observations on B−1 and B, merged into one interval) then revised to `securities-class-split.yaml` → the existing class **keeps its `security_id`, its other identifiers, its `class`, and its `review_state`**; the merged interval is **cut** at B; `resolve_cusip(X, B−1)` returns the original class and `resolve_cusip(X, B)` returns the successor; `Mutations.intervals_cut == 1`; two supersessions share one `old_security_id` only where a predecessor security was fanned out; convergence with a clean build holds.
- **Fresh split (undeclared value):** `securities-fresh-split.yaml` over the reuse corpus → two successors, `resolve_superseded` returns both, `resolve_security_successor` returns `None`.
- **Reconcile-only run:** without re-feeding the corpus, split successors are `unresolved` with `Mutations.links_reset_on_split` non-zero — stated, asserted.
- **FK coverage interlock `test_every_fk_to_securities_is_repointed`.**
- **`test_reconcile_requires_an_open_transaction`:** calling `reconcile_identity_registry` outside a transaction raises; `reconcile_only` succeeds.
- **Idempotence:** re-running with an unchanged registry is a no-op (all `Mutations` zero).
- **Collision safety:** cutting and moving never violate `security_identifier_no_overlap`.

**`tests/test_identity_bootstrap.py` (R3, R4, R7, R8, R9, R10, R11, R12, R14, R18)**
- Ticker bootstrap: rows written with expected provenance/confidence/review_state/license_id; multi-ticker single-CIK accepted; malformed and duplicate rows bucketed.
- **DC1 conflict**, second-snapshot transitions, out-of-order refusal, absence vs reassignment — as in Architecture §7, each asserting the corresponding counters.
- **DC5 invariant 1:** `sum(Disposition buckets) == rows_read` for every fixture and both sources, with no reference to another family.
- **DC5 invariant 2 (exact replay):** every `Mutations` field `== 0` and every `RegistryState` field equal to the first run's value, field by field — over the snapshot-2, out-of-order, and reuse fixtures, each asserting its characteristic field **non-zero on both runs**.
- **DC5 phase check:** `entities_in_registry` equals distinct accepted CIKs on **both** a clean first ingest and its replay, while `Mutations.entities_inserted` is what differs.
- **DC5 unit/total check (F3):** over the **declared-split fixture**, assert `anchors_in_registry == 1`, `securities_in_registry == 2`, `securities_declared + securities_provisional == 2`, `links_resolved + links_conflicted + links_unresolved == 2`, `observations_covered + observations_disputed == distinct accepted pairs`, and `symbols_* == Disposition.accepted`.
- **DC3 determinism:** two clean databases from the same corpus and authority → the exact same set of `security_id` values and identical rows.
- **DC3 permutation:** all orderings of {A, B}, the merged single input, and "B alone then A alone" → identical actual `security_id` values and identical rows.
- **DC3 no-rekey:** ids snapshotted after partition B are byte-identical after partition A is ingested.
- **DC3 CUSIP change through `bootstrap_ftd`:** with `securities-class.yaml`, a corpus of only `OLD` then only `NEW` observations yields one declared security with both dated bindings; `resolve_cusip(OLD, d_old) == resolve_cusip(NEW, d_new)`.
- **R18 undeclared reuse:** the reuse fixture with an empty authority yields a `disputed` security unresolvable in **both** eras, non-zero `identity_reuse_candidates` and `observations_disputed`, and a summary listing. With `securities-fresh-split.yaml` → two distinct ids each resolving only in its own era. With `securities-continuity.yaml` → one security resolving normally in both eras and `Mutations.securities_cleared_by_continuity == 1`.
- **DC4** conflict/resolved/pre-snapshot cases.
- **R14 real-format fixture** and its `PROVENANCE.md` companion test.
- FTD parsing: `.zip` parity; blank/trailer → `rejected_blank`; bad CUSIP or date → `rejected_malformed`; blank symbol → `symbols_blank`; malformed header → `FtdFormatError` naming the columns found.
- **R7 all-or-nothing (F4):** a run using a **non-no-op** registry revision with an injected failure in the FTD pass leaves `securities`, `security_identifiers`, and `security_supersessions` **byte-identical to the pre-run state** (the migration did not commit) **and** exactly one `ingest_runs` row with `status='failed'` and non-null `finished_at`; the CLI exits non-zero, single line, no `Traceback`. A second variant injects the failure in the ticker pass. A success case asserts one `status='ok'` row with matching counts.
- CLI surface: missing `company_tickers.json` → exit 2 one-line `UsageError`; unreadable DB target → exit 1 single line; `--securities` reaches reconciliation and the FTD pass.

**`tests/test_sec_client.py` (R5, R15)**
- **R15 UA pin**, `sec_contact` behavior, single-UA-across-all-requests, `Accept-Encoding` on every request, and the no-parenthesized-literal source scan.
- **Client-wide rate floor** over three distinct URLs; no rate/TTL/threshold constructor parameter.
- **Coalescing with TTL-0**; **retries inside a flight**; **failure propagation with clean retry**; **in-gate latch re-check** with N+1 queued distinct-URL leaders making zero transport calls; **latched fast path**.
- Cache hit / conditional GET / `304` / `200` replacement; `endpoint_class` mapping and TTLs; backoff schedule and `Retry-After` handling; host guard rejections; no default transport.

**Modified M1 suites** — `tests/test_licenses.py`, `tests/test_dep_guard.py` (one `HTTPX_ALLOWED` entry), `tests/conftest.py` (three factories). No M1 test is deleted, skipped, or weakened.

## Verification Matrix

| ID | Check | Evidence |
|---|---|---|
| R1 | All registry tables + both no-overlap indexes created by `db init`; per-constraint rejection proofs; M1 DDL untouched | `tests/test_identity.py` schema/constraint tests; `tests/test_schema.py::test_schema_sql_matches_architecture_exactly` still green |
| R2 | Interval-bounded, unique-row, undisputed, fail-closed resolution; `EntityRef.name` non-null; required `as_of_date` | `tests/test_identity.py` as-of, fail-closed, disputed, no-chaining, signature tests |
| R3 | `company_tickers.json` seeds entities/names/tickers with correct provenance and no network | `tests/test_identity_bootstrap.py` ticker tests; Rollout step 4 |
| R4 | FTD seeding is a pure function of `(observations, authority)`: same rows and ids under any partition/order/backfill | `tests/test_identity_bootstrap.py` determinism + permutation + no-rekey tests |
| R5 | Client-wide floor, coalescing, in-gate latch re-check, ETag cache, backoff | `tests/test_sec_client.py` — all groups |
| R6 | `sec-edgar`/`sec-ftd` exist, validate, render drift-free; dep_guard clean | `tests/test_licenses.py`; `scripts/dep_guard.py` |
| R7 | One data transaction around reconcile + both seeders; injected failure in either pass leaves registry data byte-identical **and** one `status='failed'` audit row | `tests/test_identity_bootstrap.py` all-or-nothing tests (both variants) + success case |
| R8 | One title per CIK per snapshot; conflicts rejected and counted | `tests/test_identity_bootstrap.py::test_conflicting_titles_rejected_and_counted` |
| R9 | Gapped observations do not merge; gap day → `None`; adjacency never spans an ownership boundary | `tests/test_identity.py` gap-refusal + `test_union_never_spans_an_ownership_boundary` + `union_intervals` table |
| R10 | Declared id byte-identical across binding addition **and** a split of one of its bindings, with other identifiers and metadata preserved; provisional ids deterministic; observations never change an id; identical ids under every permutation | `tests/test_identity.py` interlock tests; `tests/test_identity_migration.py` chain-extension + declared-class-split tests; `tests/test_identity_bootstrap.py` DC3 group |
| R11 | Per-observation as-of resolution; stamp only on unanimity; conflict retained; pre-snapshot → unresolved | `tests/test_identity_bootstrap.py` DC4 tests |
| R12 | Buckets sum to rows read; `Mutations` zero on replay; `RegistryState` identical on replay incl. clean first ingest; **every stated total single-unit and asserted on the declared-split fixture** | `tests/test_identity_bootstrap.py` five accounting tests (sum, replay, phase, unit/total, cross-check) |
| R13 | Whole suite green (936 pre-existing + new); dep_guard 0; `make check` green; no socket use | `uv run pytest -q`; `scripts/dep_guard.py`; `make check`; `tests/conftest.py:14` + `test_owned_source_has_no_network_primitives` |
| R14 | Real-archive excerpt parses with exact counts/values; provenance recorded; full-archive run executed with counts recorded | `tests/test_identity_bootstrap.py` real-excerpt tests; `PROVENANCE.md`; Rollout steps 5–6 |
| R15 | Exact UA bytes pinned; the shipped-client smoke command prints the sent bytes and exits non-zero unless 200 | `tests/test_sec_client.py` UA-pin tests; Rollout step 7 |
| R16 | `securities.yaml` ships, loads, validates; the covering/disjoint window rule is enforced with actionable errors; `--securities` reaches reconciliation and the FTD pass | `tests/test_identity.py` loader tests (incl. the packaged file); `tests/test_identity_bootstrap.py` CLI test |
| R17 | Migration asserts an open transaction; cuts boundary-crossing intervals with exact reconstruction; one-to-many supersessions with chain collapsing; FK-coverage interlock; convergence for empty→class, chain extension, fresh split, **and declared-class→split with a boundary-spanning interval**, all on populated databases | `tests/test_identity_migration.py` (all nine tests); `cut_interval` unit table |
| R18 | Disputed identifiers resolve to `None` in both eras; declared split gives two distinct resolvable ids; declared continuity restores one resolvable security; disputed identifiers counted and listed | `tests/test_identity.py` disputed test; `tests/test_identity_bootstrap.py` R18 group |

## Rollout / Rollback

**Rollout.** One feature branch off `main`, one squash-merge, standard plan → review → dev → QA → review loop. Order: T0 → T1 → T2–T7 → T8 → T9–T15 → T16 → T17 → T18. No data migration for M1 data: `ensure_registry` is `IF NOT EXISTS` and additive; no M1 read path touches the new tables.

Mandatory acceptance sequence — exact commands, all outputs recorded in the dev notes:

```bash
# 1–3 · standing gates
uv run pytest -q
uv run python scripts/dep_guard.py
make check

# 4 · real-corpus ticker bootstrap
uv run populus db init /tmp/i.db
uv run populus identity bootstrap --from-cache data-cache/inst/registry --db /tmp/i.db

# 5 · R14 · fetch the NAMED real FTD archive (M2-CONTRACT §1 path pattern)
mkdir -p data-cache/inst/ftd
curl -fsS -o data-cache/inst/ftd/cnsfails202606b.zip \
  -H 'User-Agent: Populus johnbaekk@gmail.com' -H 'Accept-Encoding: gzip, deflate' \
  https://www.sec.gov/files/data/fails-deliver-data/cnsfails202606b.zip
shasum -a 256 data-cache/inst/ftd/cnsfails202606b.zip   # → PROVENANCE.md
# Substitution rule: if that filename 404s, use the newest cnsfails<YYYYMM>[ab].zip listed at
# https://www.sec.gov/data-research/sec-markets-data/fails-deliver-data and record the
# substituted filename, its URL, and its sha256 in tests/fixtures/inst/ftd/PROVENANCE.md.

# 6 · R14 · full-archive acceptance run; record parsed-row and disposition counts
uv run populus db init /tmp/i2.db
uv run populus identity bootstrap --from-cache data-cache/inst/registry \
  --ftd data-cache/inst/ftd/cnsfails202606b.zip --db /tmp/i2.db
sqlite3 /tmp/i2.db "SELECT id_state, count(*) FROM securities GROUP BY id_state;
                    SELECT count(*) FROM security_identifiers;"

# 7 · R15 · smoke-check the SHIPPED client and print the exact bytes sent
uv run python - <<'PY'
import sys, time
from populus.net.sec_client import HttpxSecTransport, SecClient, sec_contact, sec_user_agent

class Recording:                       # delegates; records exactly what the client sent
    def __init__(self, inner): self.inner, self.sent = inner, []
    def get(self, url, *, headers):
        self.sent.append(dict(headers)); return self.inner.get(url, headers=headers)

contact, warning = sec_contact()
if warning: print(warning, file=sys.stderr)
tx = Recording(HttpxSecTransport())
client = SecClient(tx, contact=contact, sleep=time.sleep, monotonic=time.monotonic)
response = client.get("https://www.sec.gov/files/company_tickers.json")
sent = tx.sent[0]
print("User-Agent bytes sent:", repr(sent["User-Agent"]))
print("Accept-Encoding sent:", repr(sent["Accept-Encoding"]))
print("status:", response.status_code)
assert sent["User-Agent"] == sec_user_agent(contact), "emitted UA is not the pinned form"
sys.exit(0 if response.status_code == 200 else 1)
PY
```

A non-zero exit on step 7, or a failure to produce the counts in step 6, blocks completion.

**Rollback.** `git revert` the squash-merge. The registry tables are inert to every M1 code path, so a reverted build reads and writes an existing database unchanged; leftover tables can be dropped respecting the FK graph, or ignored. `licenses.json` reverts alongside its regenerated `DATA-LICENSE.md`/`NOTICE`, keeping the drift guard green. No published artifact, no external state, no infrastructure, no cost change ($0/mo holds — G8).

## Simplicity Audit

Minimum coherent design: one packaged DDL file, one packaged authority file, one registry module, one bootstrap module, one client module plus its package init, one CLI command. Every new file and public symbol, enumerated:

- `docs/build/RUN-M2-1-plan.md` — T0, this plan on the branch.
- `registry.sql` — required; cannot live in `schema.sql`.
- `securities.yaml` — the stable class-ID authority; ships empty and documented; now **two** sections instead of three.
- `identity/__init__.py` — re-export surface only.
- `identity/registry.py` — `ensure_registry`, `registry_overlap_errors`, `EntityRef`, `resolve_entity_by_cik`, `resolve_cusip`, `resolve_ticker_as_of`, `resolve_superseded`, `resolve_security_successor`, `normalize_cik`, `normalize_ticker`, `normalize_entity_name`, `normalize_cusip`, `entity_id_for`, `_upsert_entity`, `anchor`, `provisional_security_id`, `owner_windows`, `target_for`, `cut_interval`, `union_intervals`, `rewrite_identifier_intervals`, `reuse_review_decisions`, `reconcile_identity_registry`, `reconcile_only`, `SECURITY_ID_REFERENCING_TABLES`, `default_securities_text`, `IdentityRegistry`, `IdentityRegistryError`, `load_identity_registry`, `REUSE_REVIEW_HORIZON_DAYS`.
- `identity/bootstrap.py` — `Disposition`, `Mutations`, `RegistryState`, `TickerBootstrapReport`, `FtdBootstrapReport`, `BootstrapReport`, `load_company_tickers`, `bootstrap_tickers`, `FtdFormatError`, `parse_ftd`, `bootstrap_ftd`, `run_identity_bootstrap`, `format_bootstrap_summary`.
- `net/__init__.py` — UA/host policy constants + `TransportResponse` re-export.
- `net/sec_client.py` — `SecTransport`, `SecResponse`, `SecCircuitOpenError`, `sec_user_agent`, `sec_contact`, `endpoint_class`, `SecClient`, `HttpxSecTransport`, private `_Flight`/`_CacheEntry`.

Net change versus the previous revision: the `splits` YAML section and its derived-successor rules are **deleted** and replaced by ownership windows on identifier entries (one concept fewer, and it is the concept that made F1 unfixable); two small pure functions are added where correctness demanded them (`owner_windows`, `cut_interval`), each with its own unit table; the transaction bracket moves up to exactly one place. Rejected abstractions: a generic temporal-mapping layer; a pluggable identifier-source registry (the `id_type` CHECK is the extension point); an FTD observations table; a config layer for rate/TTL/horizon; automated corporate-action discovery; a database-side id allocator.

## Tech Debt Introduced

- **TD-M2-1-1 — FTD-derived CUSIP validity intervals are sparse by construction, and R18 fail-closing adds to it.** Owner: John Baek. Impact: as-of resolution succeeds only on observed days, and a disputed identifier resolves nowhere until reviewed; M2-2's ≥95% value-coverage gate cannot be met from FTD alone, and unresolved CUSIPs must surface by issuer name with a flag (G3). Removal condition: an authoritative identifier-history source admitted through §15, **or** an explicitly labeled, `confidence`-carrying inference layer in M2-2 visibly distinct from observed intervals (G5). Deliberate: the alternatives are fabricated continuity or silent conflation.
- **TD-M2-1-2 — `securities.yaml` ships empty; declarations are authored by hand.** Owner: John Baek. Impact: until an entry exists, a CUSIP change produces two securities and a decade-scale gap produces a disputed, unresolvable identifier — both visible, flagged, and listed. The *mechanism* (authority, ownership windows, interval cutting, migration, continuities, fail-closed resolution) is built and tested this run; only the *content* and any discovery tooling are outstanding. Removal condition: M2-2 surfaces real cases, added by reviewed commit.
- **TD-M2-1-3 — Provisional ids are promoted, and promotion is a rekey of a provisional value.** Owner: John Baek. Impact: a consumer that persisted a `sec:prov:` id before promotion must follow `security_supersessions`; this is why `id_state` exists and why provisional ids carry no durability claim. Removal condition: M2-3 publishes only declared ids, or publishes provisional ids explicitly flagged as non-durable with the ledger shipped alongside.
- **TD-M2-1-4 — `SecClient` cache is in-memory and per-instance.** Owner: John Baek. Impact: no cross-process reuse; ETag revalidation restarts each run (still far below the ≤2 req/s floor). Removal condition: a disk cache reviewed against the RUN-5 path-containment threat model.
- **TD-M2-1-5 — `ARCHITECTURE.md:639` still states the parenthesized UA for §11.4.** Owner: John Baek. Impact: architecture text and shipped behavior disagree; the register entry and M2-CONTRACT §1 carry the corrected policy meanwhile. Removal condition: an ARCHITECTURE amendment round recording the 2026-07-24 verification.

The four items the reviewer flagged as correctness defects are **fixed in this revision, not deferred**: the authority-model limitation is removed by ownership windows (R10/R16), split migration now cuts boundary-crossing intervals (R17), the partial-commit failure path is closed by the single transaction (R7), and the split-related counter units are made consistent with asserted single-unit totals (R12).

## Memory Touch-Points

**A. Global indexed store** — `/Users/johnbaek/.claude/projects/-Users-johnbaek/memory/`. The selector's exact ten for this round, reported in full; each read, with its concrete effect or non-applicability:

| # | File | Concrete effect on this plan |
|---|---|---|
| 1 | `feedback_plan_development_vs_execution.md` | This message is a requested plan **revision**, so the plan document is revised; no runbook is executed and nothing is written to disk. |
| 2 | `feedback_plan_decision_lock.md` | Twenty-seven **Locked Decisions**, each a stated resolution with rationale — including the four this round settles (ownership windows, interval cutting, single transaction, counter units). No decision is deferred to the implementer. |
| 3 | `feedback_executable_plan_wiring.md` | Every fix is wired into all four executable sections: R7/R9/R10/R12/R16/R17 restated, tasks T3/T5/T9/T11/T15 changed, new tests named in Testing Strategy, matrix rows and DoD items updated. New fixtures (`securities-class-split.yaml`, `cnsfails-boundary-span.txt`) appear in Planned Files, T14, and the tests that consume them. |
| 4 | `feedback_explicit_plan_contracts.md` | The previously implicit mechanisms are formalized: the ownership-window model with its disjoint/contiguous/covering validation, `cut_interval`'s contract and unit table, `target_for`'s totality argument, the transaction bracket written out as pseudocode with the `conn.in_transaction` assertion, and every counter's unit/phase/transition. |
| 5 | `feedback_httpx_client_cleanup.md` | `HttpxSecTransport` uses per-call `httpx.get` and holds no persistent `httpx.Client`; recorded in the Reuse Map. |
| 6 | `feedback_plan_anchor_verification.md` | Every anchor re-grepped on this base: `tests/test_schema.py:112,248`, `tests/test_dep_guard.py:196,208,219`, `tests/test_licenses.py:21,79,102,112`, `src/populus/members.py:193,202,258,408-409,681-693,728-750`, `src/populus/db.py:24-25,43-47`, `src/populus/cli.py:10-13,116-121`, `src/populus/canonical.py:30,35`, `src/populus/publish/digests.py:27`, `src/populus/licenses.json:29`, `src/populus/ingest/senate.py:125-130,189`, `src/populus/aliases.yaml`, `tests/conftest.py:14`, `docs/build/M2-CONTRACT.md:24,36`. |
| 7 | `feedback_plan_rebaseline.md` | Base-ref check run and recorded in the banner: `git log --oneline -1` → `0dfd18d`, `git status --porcelain` empty — the base has not advanced since the previous revision, so no line references needed re-pinning. Reviewer framing was verified against the tree rather than trusted: the M1 audit shape at `src/populus/members.py:728-750` was re-read, confirming it runs several independently-committed passes under one audit row, which is precisely why R7 tightens it. |
| 8 | `feedback_plan_rule_never_cached_disposition.md` | The plan carries the **rule** for deriving dispositions — bucket definitions, the `__post_init__` sum assertion, and the per-field unit/phase/transition table — and no cached counts. The only fixed numbers are stable policy facts. |
| 9 | `feedback_plan_thoroughness.md` | Directly shaped this round: failure modes are thought through per step (interval cutting at every boundary position, partial-commit rollback, collision safety, totality of the piece set), what is excluded is explicit (Non-goals plus the five debt items), nothing is assumed to work without a test (`cut_interval` unit table, `test_reconcile_requires_an_open_transaction`), and rollback for the one destructive-ish operation — migration — is the enclosing transaction plus an injected-failure test. |
| 10 | `feedback_plan_write_denied.md` | Adopted verbatim: a truthful plan-tracking banner opens this document stating that no plan file exists because planning-phase writes were denied, and **T0** — commit this plan to `docs/build/RUN-M2-1-plan.md` — is the implementer's first DEV action, ordered before T1 and listed in Planned Files. |

**B. Project store** — `/Users/johnbaek/.claude/projects/-Users-johnbaek-projects-Populus/memory/`:

- `MEMORY.md` — index; routed to both entries below.
- `john-baek-profile.md` (`type: user`) — "verify data sources yourself, no hand-waving"; decision records with justification; honesty about limitations as a feature. **Effect:** the provisional tier's non-durability, the 10-year horizon's status as a policy assumption, and the reconcile-only link-reset consequence are all stated outright.
- `populus-project.md` (`type: project`) — the standing lessons *"name a verification scope for exactly what it covers"* and *"verify PROVIDER capability against provider docs before asserting it."* **Effect:** the convergence claim is scoped precisely ("row-identical modulo the append-only ledger"); durability is scoped to declared ids; the FTD archive path and SEC UA come from M2-CONTRACT's live verification.

**C.** `~/.claude/skills/_shared/failure-modes.md` — see the Failure-Mode Sweep.

## Failure-Mode Sweep

**F0 — Universal.**
- *Full-set sweep:* all §9.4 tables checked for collateral impact; all three registry mapping tables get `license_id` and an overlap invariant; **every** table with an FK to `securities` enumerated and enforced by a `PRAGMA foreign_key_list` interlock; both generated licensing artifacts regenerate together; all four resolvers share the fail-closed rule; all four `TTL_S` classes tested; every counter carries a unit, phase, and transition rule and every stated total is asserted; every boundary position is covered by the `cut_interval` unit table; all validations of both `securities.yaml` sections are tested.
- *Secrets:* none introduced. `POPULUS_CONTACT` is an operator contact deliberately transmitted per SEC fair access; the R15 heredoc prints only the two headers it sent.
- *Verify, don't assume:* every factual claim is cited to `path:line` re-grepped on `0dfd18d`. The two provider-side facts a read-only phase cannot establish are executable gates with hard failure conditions; the horizon constant is labeled a policy assumption with an escape hatch.

**F1 — Plan-time.**
- *Enumerate all routes/tables/consumers:* six new tables, the authority file, both bootstrap sources, all four resolvers, the migration's referencing tables, both generated licensing artifacts, and the downstream consumers (M2-2, M2-3, M3) named; the last three scoped out.
- *Exact full standing gate set:* `make sync`, `make test`, `make security`, `make check`, plus the two provider gates — all literal commands.
- *Units and NULL state for every served field:* ISO half-open `[valid_from, valid_to)` with `valid_to IS NULL` = open; ownership windows likewise half-open with `None` = unbounded; `class` NULL = source silent; `entity_id` NULL always paired with an explicit `entity_link_state` enforced by CHECK; `EntityRef.name` non-null by type; resolvers return `None`; `id_state` distinguishes durable from provisional; every counter has a declared unit.
- *Config → Settings rename:* not applicable — G6 forbids configurable politeness; the horizon is an in-code constant.
- *Prod writes / explicit auth:* not applicable — writes target a local SQLite file; the two outbound requests in Rollout are read-only operator GETs.
- *Re-baseline against the live tree:* done and recorded in the banner.
- *Simplicity Audit enumerates every new file/component/function:* done, including what was deleted this round.

**F2 — Dev-time.**
- *Full-tree gate scope:* `pytest` runs the whole `tests/` tree; `dep_guard` scans `src/`, `tests/`, `scripts/`.
- *Dynamic SQL with f-string placeholders:* interval rewrites and the migration's `UPDATE`s over the referencing-table constant follow `src/populus/ingest/senate.py:637` — generated `?` placeholders only, values bound, `# nosec B608` with justification; table names come from a module constant, never from input.
- *Every new boundary has a test that fails if the feature is removed:* three interlocks, the `cut_interval` table, the four migration-convergence tests, the transaction assertion, the in-gate latch re-check, the all-or-nothing rollback, the replay accounting, the unit/total check, and the disputed-resolution rule.
- *Shared validators reject degenerate input:* `normalize_cusip`/`normalize_cik` reject rather than coerce; `parse_ftd` raises on a missing column; `load_identity_registry` rejects eleven distinct malformed shapes including non-covering and overlapping windows; every rejection is counted or raised, never swallowed (G3).
- *Bulk SQL for high-cardinality upserts:* ~10k ticker entries use `executemany`; migration updates are set-based.
- *Concurrency:* lock ordering documented and unidirectional; no lock held across a wait or I/O; failed flights removed; the breaker is checked on the fast path and inside the gate.
- *Race conditions in concurrent systems (`feedback_plan_thoroughness.md`):* the single `BEGIN IMMEDIATE` also serializes concurrent bootstrap processes against the same database file, so two runs cannot interleave a migration with a seeding pass.
- *Deploy bridge / worktree build / connection pooler / stale comments / dead CSS:* not applicable.

**F3 — QA-time.**
- *Verify function end-to-end, not liveness:* Rollout produces and counts real rows from real corpora and asserts a real provider status code.
- *Reconcile every doc number vs code + live + tests:* the 936-test figure is reconciled against `STATUS.md` and project memory; no SHA, PR, or branch is invented; `0dfd18d` is the observed `main` head.
- *Run safe read-only diagnostics before destructive operations:* `registry_overlap_errors` is read-only; the migration is a transactional reconciliation with an injected-failure rollback test.
- *ACL / cloud RLS:* not applicable.

**F4 — Handoff.**
- *Propagation sweep:* register entries require regenerating **both** generated documents (guarded by `tests/test_licenses.py:102`); `HTTPX_ALLOWED` and `SECTION_15_2_IDS` are the other parallel occurrences, both explicit tasks.
- *QA FAIL → batch all findings into one remediation:* the standing loop applies; nothing self-signs a gate.

**F5 — Workflow transport.** Mode is `orchestrated-artifact`: this plan is the final response, no plan file is written during planning (T0 commits it during DEV), and every planned path appears in backticks under Planned Files. Any source repair during dev invalidates gate results and requires re-running `make check` plus both provider gates before QA.

## Definition of Done

- [ ] **R1** — `src/populus/registry.sql` exists; `populus db init` creates all registry tables including `security_supersessions`, plus both no-overlap indexes; `ensure_registry` is idempotent on an existing M1 database; `tests/test_schema.py::test_schema_sql_matches_architecture_exactly` still passes unchanged.
- [ ] **R2** — all resolvers are half-open-bounded, unique-row, undisputed, and fail-closed; `EntityRef.name` is non-null; the signature test forbids a date-free identifier→entity path.
- [ ] **R3** — `bootstrap_tickers` seeds entities/names/tickers with the specified provenance/confidence/review_state and open `valid_to`; no network primitive appears in `identity/`.
- [ ] **R4** — `parse_ftd` + `bootstrap_ftd` produce identical rows and identical `security_id` values for the same observation set and authority under every tested partition, order, and incremental arrival; a repeat run is a no-op.
- [ ] **R5** — every rate-floor, coalescing, cache, backoff, breaker, host-guard, and UA test passes with an injected transport and clock; distinct-URL callers are spaced by the client-wide floor; TTL-0 followers receive the leader's result; failing flights propagate the same exception; leaders queued before the breaker opens make zero transport calls and raise; no rate/TTL/threshold configuration is exposed.
- [ ] **R6** — `sec-edgar` and `sec-ftd` are present, valid, and ingestible; `register_version` is `licenses-1.1.0`; `DATA-LICENSE.md` and `NOTICE` regenerate with zero drift; `dep_guard.py` exits 0.
- [ ] **R7** — reconciliation and both seeders run in **one** `BEGIN IMMEDIATE`/`COMMIT`; an injected failure in the FTD pass **after a non-no-op registry revision** leaves `securities`, `security_identifiers`, and `security_supersessions` byte-identical to the pre-run state; the same holds for a failure in the ticker pass; each failed run leaves exactly one `ingest_runs` row with `status='failed'` and non-null `finished_at`, and the CLI exits non-zero with a single-line message.
- [ ] **R8** — the conflicting-title fixture produces `rejected_title_conflict > 0`, writes no name for that CIK, and leaves exactly one applicable name for every other CIK.
- [ ] **R9** — gapped observations produce separate intervals and the gap day resolves to `None`; adjacent observations merge only within one owner window; `test_union_never_spans_an_ownership_boundary` passes; no N-day-merge test exists.
- [ ] **R10** — a declared `security_id` is byte-identical before and after its class gains an identifier **and** after one of its identifiers is split off at a boundary, with the class's remaining identifiers, `class`, and `review_state` intact; provisional ids are identical across two clean rebuilds; observations never change any id or `id_state`; every permutation and the incremental backfill yield identical ids.
- [ ] **R11** — a within-corpus ticker change yields `conflict` with `entity_id IS NULL` and both candidates; a unanimous corpus yields `resolved`; a pre-snapshot observation yields `unresolved`.
- [ ] **R12** — buckets sum to rows read; on identical replay every `Mutations` field is 0 and every `RegistryState` field equals its first-run value, including on a clean first ingest; the declared-split fixture asserts `anchors_in_registry == 1`, `securities_in_registry == 2`, and every security-state partition summing to 2; the pair and link-attempt totals hold.
- [ ] **R13** — `uv run pytest -q` is green over the whole repository with all 936 pre-existing tests passing and no test opening a socket; `dep_guard.py` exits 0; `make check` succeeds.
- [ ] **R14** — `cnsfails-real-excerpt.txt` and `PROVENANCE.md` are committed; the gate test asserts exact row, value, and disposition counts against the real header; Rollout steps 5–6 are executed with the named archive (or the recorded substitution) and their counts recorded.
- [ ] **R15** — the exact emitted UA byte string is pinned in hermetic tests; Rollout step 7 is executed against the shipped client, its printed bytes and observed HTTP 200 are recorded, and the command exited 0.
- [ ] **R16** — `src/populus/securities.yaml` ships, loads, and validates; all eleven malformed shapes raise actionable `IdentityRegistryError`s, including non-covering and overlapping ownership windows named by value; `--securities PATH` reaches reconciliation and the FTD pass.
- [ ] **R17** — `reconcile_identity_registry` raises outside a transaction and never commits; `cut_interval`'s unit table passes with exact reconstruction; the FK-coverage interlock passes; empty→class, class-chain extension, fresh split, and **declared-class→split over a boundary-spanning interval** each applied to a **populated** database converge row-identically with a clean build for `securities` and `security_identifiers`, with `security_supersessions` the only difference; `resolve_cusip` returns the predecessor on one side of the boundary and the successor on the other.
- [ ] **R18** — an undeclared reuse identifier is `disputed` and resolves to `None` in both eras, is counted and listed, and is never dropped; a declared split yields two distinct resolvable ids; a declared continuity restores one resolvable security in both eras.
