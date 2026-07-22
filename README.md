# Populus

**The open financial-data commons** — finance data that is free to pull from primary
sources and redistributable under recorded conditions, served as an MCP server and a
public dashboard. Congressional trading ships first.

> **Status: pre-release (P1 build).** The governing specification is
> [ARCHITECTURE.md](ARCHITECTURE.md) (v2.12, 11 external review rounds).
> Nothing here is published or supported yet.

## Layout

- `src/populus/` — pipeline, publication protocol, and MCP server (Python 3.12, `uv`)
- `scripts/` — CI-able guards (e.g. `dep_guard.py`, the §19 paid-SDK denylist check)
- `tests/` — unit tests + golden corpus of real government filings
- `ARCHITECTURE.md` / `REVIEW-RESPONSE.md` — governing spec + review audit trail; `docs/build/` — build briefs
- `.github/workflows/` — publish / record-sign / monitor (files; not yet armed)

## Development

Python 3.12, [`uv`](https://docs.astral.sh/uv/)-managed. Building and testing the
substrate needs no network access.

```
uv sync                              # install pinned dependencies
uv run pytest                        # unit tests + golden-corpus checks
uv run python scripts/dep_guard.py   # G1: no paid/vendor SDKs (ARCHITECTURE.md §19)
uv run populus db init app.db        # create an empty database (full §9.4 schema)
```

The `populus` CLI (`ingest` / `reparse` / `build` / `publish` / `verify` / `stats`)
is scaffolded, but today only `db init` is implemented; each other subcommand
validates its full argument surface and names the build RUN that will implement it.

## Legal

Code is MIT. Data are US-government public records carrying statutory conditions —
see the conditions register described in the architecture (§15), including
5 U.S.C. § 13107(c) prohibited-uses notice. Not financial advice.
