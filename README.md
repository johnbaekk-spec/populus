# Public Filings

**The open financial-data commons** — US financial-disclosure data pulled only
from primary government sources, redistributable under recorded conditions,
and free. Live at **[publicfilings.org](https://publicfilings.org)**.

Two consumers of one verified data pipeline:

- a **public static dashboard** — congressional trading and institutional
  (13F) holdings, with the caveats designed in rather than buried; and
- an MIT-licensed **MCP server** (`populus-mcp`) serving the same published
  snapshot over stdio.

The differentiators are provenance and honesty, not coverage: every row links
to the government document it came from, amounts render as the statutory
ranges they are, both the trade date and the filed date always show, and
coverage/parse imperfection is published rather than hidden.

**Status:** deployed. `publicfilings.org` serves attested build `20260826.1`;
the nightly publish path is live (see Deployment below). Open work is tracked
in [docs/roadmap.md](docs/roadmap.md).

## Architecture in one paragraph

A Python 3.12 pipeline ingests primary sources (House Clerk PTR PDFs, Senate
eFD, SEC EDGAR 13F, the CC0 congress-legislators roster), parses or flags —
never silently drops — into SQLite canonical stores, and publishes immutable,
content-addressed, attested builds to a separate data repository
(`populus-data`); published artifacts are the API. The Astro dashboard is
built publisher-side from one staged verified build and deployed to
Cloudflare Pages as a fully static site (no backend, no accounts, no cookies,
no external requests), verified inventory-wide on preview before production,
and each deployment is independently signed and recorded. The MCP server is a
thin read layer over the same published snapshot. The governing specification
is [ARCHITECTURE.md](ARCHITECTURE.md).

## Repository map

- `src/populus/` — the pipeline: `ingest/` (the only network-touching
  modules), `parse/`, normalization, member/security identity registries,
  `inst_*` (13F aggregation and serving projection), `publish/` (build /
  manifest / attestation / pointer), `deploy/` (Cloudflare upload,
  verification, deployment records), `mcp_server/`, and `licenses.py` (the
  §15 conditions register that generates `DATA-LICENSE.md` / `NOTICE`)
- `dashboard/` — the Astro static site ([dashboard/README.md](dashboard/README.md))
- `scripts/` — acceptance gates, fixture generators, guards
  (`dep_guard.py`), and `scripts/maintenance/` (link and path gates)
- `tests/` — the Python suite plus a golden corpus of real government filings
- `docs/architecture/` — durable data contracts and decision records;
  `docs/operations/` — runbooks; `docs/frontend/` — dashboard contracts and
  design principles; `docs/roadmap.md` — open work
- `ops/runner/` — the self-hosted publish runner's controller (host
  infrastructure; see `docs/operations/self-hosted-runner.md`)
- `.github/workflows/` — `checks.yml` (contributor CI), `publish.yml` (the
  nightly data publish + site deploy), `record-sign.yml` (the deployment
  record signer)

## Prerequisites

- Python 3.12 with [`uv`](https://docs.astral.sh/uv/) (version pinned by
  `.python-version`; dependencies locked in `uv.lock`)
- Node (pinned by `dashboard/.node-version`) with npm, for dashboard work

## Quickstart

```bash
uv sync                 # install pinned Python dependencies
uv run pytest -q        # the Python suite + golden-corpus checks (offline)

cd dashboard
npm ci
npx astro check         # types
npm test                # unit suites (node --test)
```

The `populus` CLI covers `db init`, the ingest jobs (`congress-house`,
`congress-senate`, `congress-backfill`, `members`, and the institutional
jobs), reparse, `stats`, `build`, `publish`, and `verify`. An offline
end-to-end run from a local cache:

```bash
uv run populus db init app.db
uv run populus ingest congress-house  --db app.db --from-cache data-cache/house
uv run populus stats --db app.db --out stats.json
```

## Configuration

- `POPULUS_CONTACT` — the operator contact address embedded in every
  outbound User-Agent. This is the single operator-contact setting; the
  built-in default is a maintainer fallback, not hidden configuration.
  House/Senate use a parenthesized bot format and SEC uses its verified bare
  application-plus-contact format; the formats are source-specific and fixed.
