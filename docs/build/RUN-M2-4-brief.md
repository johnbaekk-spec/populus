# RUN M2-4 — inst MCP tools + federated per-filer detail + envelope

**Source of truth:** `ARCHITECTURE.md` §11.2 (tool surface budget), §11.3 (envelope conventions),
§11.4 (federated client), §10.2 (candidate tools + caveat), §5.6 (snapshot aggregates + F detail),
guardrails G4/G5/G7/G10. Contract: `docs/build/M2-CONTRACT.md` (§5 `data_note`, §6 the five tools).
Builds on **RUN M2-3** (`inst_agg.db` + manifest `inst` module), **M2-2** (inst schema), **M2-1**
(`SecClient` for federated detail), and the M1 MCP substrate (`mcp_server/{server,queries,envelope}.py`,
module-aware `SnapshotClient`) — **import and extend, don't fork the server**.

## Scope (owns)

`src/populus/mcp_server/inst_queries.py` (snapshot reads over `inst_agg.db` + federated reads via
`SecClient`); edits to `mcp_server/server.py` (register 5 inst tools; resolve the `inst` snapshot module
+ a federated client; extend `populus_health`) and `mcp_server/envelope.py` (M2 `data_note`,
`shape_holding`, `sec-edgar` `license_notices`, `live_source` for federated responses);
extensions to `tests/test_mcp_server.py` (inst tool suite + inst golden Q&A corpus, cache-gated).

## Requirements

1. **Five tools** (contract §6, analyst-question docstrings, ≤25 global budget): `inst_filer_lookup`,
   `inst_filer_holdings(cik, period?, mode='snapshot'|'qoq')`, `inst_ticker_holders(ticker, period?)`,
   `inst_biggest_moves(period?, side='new'|'add'|'trim'|'exit', limit=50)`, `inst_health()`. Snapshot
   tools read `inst_agg.db` via the module-aware `SnapshotClient(module="inst")`; `inst_filer_holdings`
   supports a **federated** live-EDGAR path (arbitrary/latest per-filer detail via the `SecClient`),
   returning a `live_source`-stamped envelope rather than `build_id`. Bad input ⇒ corrective-hint error.
2. **Envelope honesty** (§11.3, G4/G5/G10): non-removable M2 `data_note` (contract §5). Every record
   carries the EDGAR filing provenance URL, **both** `period_of_report` and `filed_date` (G4), values
   labeled as the manager's **stated quarter-end market value** with `unit_basis` (G5), and holdings
   labeled **quarter-end snapshot, not current holdings** (G10). `license_notices` carries `sec-edgar`.
   `inst_ticker_holders` resolves ticker→CUSIP→security **as-of** the period (G14); unmapped surface
   by issuer name + flag.
3. **`populus_health`**: report the `inst` module alongside `congress` — snapshot build, freshness
   (latest period + filed date), value-coverage %, unit-regime mix, standing caveats.
4. **Golden Q&A corpus** (cache-gated, mirrors M1's 10-question golden): e.g. "What did Berkshire hold
   at 2026-Q1?", "Who are the biggest holders of AAPL?", "Biggest new positions last quarter?",
   "Is this current?" (must surface the quarter-end/lag caveat). Expected-shape assertions against the
   cached published snapshot; federated-path test uses an injected transport (no live network in CI).

## Acceptance

`uv run pytest -q` green including the inst tool suite and the cache-gated inst Q&A golden; **all M1
MCP tests unchanged**. `populus-mcp` (or `--db` bypass) exposes the five `inst_*` tools plus the updated
`populus_health`; a manual/optional stdio smoke test against the published two-module snapshot returns
real Berkshire holdings with an honest envelope (data_note present, unit basis + both dates labeled,
quarter-end-not-current caveat, `sec-edgar` notice). Federated `inst_filer_holdings` path unit-tested
with an injected transport — **no live network in tests**.
