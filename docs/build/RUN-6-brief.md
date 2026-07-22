# RUN 6 — MCP server (`populus-mcp`)

**Source of truth:** `ARCHITECTURE.md` §9.9 (the six tools), §11.1–§11.5 (shape, envelope, keyless default), §8/§9.8 (data_note honesty), §15 (license_notices), §17 P2 gates. Builds on RUNs 1–5.

## Scope (owns)

`src/populus/mcp_server/__init__.py`, `mcp_server/server.py`, `mcp_server/tools.py`, `mcp_server/envelope.py`, `tests/test_mcp_tools.py`, `tests/golden_questions.py` (+ `tests/test_golden_questions.py`). Add `populus-mcp` console script + `mcp` (official Python SDK, FastMCP) dependency. Wire `--db` / `--data-repo` / staging snapshot resolution through the RUN-5 client.

## Requirements

1. **Server shape** (§11.1): stdio FastMCP app named `populus`; data access via the RUN-5 snapshot client (staging mode: resolve `latest.json` from a local `populus-data` path or `POPULUS_DATA_URL`; `--db PATH` bypass for dev). Read-only. Lazy load. Offline ⇒ last cached build + staleness note in every envelope.
2. **Six tools exactly as §9.9 names and parameterizes them** (`congress_recent_trades`, `congress_member_lookup`, `congress_member_activity`, `congress_ticker_activity` with `mode='detail'|'top'|'biggest'`, `congress_latest_filings`, `congress_health`) **+ `populus_health`** (§11.2). Tool descriptions are the analyst questions from the table. Defaults per spec (window_days=30/90, limit=50, cursor pagination).
3. **Envelope** (§11.3, non-removable): every response `{as_of, build_id, data_note, license_notices[], results[], next_cursor?}`; every record carries `doc_url` + BOTH `transaction_date` and `filed_date` (G4); amounts always as `amount_low/high/label` — never a synthetic point value (G5); flow-estimate labeling on anything aggregate (G10); `data_note` = the §9.8 45-day-lag text; `license_notices` from `licenses.json` (incl. §13107 prohibited-uses notice). Default views only (`v_default_transactions` — amendment pair rule §9.5); `congress_latest_filings` includes needs_ocr + amendment-flagged filings explicitly.
4. **Validation UX**: bad ticker/member ⇒ structured hint (e.g. "no congressional trades recorded for X; try congress_ticker_activity mode='top'"); date params ISO-8601; cursor stability across identical snapshots.
5. **Golden-question suite** (§17 P2 gate): 20 analyst questions with **pinned expected answers computed from the ingested cache corpus** (assert exact counts/ids where deterministic, structural invariants where data-dependent). Examples to include: recent trades windowing, per-member history incl. `days_to_file` stats, ticker aggregation by party, biggest-by-bucket-upper-bound ranking honesty, health coverage figures matching `stats.json`.
6. **Tests**: run tools in-process against a published staging build (no live network); envelope invariants property-tested across all tools (dual dates, doc_url, notices present); pagination round-trip; offline/stale behavior.

## Acceptance

`uv run pytest -q` green incl. the 20-question suite at 100%; `uv run populus-mcp --db <real ingested db>` starts and serves a tool call via the MCP stdio protocol (smoke-tested with the SDK client in-process); cold start to first tool response < 5 s against the local snapshot.