- Dashboard build inputs (`POPULUS_BUILD_DIR`, `POPULUS_DB`,
  `POPULUS_DATA_REPO`, `POPULUS_INST_DB`, `POPULUS_TICKER_MAP`,
  `SITE_CODE_SHA`) are documented in
  [dashboard/README.md](dashboard/README.md).
- `build` / `publish` / `verify` each require an explicit `--attestation=`
  choice — see `docs/operations/attestation.md`.

## The two-tier gate model

Two tiers, honestly separated; neither claims the other's coverage.

**Contributor tier** — runs on a fresh clone and on hosted CI runners:

- `uv run pytest -q` — the Python suite. Offline; two host-bound suites
  (the macOS runner controller, the parameterized M2-11 QA bundle) declare
  their own preconditions and skip where their subject does not exist.
- `dashboard: npm ci && npx astro check && npm test` — types and unit suites.
- `make security` — `dep_guard` (offline) plus `pip-audit` over the frozen
  production export and `npm audit --audit-level=high`. The audit halves are
  **network-dependent**: they call the PyPI/OSV and npm advisory services, so
  this gate is *not* hermetic and can go red on an advisory-database change
  with no local edit — loudly, never as a silent pass.

CI (`.github/workflows/checks.yml`) runs this tier on `pull_request`
(fork-safe: hosted runners, `contents: read`, no secret access) and `push`;
`pull_request_target` and comment-driven execution remain banned.

**Owner tier** — `make test` / `make check` run the full tree including
`npm run gates`: the static site build (**32 GiB physical-memory floor**, a
24 GiB Node heap), the post-build suite (which needs a real
`POPULUS_BUILD_DIR` and release databases from the **private** data
checkout), and the Chromium browser-geometry lane. This tier is
**owner-only** by its host requirements; a green contributor tier does not
prove it, and CI never runs it.

## Dashboard development

See [dashboard/README.md](dashboard/README.md) for the build/data contract,
the gate chain, and route map. The design contract for all surfaces is
[docs/frontend/design-principles.md](docs/frontend/design-principles.md).

## Deployment

Deployment is **owned by `publish.yml`** and is not a contributor surface.
The nightly scheduled run executes on a self-hosted macOS publisher runner
(the institutional module derives from a ~21 GB local store that cannot ship
to a hosted runner), while the deploy and record-sign jobs stay on hosted
runners deliberately — they hold the Cloudflare-write and attestation
authority. Scheduled publishes are gated by the
`POPULUS_SELFHOSTED_VALIDATED` arming variable; supervised
`workflow_dispatch` runs are exempt by design. The site is verified
inventory-wide on preview before production receives bytes, production
failures roll back to the captured (and serving-verified) prior deployment,
and `record-sign.yml` attests an append-only deployment record — a live
deployment without a valid record **gates the next publish** (the R18 gate).
Operator procedures: `docs/operations/deploy.md`, `rollback.md`,
`attestation.md`, `self-hosted-runner.md`.

## Legal and data provenance

Code is MIT ([LICENSE](LICENSE)). Data are US-government public records
carrying statutory conditions — see [DATA-LICENSE.md](DATA-LICENSE.md) and
[NOTICE](NOTICE), both **generated** from the machine-readable conditions
register (`src/populus/licenses.py` / `licenses.json`, ARCHITECTURE §15),
including the 5 U.S.C. § 13107(c) prohibited-uses notice. Data carries
per-source conditions, not one license. Not financial advice. Security
policy: [SECURITY.md](SECURITY.md).

## Documentation policy

Active documentation describes the **present** system: architecture and
contracts (`ARCHITECTURE.md`, `docs/architecture/`), operations
(`docs/operations/`), frontend (`docs/frontend/`), and open work
(`docs/roadmap.md`). Completed delivery process — run briefs, plans, dev
notes, review transcripts — is deleted from the active tree once its durable
decisions are extracted; **Git history is the archive**. A document that
narrates how something was built belongs in history; a document a maintainer
needs to operate or extend the system belongs here.
