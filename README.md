# Public Filings

**The open financial-data commons** — finance data that is free to pull from primary
sources and redistributable under recorded conditions, served as an MCP server and a
public dashboard. Congressional trading ships first.

> **Status: pre-release (P1 build).** The governing specification is
> [ARCHITECTURE.md](ARCHITECTURE.md) (v2.12, 11 external review rounds).
> Nothing here is published or supported yet.

## Layout

- `src/populus/` — pipeline, publication protocol, and MCP server (Python 3.12, `uv`)
  - `ingest/house.py` — House Clerk PTR ingest (discovery, fetching, archiving,
    reconciliation, reparse)
  - `ingest/senate.py` — Senate eFD PTR ingest (agreement handshake, index discovery,
    page archiving, amendment linkage, reconciliation, reparse)
  - `ingest/__init__.py` — shared transport identity (contact UA, response shape,
    archive-path containment); `ingest/` holds the only modules that touch the network
  - `parse/house_ptr.py` — House PTR parser (pdfplumber positions, pypdf text fallback)
  - `parse/senate_ptr.py` — Senate eFD PTR page parser (lxml, verified 9-column table)
  - `normalize.py` — chamber-neutral normalization maps and the flag taxonomy
  - `members.py` + `aliases.yaml` — §9.7 member identity: legislators load, the
    version-controlled alias file, and the post-hoc join pass
  - `backfill.py` — kadoa seed import, primary-source crosswalk, and the §9.6
    blocking audit gate (deterministic sampler + fail-closed scorer)
  - `amendments.py` + `views.sql` — §9.5 default/uncertainty views and durable
    amendment-pair flags
  - `stats.py` — the §5.2 honesty layer (`stats.json`)
  - `licenses.py` + `licenses.json` — the §15 conditions register (generates
    `DATA-LICENSE.md` and `NOTICE`)
- `scripts/` — CI-able guards and generators (`dep_guard.py`, the §19 paid-SDK
  denylist check; `render_licenses.py`, the license-document generator)
- `tests/` — unit tests + golden corpus of real government filings
- `ARCHITECTURE.md` / `REVIEW-RESPONSE.md` — governing spec + review audit trail;
  `docs/build/` — build briefs; `docs/runbooks/` — operating procedures
- `DATA-LICENSE.md` / `NOTICE` — generated from the conditions register; data carries
  per-source conditions, not one license
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

The `populus` CLI covers `db init`, all four ingest jobs (`congress-house` /
`congress-senate` / `congress-backfill` / `members`), both reparse jobs, `stats`,
and the `backfill-audit` gate commands. `build` / `publish` / `verify` validate
their full argument surface and name the build RUN that will implement them (RUN 5).

The full offline pipeline, in order:

```
uv run populus db init app.db
uv run populus ingest congress-house   --db app.db --from-cache data-cache/house
uv run populus ingest congress-senate  --db app.db --from-cache data-cache/senate
uv run populus ingest congress-backfill --db app.db --from-cache data-cache/kadoa
uv run populus ingest members          --db app.db --from-cache data-cache/legislators \
    --house-index data-cache/house --kadoa-trades data-cache/kadoa/trades.json
uv run populus stats --db app.db --out stats.json
```

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
≥ 0.25 s apart, and backs off on 429/5xx.

### Senate PTR pipeline

```
# offline — ingest from a local cache laid out like data-cache/senate/
uv run populus ingest congress-senate --db app.db --from-cache data-cache/senate

# live — handshake with the eFD search site, archiving raw pages under --raw-root
uv run populus ingest congress-senate --db app.db --raw-root raw/senate

# reparse archived pages in place; never re-fetches
uv run populus reparse congress-senate --db app.db --raw-root raw/senate \
    [--filing senate:029f67f3-121a-406c-bddf-a9a7e7d6267b \
     | --since 2026-01-01 | --parser-version senate-ptr-1.0.0]
```

The Senate index is one continuous submitted-date window rather than per-year files,
so `--year` is rejected for this job: an empty store backfills from 2012-01-01, and
later runs re-scan from the newest stored Senate `filed_date` minus 90 days, which is
what catches late amendments and paper-to-e-file conversions. Paper filings are
recorded with zero rows and `parse_status='needs_ocr'` — retained and visible, never
dropped. Amendments link to an original through `supersedes` only when exactly one
unambiguous candidate exists, and every amendment transaction row carries the
`amendment_unresolved` flag until amendment semantics are settled (§9.5). The summary
accounts for every index UUID in exactly one `parse_status`, and the run exits
non-zero unless discovery succeeded, every index row was accepted, and every UUID
reconciled into a non-failed status.

Live Senate fetching adds the §9.1 handshake — CSRF token, then the prohibition
agreement POST, which must be answered with a redirect (a `200` means the agreement
was not accepted, so the run fails rather than scraping anonymously). Requests are
spaced ≥ 2.0 s plus jitter with backoff on 429/5xx, and three consecutive `403`s trip
a circuit breaker that stops the job — recorded as `status='circuit_open'`, exit 1,
never retried harder.

Both chambers' politeness floors live in code, not config. `ingest/house.py` and
`ingest/senate.py` are the only modules permitted to import `httpx`, which
`tests/test_dep_guard.py` enforces. The test suite never touches the network.

### Backfill, member join, stats, and the audit gate

`ingest congress-backfill` imports **congressional rows only** from the kadoa
seed (`data-cache/kadoa/trades.json`) as one filing per seed row
(`filing_id='kadoa:<id>'`, `license_id='mit-kadoa-seed'`); OGE/executive rows
are counted and never imported, and every source row reconciles into exactly
one outcome. When a parsed primary filing exists for the same source document,
the kadoa filings for that document are retired with `primary_filing_id`
lineage — tombstones, never deleted.

`ingest members` loads the congress-legislators seed (CC0) plus the
version-controlled `aliases.yaml`, then joins filers to members per §9.7:
normalized name × chamber × term overlap with the filed date (× state/district
where hints exist), joining only on exactly one candidate. Unjoined filings
keep a NULL `bioguide_id` and are listed in stats — never dropped. Re-running
the job re-resolves after any alias edit.

`stats` emits deterministic `stats.json`: every quantitative aggregate reads
the `v_default_transactions` view (active filings minus the original side of
each unresolved amendment pair), while archive-inventory totals are separately
named `*_including_excluded`.

`backfill-audit draw` / `backfill-audit score` implement the §9.6 blocking
human audit of the kadoa import (pinned sample sizes, sealed draw records,
independent reconstruction, fail-closed scoring). The operating procedure is
[docs/runbooks/kadoa-backfill-audit.md](docs/runbooks/kadoa-backfill-audit.md);
the signed disposition is a P1 gate, not something the tooling auto-passes.

## Legal

Code is MIT. Data are US-government public records carrying statutory conditions —
see [DATA-LICENSE.md](DATA-LICENSE.md) and [NOTICE](NOTICE), generated from the
machine-readable conditions register (`src/populus/licenses.json`, §15), including
the 5 U.S.C. § 13107(c) prohibited-uses notice. Not financial advice.
