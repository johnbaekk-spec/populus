I now have a complete, precise, repository-grounded picture. Key crux findings resolved: (1) `db_path()` returns `None` when the inst module is withheld — the honest-degradation signal; (2) `inst_agg.db` carries **no** identity registry, so `inst_ticker_holders` must resolve ticker→CIK via the federated primary source (`company_tickers.json`), which `identity/bootstrap.py` already parses; (3) `INST_DATA_NOTE` already exists to reuse; (4) `sec-edgar` needs module-scoped attribution surfacing; (5) `populus_health` can stay backward-compatible by listing only present modules, so the 1298 tests hold. Here is the complete build-ready plan.

---

# plan-v1 — RUN M2-4: inst MCP tools + federated per-filer detail + M2 envelope

## Goal and Success Criteria

Deliver the five `inst_*` MCP tools and the M2 response envelope on top of the merged M2-1/2/3 substrate, so an analyst can ask institutional-holdings questions against the published two-module snapshot (aggregates) and live SEC EDGAR (per-filer detail) — without ever fabricating data, crashing when the `inst` module is legitimately absent, or touching the live network in any test.

Success = all of:
- `populus-mcp` exposes exactly five new tools — `inst_filer_lookup`, `inst_filer_holdings`, `inst_ticker_holders`, `inst_biggest_moves`, `inst_health` — plus an `inst`-aware `populus_health`, within the ≤25 global tool budget (§11.2).
- Every inst response carries the non-removable M2 `data_note` (reused `INST_DATA_NOTE`), a `sec-edgar` license notice, and — on records where the grain is filing-level — both `period_of_report` and `filed_date` (G4), values labeled as the manager's stated quarter-end market value with `unit_basis` (G5), holdings labeled quarter-end-not-current (G10). Federated responses are stamped `live_source` instead of `build_id` (§11.3).
- The tools degrade honestly with a clear, truthful reason when the `inst` module is absent from the published snapshot (never crash, never fabricate a withholding reason the consumer cannot verify).
- `uv run pytest -q` is green including a new inst tool suite and a cache-gated inst golden Q&A corpus; the 1298 existing tests stay green; `scripts/dep_guard.py` exits 0 (G1); no test opens a socket.

## Requirements

