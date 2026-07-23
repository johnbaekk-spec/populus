# Populus

**The open financial-data commons** — finance data that is free to pull from primary
sources and redistributable under recorded conditions, served as an MCP server and a
public dashboard. Congressional trading ships first.

> **Status: pre-release (P1 build).** The governing specification is
> [ARCHITECTURE.md](ARCHITECTURE.md) (v2.12, 11 external review rounds).
> Nothing here is published or supported yet.

## Layout

- `src/populus/` — pipeline, publication protocol, and MCP server (Python 3.12, `uv`)
  - `ingest/house.py` — House Clerk PTR ingest (discovery, fetching, archiving,
    reconciliation, reparse); the only module that touches the network
  - `parse/house_ptr.py` — House PTR parser (pdfplumber positions, pypdf text fallback)
  - `normalize.py` — chamber-neutral normalization maps and the flag taxonomy
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
is scaffolded. `db init` and the `congress-house` ingest/reparse jobs are
implemented; every other subcommand validates its full argument surface and names
the build RUN that will implement it.

### House PTR pipeline

```
# offline — ingest from a local cache laid out like data-cache/house/
uv run populus ingest congress-house --db app.db --from-cache data-cache/house

# live — fetch from the House Clerk, archiving raw documents under --raw-root
uv run populus ingest congress-house --db app.db --raw-root raw/house [--year 2026]

# reparse archived documents in place; never re-fetches
uv run populus reparse congress-house --db app.db --raw-root raw/house \
    [--filing house:20034916 | --since 2026-01-01 | --parser-version house-ptr-1.0.0]
```

Ingest runs discover → fetch → classify → parse → normalize → load per year, each
invocation recorded as one `ingest_runs` row. Without `--year` it covers the current
year (plus the previous year through January), and ingest initializes the database
when `--db` does not exist yet. It prints a per-year reconciliation summary — every
index PTR DocID accounted for in exactly one `parse_status` (`parsed` / `partial` /
`needs_ocr` / `failed`) — and exits non-zero unless every year discovered and every
DocID reconciled. Reparse prints the resulting status counts, listing any filing it
could not reparse (no archived document, or unknown `--filing`), and exits non-zero
if there were any.

Live fetching is sequential, identifies itself with a contact UA, spaces requests
≥ 0.25 s apart, and backs off on 429/5xx; those floors live in code, not config.
`ingest/house.py` is the only module permitted to import `httpx`, which
`tests/test_dep_guard.py` enforces. The test suite never touches the network.

## Legal

Code is MIT. Data are US-government public records carrying statutory conditions —
see the conditions register described in the architecture (§15), including
5 U.S.C. § 13107(c) prohibited-uses notice. Not financial advice.
