# Populus

**The open financial-data commons** — finance data that is free to pull from primary
sources and redistributable under recorded conditions, served as an MCP server and a
public dashboard. Congressional trading ships first.

> **Status: pre-release (P1 build).** The governing specification is
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (v2.12, 11 external review rounds).
> Nothing here is published or supported yet.

## Layout

- `src/populus/` — pipeline, publication protocol, and MCP server (Python 3.12, `uv`)
- `tests/` — unit tests + golden corpus of real government filings
- `docs/` — architecture and build briefs
- `.github/workflows/` — publish / record-sign / monitor (files; not yet armed)

## Legal

Code is MIT. Data are US-government public records carrying statutory conditions —
see the conditions register described in the architecture (§15), including
5 U.S.C. § 13107(c) prohibited-uses notice. Not financial advice.