- **R1** — `inst_filer_lookup(query, limit=25)`: resolve a name fragment or CIK to canonical filer(s) from `agg_filer_registry`; corrective-hint error on empty/no-match; honest degradation when the `inst` module is absent.
- **R2** — `inst_filer_holdings(cik, period=None, mode='snapshot')` **snapshot mode**: the filer's published aggregate profile (registry row + concentration) for a period (or latest) from `inst_agg.db`; validates `cik`; degrades honestly (with a hint to `mode='detail'`) when `inst` is absent.
- **R3** — `inst_filer_holdings(..., mode='qoq')`: the filer's quarter-over-quarter position changes from `agg_qoq_deltas` (`change_kind`, `delta_value_usd`, unit-guarded `delta_shares`); both curr/prev periods; degrades honestly when `inst` is absent.
- **R4** — `inst_filer_holdings(..., mode='detail')` **federated**: the filer's full position list for a period (or latest), fetched live from SEC EDGAR via the `SecClient` and parsed through the reused M2-2 chain; `live_source`-stamped; each record carries both dates, `value_usd`+`unit_basis`, `doc_url`; identity left unresolved+flagged (registry is pipeline-side, G14-safe); works regardless of `inst` module presence; SEC failure/circuit-breaker → honest error, never a crash.
- **R5** — `inst_ticker_holders(ticker, period=None, limit=50)`: resolve the ticker to an issuer CIK via the federated, cached `company_tickers.json`, derive `issuer_key='entity:cik:<cik>'`, and read `agg_issuer_top_holders` ranked by value; the present-day nature of the ticker→issuer mapping is explicitly labeled (G14, not silent); unresolved ticker or issuer-absent-from-aggregate → honest hint (surface by issuer name); corrective hint on malformed ticker.
- **R6** — `inst_biggest_moves(period=None, side='new', limit=50)`: the largest cross-filer QoQ changes from `agg_qoq_deltas` filtered by `side ∈ {new,add,trim,exit}`, ranked by `abs(delta_value_usd)`; validates `side`/`limit`; degrades honestly when `inst` is absent.
- **R7** — `inst_health()`: report the `inst` module's presence, snapshot build, freshness (latest `period_of_report` + latest `filed_date`), filer/position counts, issuer-keying breakdown, and standing caveats — all from published data only; when absent, `present:false` with a truthful reason; never fabricate the exact gate coverage % or a per-filing unit-regime mix the published aggregate does not carry.
- **R8** — Envelope (`envelope.py`): reuse `INST_DATA_NOTE` as the non-removable M2 `data_note`; add a `live_source` alternative to `build_id` (§11.3); add `shape_holding` (both dates, `value_usd`+`unit_basis` label, `doc_url`) — all backward-compatible so congress callers are unaffected.
- **R9** — `license_notices` carries `sec-edgar` on every inst response via module-scoped surfacing of the register attribution (the `sec-edgar` entry's `required_notices` is empty, so the existing global helper would omit it); the congress path is unchanged.
- **R10** — `populus_health` reports the `inst` module alongside `congress` (present/absent, snapshot build, freshness, caveats), listing only present modules in the existing `modules` field so the M1 assertion holds, degrading honestly when `inst` is absent.
- **R11** — Server wiring (`server.py`): resolve an `inst` `SnapshotClient(module="inst")` (tolerating an absent module → `db_path()` is `None`) and an injectable `SecClient` in `_resolve_snapshot`/`build_server`; add a `--inst-db` dev bypass mirroring `--db`; keep the total registered tool count ≤25.
- **R12** — Always-run inst tool test suite (committed fixtures): every tool's snapshot/qoq/detail path, the inst-absent degradation, envelope honesty (data_note, both dates, unit_basis, `sec-edgar`, `live_source`), ticker resolution via an injected `company_tickers.json`, and the federated detail path via an injected `_FakeSecTransport` — no live network.
- **R13** — Cache-gated inst golden Q&A corpus mirroring M1's gated golden: analyst questions ("What did Berkshire hold at 2026-Q1?", "Who are the biggest holders of X?", "Biggest new positions last quarter?", "Is this current?" → asserts the quarter-end/lag caveat surfaces) with expected-shape assertions, skipped when the local cache is absent.
- **R14** — No regressions: the 1298 existing tests stay green under `uv run pytest -q`; `scripts/dep_guard.py` clean (G1); no test opens a socket (the autouse guard holds); the congress envelope and its tests are untouched.

## Scope

One coherent slice — the MCP-server layer for the institutional (M2) module. Owns:
- New `src/populus/mcp_server/inst_queries.py` (snapshot reads over `inst_agg.db`; federated reads via `SecClient` for detail + ticker resolution; aggregate-row shapers).
- Edits to `src/populus/mcp_server/server.py` (register 5 tools; resolve inst snapshot + SEC client; extend `populus_health`; `--inst-db`).
- Edits to `src/populus/mcp_server/envelope.py` (M2 `data_note` reuse, `live_source`, `shape_holding`, module-scoped `sec-edgar` notices).
- One minimal additive read-only accessor on `src/populus/client/snapshot.py` (current manifest → inst watermarks for freshness).
- New `tests/test_mcp_server_inst.py` (inst tool suite + cache-gated golden) and a small committed ticker fixture.

Reuses (does not fork): the M1 FastMCP substrate, the M2-2 fetch/parse/normalize chain, the M2-3 aggregate DB, the module-aware `SnapshotClient`, and the identity/licenses helpers.

## Non-goals

- No changes to the M2-3 aggregate schema/build (`inst_agg.py`, `inst_agg.sql`), the manifest/publish path, or the ingest/parse modules (beyond calling their public functions). Publishing a dated ticker→issuer lookup inside the aggregate is a **follow-up**, not this run (would require an aggregate-schema revision — out of the owned scope and against G12/one-module discipline).
- No dashboard `/institutional` surfaces (declared P3 in M2-CONTRACT §7).
- No monitor/`populus_health` cross-build alerting beyond reporting the inst module.
- No new always-on infrastructure; no hosted HTTP transport (§11.6).
- No live-network fetches in any test; no persistence of federated fetches to a DB.

## Constraints

- ARCHITECTURE governs: §11.2 budget (≤25 tools), §11.3 envelope (`{as_of, build_id | live_source, data_note, license_notices[], results[]}`), §11.4 conservative federated client, §10.2 candidate tools + caveat, §5.6 snapshot-aggregates + F-detail, §5.4 as-of identity.
- Guardrails: **G4** both dates on filing-level records; **G5** ranges/units labeled (era-dependent `unit_basis`); **G7** no hidden load paths (federated calls only through the sanctioned `SecClient`); **G10** flows/snapshots ≠ holdings (quarter-end-not-current label); **G14** no identity time-travel (any present-day ticker mapping is labeled, never silent); **G1** dep-guard clean; **G3** never drop/guess (unmapped → name+flag).
- Injectable transport everywhere; `SecClient` requires a positional transport (no default) so a test can never reach the network (`sec_client.py:271`); the autouse socket block in `tests/conftest.py:14` stays in force.
- Read-only server; parameterized SQL only; the `inst` module may legitimately be **absent** and every tool must survive that.
- Backward compatibility: `build_server`/`envelope`/`populus_health` changes must not alter observed congress behavior, or the 1298 tests break.

## Current State

- **MCP server** (`src/populus/mcp_server/server.py`) is congress-only: 8 `@mcp.tool()` closures inside `build_server(*, db_path, build_id, now)` (`server.py:59`), one read-only connection `q.connect(db_path)` (`server.py:64`), corrective-hint errors returned as `results={"error": ...}`. `populus_health` hardcodes `results={"modules": ["congress"], ...}` (`server.py:240-246`). `_resolve_snapshot` builds one congress `SnapshotClient` (`server.py:264`) and supports a `--db` dev bypass.
- **Envelope** (`envelope.py`): `envelope(*, build_id, as_of, results, next_cursor=None, extra_note=None)` hardcodes the congress `DATA_NOTE` (`envelope.py:18`) and global `license_notices()` (`envelope.py:32`); only `shape_transaction` exists; **no** `live_source`, **no** `shape_holding`, **no** M2 note.
- **Snapshot client** (`client/snapshot.py`): `SnapshotClient(..., module="inst")` isolates a per-module cache; `db_path()` (`snapshot.py:304`) resolves `module_db_artifact("inst") → "inst_agg.db"` and returns `None` when the module is not current — the exact absent-module signal. No public manifest accessor.
- **Aggregate DB** (`inst_agg.sql`, built by `inst_agg.build_inst_agg`): four tables — `agg_filer_registry` (cik, filer_name, latest_period, position_count, total_value_usd, null/unkeyed), `agg_qoq_deltas` (cik, position_key, put_call, curr/prev_period, change_kind, delta_value_usd, delta_shares, ssh_prnamt_type, flags), `agg_issuer_top_holders` (issuer_key ∈ `entity:<id>|cusip6:<6>|name:<norm>`, period_of_report, rank, cik, filer_name, issuer_name, issuer_key_source, value_usd, security_count), `agg_filer_concentration` (cik, period, topn_share_bps, hhi, flags) — plus `agg_build_meta`. It carries **no** identity registry, **no** ticker, **no** per-filing `unit_basis`, **no** per-row `filed_date`.
- **Federated substrate**: `SecClient.get(url)` is the only fetch primitive (`sec_client.py:302`); the per-filing chain is `discover(source, cik10, cache_bounded=False)` + `evaluate_filing(entry, source, resolve_security=..., ingested_at=...)` (`ingest/inst13f.py:284,367`), returning a `FilingOutcome` with parsed `holdings` and `filing` metadata (period, filed_date, unit_basis, doc_url). `INST_DATA_NOTE` is a module constant in `normalize_inst.py:41`.
- **Identity/licenses**: `identity/registry.py` exposes as-of resolvers (`resolve_ticker_as_of`, `resolve_cusip`) but **only against a populated registry DB, which is not a published inst artifact**; `entity_id_for(cik)` is deterministically `cik:<10-digit>` (`registry.py:184`). `identity/bootstrap.py:353 load_company_tickers(path)` + `normalize_cik`/`normalize_ticker` parse the ticker→CIK primary source; a fixture lives at `data-cache/inst/registry/company_tickers.json` (`cli.py:421`). `licenses.required_notices()` (`licenses.py:94`) emits only non-empty required-notice entries; `sec-edgar` (`licenses.json:48`) has empty `required_notices` but a populated `attribution`.
- **Tests**: `tests/test_mcp_server.py` builds a per-test tmp DB + `build_server(...)` and invokes tools via `server._tool_manager.get_tool(name).fn(**kwargs)` (`test_mcp_server.py:100-105`); `_assert_envelope` checks the shared shape; the M1 golden is cache-gated on `data-cache/house` (`test_mcp_server.py:311`). Inst fixtures + `_FakeSecTransport` + `run_inst13f_ingest(..., cache_dir=...)` patterns exist in `tests/test_inst_ingest.py`. Runner is `uv run pytest -q` (`Makefile:22`).

## Detected Stack

Python 3.12, `uv` + hatchling, SQLite/JSON1, Click, `httpx`, `lxml`, `pytest` + `jsonschema`, official MCP SDK `FastMCP` (`mcp>=1.28.1`). Canonical gates: `uv run pytest -q` and `scripts/dep_guard.py` (via `make check` = `make test` + `make security`). No new dependencies are introduced (G1/G8).

## Reuse Map

- `mcp_server/envelope.py::envelope` / `shape_transaction` — **extend** (backward-compatible params) rather than a parallel envelope; one wrapping API for both modules.
- `normalize_inst.INST_DATA_NOTE` (`normalize_inst.py:41`) — **reuse verbatim** as the M2 `data_note`; do not author a second caveat string (single source of truth, G10).
- `ingest/inst13f.discover` + `evaluate_filing` + the `parse_*`/`normalize_holding` chain — **reuse** for the federated detail path; inst_queries.py supplies only a thin duck-typed SEC source (no disk persistence) and calls these public functions, so the parse/normalize/reconcile logic is not forked.
- `net/sec_client.SecClient` (`sec_client.py:263`) + `HttpxSecTransport` — **reuse** as the sole federated transport (politeness/UA/backoff/breaker in code, G6/§11.4).
- `client/snapshot.SnapshotClient(module="inst")` + `db_path()` — **reuse** for the inst snapshot; add one minimal additive read-only `current_manifest()` accessor for freshness watermarks (no change to existing methods).
- `identity/bootstrap.load_company_tickers` + `identity/registry.normalize_cik`/`normalize_ticker`/`entity_id_for` — **reuse** for ticker→CIK→`issuer_key` resolution in `inst_ticker_holders`.
- `licenses.load_register` (`licenses.py:39`) — **reuse**; add a small module-scoped `license_notices_for(license_ids)` in envelope.py that surfaces the register **attribution** for `sec-edgar` (the existing global `license_notices()` cannot, since `required_notices` is empty).
- `tests/test_inst_ingest.py::_FakeSecTransport` + `run_inst13f_ingest(cache_dir=...)` + `tests/fixtures/inst/real|crafted` — **reuse** to seed aggregates and drive the federated path hermetically.
- `mcp_server/queries.connect` (read-only `mode=ro` uri) — **reuse** for the inst connection.

## Architecture

Two data planes, cleanly separated and honest about which they used:

1. **Snapshot plane** (published aggregates). `_resolve_snapshot` builds a second `SnapshotClient(module="inst")`, `refresh()`es it (tolerating a "refused: manifest has no module 'inst'" outcome), and yields `inst_db_path` (`Path` or `None`) + `inst_build_id` + `inst_watermarks` (from the new `current_manifest()` accessor). `build_server` opens a read-only inst connection when the path exists. `inst_filer_lookup`, `inst_filer_holdings(snapshot|qoq)`, `inst_biggest_moves`, `inst_health` read this plane and stamp `build_id`. When `inst_db_path is None`, each returns an honest `results={"error"|"unavailable": "...the institutional module is not present in the current published snapshot..."}` — a truthful statement (the consumer cannot see the pipeline-side withholding reason, so it never asserts one).

2. **Federated plane** (live SEC, Pattern-F, §11.4). An injectable `SecClient` is threaded into `build_server`. Two tools use it:
   - `inst_filer_holdings(mode='detail')` fetches submissions→index→cover+infotable through a thin duck-typed source over `sec_client.get`, calls the reused `discover`/`evaluate_filing` (with a no-op `resolve_security` → identity left unresolved+flagged, G14-safe), shapes `outcome.holdings` via `shape_holding`, and stamps `live_source` (source=`sec-edgar-live`, `doc_url`, `retrieved_at`). Never persisted.
   - `inst_ticker_holders` fetches the cached `company_tickers.json` (bootstrap TTL) through the same `SecClient`, parses ticker→CIK, computes `issuer_key='entity:'+entity_id_for(cik)`, then reads `agg_issuer_top_holders` from the snapshot plane. Result data is snapshot (`build_id`); the response carries an explicit present-day-mapping note. The federated plane is available even when the snapshot inst module is withheld — so per-filer detail never disappears.

Envelope changes are additive: `envelope(...)` gains optional `live_source`, `data_note`, and `license_notices_list` params (defaults preserve the congress contract). Inst tools pass `data_note=INST_DATA_NOTE` and `license_notices_list=license_notices_for(["sec-edgar"])`. `shape_holding` mirrors `shape_transaction` (both dates, `doc_url`, value-with-unit label, never a synthesized point value). `populus_health` lists only present modules in `modules` and adds an additive per-module detail block.

## Locked Decisions

- **LD1 — `inst_filer_holdings` mode enum is `{'snapshot','qoq','detail'}`.** The contract's `mode='snapshot'|'qoq'` names the two snapshot modes; the brief also requires this tool to serve the federated live-EDGAR detail path, so `'detail'` is added as the third, explicitly-live mode (docstring states it fetches live from SEC). Rationale: a single discoverable tool, matching §5.6's "MCP: snapshot for aggregates + F for arbitrary per-filer detail."
- **LD2 — `inst_ticker_holders` resolves the ticker via the federated, cached primary source (`company_tickers.json`), not a published registry.** The identity registry is pipeline-side and not a published inst artifact; `issuer_key` is deterministically `entity:cik:<cik>`. The ticker→issuer mapping is present-day and is **labeled** in the envelope (G14: not silent); issuer identity is by stable CIK, so a ticker *change* still resolves correctly, and only a rare ticker *reassignment* is the labeled caveat. Unresolved/absent → honest hint.
- **LD3 — Absent-inst degradation states only what the consumer can verify.** Tools report "the institutional module is not present in the current published snapshot" and never assert the pipeline-side withholding reason (`withheld`/`absent`), which is operational state not published (per M2-3 QA-F5). Federated `mode='detail'` remains available.
- **LD4 — `inst_health`/`populus_health` report only published facts.** Freshness (latest period + latest filed date via the manifest watermark accessor), filer/position counts, and issuer-keying breakdown are reported; the exact ≥95% coverage figure and per-filing unit-regime mix are **not** in the published aggregate and are surfaced as "guaranteed by the publish gate; exact figures are pipeline-side / available on federated detail," never fabricated.
- **LD5 — Federated detail leaves security identity unresolved.** `resolve_security` is a no-op in the MCP federated path (no registry at query time); holdings carry raw CUSIP + issuer name + a clarifying note (G3/G14), never a guessed `security_id`.
- **LD6 — New test file, no M1 test edits.** The suite lives in `tests/test_mcp_server_inst.py`; `populus_health` stays backward-compatible (present-modules list) so `test_mcp_server.py` is untouched.

No unresolved owner decisions remain.

## Alternatives Considered

- **Publish a dated ticker→issuer / registry lookup inside `inst_agg.db`** so `inst_ticker_holders` needs no federated call and can do true as-of ticker resolution. Rejected for this run: requires an M2-3 aggregate-schema + manifest change (out of owned scope; G12). Recorded as a follow-up (TD-M2-4-1) — it is the clean long-term home for as-of ticker resolution.
- **Auto-fallback snapshot→federated when `inst` is absent.** Rejected: a snapshot tool silently issuing network calls is a surprising hidden load path; instead we degrade honestly and *offer* `mode='detail'` explicitly.
- **A separate `inst_envelope()` wrapper.** Rejected in favor of extending `envelope()` with optional params — one wrapping API, less duplication (Simplicity Audit).
- **Reuse the private `_LiveSource` for federated detail.** Rejected: it persists bytes to disk and is underscore-private; a small duck-typed non-persisting source calling the public `discover`/`evaluate_filing` is cleaner and keeps the change inside the owned `inst_queries.py`.
- **Add a `RESTATEMENT`/amendment merge pass in the federated detail path.** Rejected: the single-filing detail fetch returns the requested/latest filing as-filed with its flags; cross-filing lineage is a pipeline/aggregate concern (kept out of the F path).

## Planned Files

- `src/populus/mcp_server/inst_queries.py` — **new.** `connect` reuse; snapshot query fns (`filer_lookup`, `filer_snapshot`, `filer_qoq`, `issuer_top_holders`, `biggest_moves`, `filer_registry_stats`); federated fns (`fetch_filer_detail(sec_client, cik, period)`, `resolve_ticker_to_issuer_key(sec_client, ticker)`); a thin `_FederatedSource`; aggregate-row shapers (`shape_qoq_row`, `shape_top_holder`, `shape_filer`, `shape_concentration`).
- `src/populus/mcp_server/server.py` — **edit.** Import `inst_queries`; add optional `inst_db_path`, `inst_build_id`, `inst_watermarks`, `sec_client` params to `build_server`; register the five `@mcp.tool()` inst closures; extend `populus_health`; resolve the inst client + `SecClient` + `--inst-db` in `_resolve_snapshot`/`main`.
- `src/populus/mcp_server/envelope.py` — **edit.** Optional `live_source`/`data_note`/`license_notices_list` on `envelope`; `INST_DATA_NOTE` reuse; `shape_holding`; `license_notices_for(license_ids)`.
- `src/populus/client/snapshot.py` — **edit (minimal, additive).** `current_manifest() -> dict | None` (read the cached `<module>/<build_id>/manifest.json`); no change to existing methods.
- `tests/test_mcp_server_inst.py` — **new.** Always-run inst tool suite + cache-gated golden Q&A.
- `tests/fixtures/inst/mcp/company_tickers.json` — **new (small committed fixture)** for the always-run ticker-resolution tests (or reuse `data-cache/inst/registry/company_tickers.json` for the cache-gated golden).

## Implementation Tasks

1. **R8 envelope core.** In `envelope.py`, extend `envelope(...)` with optional `live_source=None`, `data_note=DATA_NOTE`, `license_notices_list=None` (defaults preserve congress behavior); emit `live_source` **xor** `build_id`. Add `shape_holding(h, *, period_of_report, filed_date, doc_url)` mirroring `shape_transaction` (both dates G4, `value_usd`+`unit_basis`+value label G5, `doc_url`, flags). Import `INST_DATA_NOTE` from `normalize_inst`.
2. **R9 license surfacing.** Add `license_notices_for(license_ids)` surfacing each id's register `attribution` + any `required_notices`; inst tools call it with `["sec-edgar"]`. Leave the global `license_notices()` untouched (congress unchanged, R14).
3. **R11 + R7 snapshot accessor.** Add `SnapshotClient.current_manifest()` (read-only). In `server.py` `_resolve_snapshot`, build `SnapshotClient(module="inst")`, `refresh()` tolerating an absent module, and return `(inst_db_path|None, inst_build_id, inst_watermarks)`; add `--inst-db`. Construct a real `SecClient(HttpxSecTransport(), contact=sec_contact()[0], ...)` in `main()`. Thread all into `build_server`.
4. **R1 filer lookup.** `inst_queries.filer_lookup(conn, query, limit)` — CIK-exact (via `normalize_cik`) or `filer_name LIKE`, ordered by `total_value_usd`. Tool closure: clamp `limit`, corrective hint on empty query, honest `unavailable` when `inst` absent.
5. **R2 snapshot mode.** `inst_queries.filer_snapshot(conn, cik, period)` — registry row + concentration row for the (cik, period|latest). Tool: validate `cik`, resolve default period to registry `latest_period`, stamp `build_id`, `data_note=INST_DATA_NOTE`, sec-edgar notices; degrade with a `mode='detail'` hint when absent.
6. **R3 qoq mode.** `inst_queries.filer_qoq(conn, cik, period)` — `agg_qoq_deltas` rows for the filer's (curr) period; shape via `shape_qoq_row` (change_kind, delta_value_usd, unit-guarded delta_shares + flags, both periods). Same envelope discipline; degrade honestly.
7. **R4 federated detail.** In `inst_queries.py` add `_FederatedSource` (duck-typed `submissions/index/cover/table` over `sec_client.get`, no disk writes) and `fetch_filer_detail(sec_client, cik, period)` calling reused `discover`/`evaluate_filing` with `resolve_security=lambda *_: None` (LD5). Tool: `mode='detail'` shapes holdings via `shape_holding`, stamps `live_source`; catch `SecCircuitOpenError`/`SecUrlError`/fetch errors → corrective-hint error; works with `inst` absent.
8. **R5 ticker holders.** `resolve_ticker_to_issuer_key(sec_client, ticker)` — fetch cached `company_tickers.json`, parse via reused loader/`normalize_ticker`/`normalize_cik`, compute `issuer_key='entity:'+entity_id_for(cik)`. `inst_queries.issuer_top_holders(conn, issuer_key, period)` reads `agg_issuer_top_holders`. Tool: present-day-mapping note (G14), rank by value, honest hint when unresolved / issuer absent / `inst` absent; corrective hint on malformed ticker.
9. **R6 biggest moves.** `inst_queries.biggest_moves(conn, period, side, limit)` — filter `agg_qoq_deltas` by `change_kind=side` and `curr_period=period|latest`, order by `abs(delta_value_usd)` desc (parameterized; `# nosec` only if a validated `IN`-list is needed). Tool: validate `side`/`limit`, degrade honestly.
10. **R7 inst_health.** `inst_queries.filer_registry_stats(conn)` + issuer-keying counts; combine with `inst_watermarks` for freshness (both dates, G4). Report `present`, `snapshot_build`, freshness, counts, keying breakdown, and the gate-guarantee/pipeline-side caveats (LD4). `present:false` + truthful reason when absent.
11. **R10 populus_health.** Extend the closure so `modules` lists only present modules (congress always; inst when `inst_db_path`); add an additive per-module detail block (build, freshness, caveat). Preserve existing keys/shape (R14, LD6).
12. **R11 budget check.** Confirm 13 registered tools ≤ 25; wire the five closures; ensure `--db`-only mode leaves inst snapshot tools degrading honestly while `mode='detail'` still works.
13. **R12 always-run suite.** `tests/test_mcp_server_inst.py`: build a deterministic inst_agg.db from committed `tests/fixtures/inst` (ingest via `run_inst13f_ingest(cache_dir=...)` → `build_inst_agg`), plus a resolved-identity mini-corpus for ticker/issuer rows; `_FakeSecTransport` for detail + a committed `company_tickers.json` for ticker; assert every tool path, absent-module degradation, and envelope honesty (data_note, both dates, `unit_basis`, `sec-edgar`, `live_source`). Each assertion fails if its feature is removed (behavioral validity).
14. **R13 cache-gated golden.** Add `@pytest.mark.skipif(not (data-cache/inst path).exists())` golden Q&A with expected-shape assertions incl. an "Is this current?" check asserting the quarter-end caveat is in `data_note`.
15. **R14 regression gate.** Run `uv run pytest -q` (full tree) and `scripts/dep_guard.py` synchronously; confirm 1298 prior tests green, congress envelope/tests untouched, no socket use.

## Testing Strategy

- **Framework/harness:** mirror `test_mcp_server.py` — `build_server(db_path=..., build_id=..., inst_db_path=..., inst_build_id=..., inst_watermarks=..., sec_client=..., now=_fixed)`, invoke via `server._tool_manager.get_tool(name).fn(**kwargs)`, assert with an `_assert_inst_envelope` helper (checks `data_note==INST_DATA_NOTE` substring, a `sec-edgar` license notice, and `build_id` **or** `live_source`).
- **Seeding:** ingest `tests/fixtures/inst/real|crafted` via `run_inst13f_ingest(cache_dir=...)` into a tmp source DB, then `build_inst_agg(...)` → a tmp `inst_agg.db`; for ticker/issuer coverage, seed a small resolved-identity corpus (entity + `entity:cik:<cik>` issuer rows) so `inst_ticker_holders` has a deterministic hit.
- **Federated (no network):** inject `_FakeSecTransport` (serving committed Berkshire fixture bytes) into a real `SecClient(sleep=lambda _:None, monotonic=<counter>)`; assert `mode='detail'` returns real holdings, `live_source`, both dates, `value_usd`+`unit_basis`, `doc_url`. Serve a committed `company_tickers.json` for `inst_ticker_holders`; assert the present-day-mapping note and ranked holders. Assert a `SecCircuitOpenError`/404 path returns an honest error envelope, not a raise.
- **Absent-module:** build the server with `inst_db_path=None`; assert every snapshot tool returns an honest `unavailable`/`error` (never raises), `populus_health.modules == ["congress"]`, `inst_health.present is False`, and `mode='detail'` still works.
- **Envelope honesty:** assert non-removability (present on every inst response), G4 both dates on detail records, G5 `unit_basis` label, G10 quarter-end caveat text, G9-style separation (no congressional §13107 notice on inst responses).
- **Cache-gated golden (R13):** expected-shape invariants against the local cached corpus, skipped when absent — mirroring `test_mcp_server.py:311`.
- **Regression:** `uv run pytest -q` full tree + `scripts/dep_guard.py`, run synchronously.

## Verification Matrix

| Req | Verification |
|---|---|
| **R1** | `test_inst_filer_lookup_by_name_and_cik`, `test_inst_filer_lookup_empty_query_hint`, `test_inst_filer_lookup_absent_module` |
| **R2** | `test_inst_holdings_snapshot_profile`, `test_inst_holdings_snapshot_bad_cik`, `test_inst_holdings_snapshot_absent_hints_detail` |
| **R3** | `test_inst_holdings_qoq_deltas_shape`, `test_inst_holdings_qoq_unit_guarded_delta_shares` |
| **R4** | `test_inst_holdings_detail_federated_live_source`, `test_inst_holdings_detail_both_dates_and_unit_basis`, `test_inst_holdings_detail_circuit_open_honest_error`, `test_inst_holdings_detail_works_when_module_absent` |
| **R5** | `test_inst_ticker_holders_resolves_and_ranks`, `test_inst_ticker_holders_present_day_mapping_note`, `test_inst_ticker_holders_unresolved_hint`, `test_inst_ticker_holders_bad_ticker_hint` |
| **R6** | `test_inst_biggest_moves_by_side_ranked`, `test_inst_biggest_moves_bad_side_hint`, `test_inst_biggest_moves_absent_module` |
| **R7** | `test_inst_health_present_freshness_both_dates`, `test_inst_health_absent_present_false`, `test_inst_health_no_fabricated_coverage_or_unit_mix` |
| **R8** | `test_envelope_live_source_xor_build_id`, `test_shape_holding_fields`, `test_congress_envelope_unchanged` (backward-compat) |
| **R9** | `test_inst_response_carries_sec_edgar_notice`, `test_inst_response_omits_congress_statutory_notice` |
| **R10** | `test_populus_health_lists_inst_when_present`, `test_populus_health_modules_congress_only_when_absent` |
| **R11** | `test_build_server_threads_inst_and_secclient`, `test_tool_budget_within_25`, `--inst-db` resolution test |
| **R12** | The always-run `tests/test_mcp_server_inst.py` suite passes hermetically (autouse socket guard proves no network) |
| **R13** | `test_inst_golden_questions_against_real_corpus` runs under the cache gate and skips cleanly without it |
| **R14** | `uv run pytest -q` → 1298 prior + new tests green; `scripts/dep_guard.py` exit 0; `git`-diff shows congress envelope/tests untouched |

## Rollout / Rollback

- Additive feature on a feature branch; no migrations, no published-data changes, no infra. `main()` constructs the real `SecClient`; if `POPULUS_CONTACT` is unset the existing `sec_contact` warning applies (§11.4). Manual smoke (optional, operator-run, not CI): `populus-mcp --db <ingested.db> --inst-db <inst_agg.db>` (or the published two-module snapshot) → `inst_filer_holdings(cik="1067983", mode='detail')` returns real Berkshire holdings with an honest envelope.
- **Rollback:** revert the branch — the five tools and envelope params vanish; congress tooling is unaffected because every change is additive/backward-compatible. No state to unwind (read-only, no writes, nothing persisted).
- **Forward guard:** the ≤25 budget and the socket guard are asserted by tests, so a regression fails CI rather than shipping.

## Simplicity Audit

Minimum coherent design: one new module (`inst_queries.py`), edits to the three brief-owned files, one additive `SnapshotClient` accessor, one new test file. New functions, each load-bearing: `filer_lookup`, `filer_snapshot`, `filer_qoq`, `issuer_top_holders`, `biggest_moves`, `filer_registry_stats`, `fetch_filer_detail`, `resolve_ticker_to_issuer_key`, `_FederatedSource`, four aggregate shapers; envelope: `shape_holding`, `license_notices_for`, extended `envelope`; snapshot: `current_manifest`; server: five tool closures + resolution edits. Rejected abstractions: a separate inst-envelope class (extended the existing one instead); a generic multi-module tool registry (five explicit closures are clearer and match the congress pattern); reusing private `_LiveSource` (a thin public-function caller is simpler and non-persisting); a query-time identity-registry copy (federated primary-source resolution + honest labeling is smaller than shipping a registry). No speculative parameters; the federated source implements exactly the four methods `discover`/`evaluate_filing` call.

## Tech Debt Introduced

- **TD-M2-4-1 (bounded).** `inst_ticker_holders` uses the present-day `company_tickers.json` mapping (labeled, G14-honest) rather than a published as-of ticker→issuer registry. *Owner:* John Baek. *Impact:* a rare ticker *reassignment* to a different issuer would mislabel which issuer the user meant (mitigated: labeled, and issuer identity is by stable CIK so ticker *changes* resolve correctly). *Removal condition:* publish a dated ticker→issuer lookup inside the inst aggregate (an M2-aggregate revision) and resolve as-of.
- **TD-M2-4-2 (bounded).** `inst_health`/`populus_health` cannot report the exact ≥95% coverage figure or per-filing unit-regime mix (the published aggregate omits both); they report the gate guarantee + published proxies and point to federated detail. *Removal condition:* add a coverage/unit-mix summary row to `agg_build_meta` or the manifest in a future aggregate revision.
- Otherwise **None** — no hidden debt; federated detail leaving identity unresolved is intentional honesty (LD5), not debt.

## Memory Touch-Points

- `populus-project.md` (project) — the congress→13F→financials module arc and the standalone-from-Compass constraint; confirms M2-4 is the MCP layer of the already-planned 13F module. *Effect:* scope kept to the MCP slice; G9 (no Compass coupling) respected.
- `john-baek-profile.md` (user) — verified-primary-source, institutional-grade, decision-record bar. *Effect:* federated resolution uses the SEC primary source; every honesty limitation (present-day ticker mapping, absent-module reason, unreported coverage%) is labeled rather than papered over; decisions are locked with rationale.
- Failure-mode catalog (mandatory) — see Failure-Mode Sweep. No new memory is required by this run; if the present-day-ticker labeling pattern recurs in M3/M4 it would graduate to a memory then.

## Failure-Mode Sweep

- **[[plan-api-route-enumeration]] / F0 full-set sweep — applicable.** All five tools + `populus_health` enumerated; every tool has a snapshot-present, absent-module, and (where relevant) federated path with a test.
- **[[verify-data-source-not-schema]] / F0 verify-not-assume — applicable.** Confirmed from the DDL that `inst_agg.db` carries no ticker/registry/`unit_basis`/per-row `filed_date`; the plan is built on what is actually published, not assumed.
- **[[gate-list-completeness]] / F1 — applicable.** Full standing gate set named: `uv run pytest -q` and `scripts/dep_guard.py` (via `make check`), run synchronously.
- **[[rs_rank_pct_fraction_contract]] / [[awaiting_baseline_rows_null_guard]] / F1 units+NULL — applicable.** `value_usd` is USD (era-normalized via `unit_basis`); NULL is kept distinct from 0 (`concentration_unavailable`, `delta_shares` NULL under `shares_unit_mismatch`); labels are explicit (G5).
- **[[rebaseline-plan-when-code-lands]] / F1 — applicable.** Baselined against merged M2-1/2/3 (module-aware `db_path`, `INST_DATA_NOTE`, `sec-edgar` register entry, aggregate DDL) as they exist on `main`.
- **[[simplicity-audit-must-be-complete]] / F1 — applicable.** Every new file/function enumerated in Simplicity Audit.
- **[[full-tree-gate-scope]] / F2 — applicable.** Gate runs the whole `tests/` tree, not just the new file; congress backward-compat asserted.
- **[[behavioral-test-validity]] / F2 — applicable.** Each boundary test fails if its feature is removed (e.g. drop the `live_source` stamp, the `sec-edgar` notice, or the absent-module guard → the corresponding test fails).
- **[[shared-validator-rejection-required]] / F2 — applicable.** The extended `envelope()` and `populus_health` are exercised by both a congress backward-compat test and inst tests; corrective-hint errors reject bad `cik`/`ticker`/`side`.
- **[[bandit_b608_sql_in_clause_nosec]] / F2 — applicable if dynamic SQL used.** `biggest_moves`/mode switches use parameterized queries; any `IN`-list gets bound values + `# nosec` with a justification (matches the `inst_agg.py:1335` precedent).
- **F5 workflow transport / no live network — applicable.** Injected transport only; the autouse socket guard in `tests/conftest.py:14` remains; a test asserts no socket path is reachable.
- **[[no-print-secrets]] / F0 — applicable (benign).** The SEC UA carries a public contact email by design (fair-access identifiability), not a secret; no tokens/keys are emitted.
- **Non-applicable:** [[prod-write-explicit-auth]]/[[full-write-scope-disclosure]] (read-only server, no writes), [[rls-cloud-simulation-in-tests]]/[[acl-assertion-patterns]] (no ACL/RLS), [[deploy-bridge-executable]]/[[build-in-worktree-not-live-dir]] (no deploy in this run), [[config-rename-preserve-invariant]] (no config rename), [[connection-pooler-read-only]] (SQLite `mode=ro`, no pooler).

## Definition of Done

- **R1** — `inst_filer_lookup` resolves name/CIK from `agg_filer_registry`, hints on empty/no-match, and degrades honestly when `inst` is absent; verified by its three tests.
- **R2** — `inst_filer_holdings(mode='snapshot')` returns the filer's aggregate profile with the M2 envelope and degrades with a `mode='detail'` hint; bad `cik` hinted; verified.
- **R3** — `inst_filer_holdings(mode='qoq')` returns unit-guarded QoQ deltas with both periods; verified.
- **R4** — `inst_filer_holdings(mode='detail')` returns live-fetched holdings via the injected `SecClient`, `live_source`-stamped, with both dates + `unit_basis` + `doc_url`, works when `inst` is absent, and errors honestly on SEC failure; verified with no live network.
- **R5** — `inst_ticker_holders` resolves the ticker via federated `company_tickers.json`, ranks holders, labels the present-day mapping (G14), and hints when unresolved/absent; verified.
- **R6** — `inst_biggest_moves` returns side-filtered, value-ranked cross-filer moves, validates inputs, and degrades honestly; verified.
- **R7** — `inst_health` reports presence, freshness (both dates), counts, keying breakdown, and gate/pipeline caveats without fabricating coverage%/unit-mix; verified present and absent.
- **R8** — `envelope()` supports `live_source` xor `build_id`, reuses `INST_DATA_NOTE`, and `shape_holding` carries both dates + unit label; congress envelope behavior is unchanged; verified.
- **R9** — every inst response carries a `sec-edgar` license notice and omits the congressional statutory notice; verified.
- **R10** — `populus_health` reports `inst` when present and lists `["congress"]` only when absent (M1 assertion holds); verified.
- **R11** — `build_server`/`_resolve_snapshot` thread the inst snapshot client, `SecClient`, watermarks, and `--inst-db`; the total tool count is ≤25; verified.
- **R12** — the always-run inst suite passes hermetically (socket guard intact).
- **R13** — the cache-gated golden Q&A (incl. the "Is this current?" caveat check) runs under the gate and skips cleanly without the cache.
- **R14** — `uv run pytest -q` green (1298 prior + new), `scripts/dep_guard.py` exit 0, congress envelope/tests untouched, no socket opened in any test.
