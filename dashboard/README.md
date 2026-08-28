# Public Filings dashboard

The public static dashboard (ARCHITECTURE §12): Astro, static output,
deployed publisher-side on Cloudflare Pages, live at
[publicfilings.org](https://publicfilings.org). It renders congressional
trading and institutional (13F) surfaces from **one published data build**,
with the honesty layer (dual dates, range amounts, provenance links,
published imperfection) as first-class content — the design contract is
[docs/frontend/design-principles.md](../docs/frontend/design-principles.md).

## Build and gates

```bash
cd dashboard
npm ci
npm run check        # astro check / tsc
npm test             # node --test over test/*.test.ts
npm run build        # emits dist/
npm run preview      # serves dist/ on :4321
npm run gates        # check + test + build + test:post + geometry — the full chain
```

`npm run gates` sequences `test:post` (`test/post/*.test.ts`) **strictly
after** the build so post-build checks never run against a stale `dist/`; it
spawns `astro preview` for the served status contract, performs an isolated
forced-cut build into `dist-cut/`, and builds the institutional fixture
preview into `dist-fixture/`. The build carries a 32 GiB physical-memory
preflight and a 24 GiB Node heap, and the geometry lane needs Chromium, so
the full chain is **owner-tier** (see the root README's gate model); `check`
and `test` run anywhere. The whole chain also runs under the repository's
canonical `make test`. Node is pinned by `.node-version`; the DB is read with
`node:sqlite` — no native dependencies.

`src/lib/format.ts`, `src/lib/derive.ts`, and the `src/lib/ui/` domain
modules (entry point `src/lib/ui/index.ts`) are pure and
environment-agnostic precisely so the honesty rules can be tested without a
browser or a database.

## Data inputs

The site builds from **one published data build** and never resolves
`latest.json` (the dashboard is not a pointer consumer — §12.1):

| Variable | Meaning |
|---|---|
| `POPULUS_BUILD_DIR` | path to `builds/<build_id>` of the data repo (CI: required, from the staged verified build) |
| `POPULUS_DB` | path to the matching `congress.db` release snapshot (CI: required) |
| `POPULUS_DATA_REPO` | **dev only** — a local data-repo checkout; the newest `builds/<id>` is used. Defaults to `../populus-data`. |
| `SITE_CODE_SHA` | the commit the site was generated from. Emitted verbatim as `<meta name="populus:code_sha">` on every page; CI passes the **full** `github.sha` because deploy verification compares the marker exactly. Dev fallback: `git rev-parse --short HEAD`. |
| `POPULUS_TICKER_MAP` | path to a `company_tickers.json` snapshot (SEC primary source) — the ticker→issuer mapping input. Dev default: the committed pipeline fixture. **Under `CI` a path resolving into `tests/fixtures/` is refused** (fixture data must never ship as production truth). An absent path → every ticker renders the honest no-map state, which is what the deployed site ships (TD-7). |
| `POPULUS_INST_DB` | optional override for the institutional aggregate path; default `$POPULUS_BUILD_DIR/inst_agg.db`. The module renders only when the manifest declares `inst` AND the artifact is readable. |
| `POPULUS_TEST_PAGE_BUDGET` | **test only** — forces a small entity-page budget so the rank-cut → `/e/` path is provable. Production uses the §9.10-derived constant. |

What is read, all of it from published artifacts (published artifacts are the
API): `builds/<id>/congress/stats.json` (tiles, as-of, data note — and its
raw bytes re-served verbatim at `/stats.json`), `builds/<id>/manifest.json`
(module availability), `builds/<id>/DATA-LICENSE.md` + `NOTICE` (served
verbatim under `/legal/`), and `releases/data-<id>/congress.db` plus, when
declared, `inst_agg.db`.

## Route map

- `/` — Home; `/methodology/` — the honesty ledger, a first-class surface
- `/congress/` — the feed (SSR page 1 + a vanilla-TS client island over
  `/congress/data/feed.v1.json`); `/congress/members/[bioguide]/`,
  `/congress/tickers/[ticker]/` (+ index), `/congress/leaders/`
- `/institutional/` — filer index; `/institutional/filers/[cik]/`;
  `/institutional/tickers/[t]/holders/`; versioned JSON shards under
  `/institutional/data/`
- `/tickers/[ticker]/` — the unified ticker view; `/signals/`,
  `/watchlist/`, `/search/index.v1.json`
- `/e/` — the generic client-rendered entity route for budget-cut entities,
  rendering through the **same** pure body functions (`src/lib/ui/`) the
  static pages use — parity by construction
- `/financials/`, `/macro/` — forward-looking module shells
- `/legal/DATA-LICENSE.md`, `/legal/NOTICE.txt`, `/stats.json`, `404`

Entity pages render through pure body functions under `src/lib/ui/` — domain
modules re-exported by the single consumer entry `src/lib/ui/index.ts`; the G1–G7
honesty components are pure string renderers in `src/lib/format.ts` — one
implementation each (grep-enforced by test), consumed by SSR pages and the
client drivers alike, because forked render paths break byte-parity
verification.

## Rendering contracts

- Pagination and count semantics are specified in
  [docs/frontend/pagination-and-counts.md](../docs/frontend/pagination-and-counts.md);
  quarter-over-quarter presentation is producer-authoritative per
  [docs/frontend/qoq-presentation.md](../docs/frontend/qoq-presentation.md).
- The uncertainty grammar (denominators stated, NULL vs 0, hatched ranges,
  indeterminate rows counted, no-map and withheld states, universal-caveat
  hoisting) is specified in
  [docs/frontend/design-principles.md](../docs/frontend/design-principles.md) §3;
  the mobile fold is §5 of the same document, enforced by
  `test/css-fold.test.ts`.
- Watchlist state is localStorage only (`populus:watch:v2`), member- and
  ticker-level, this browser only. No cookies, no accounts, no external
  requests of any kind (fonts self-hosted).

## Build markers and `/stats.json`

Deploy verification reads two things out of the built site:

- **`<meta name="populus:build_id">` and `<meta name="populus:code_sha">`**
  on every page, parsed by name and compared **exactly** — never a substring
  search over the footer. The footer shows the same two values as text and
  renders **no digest**: the manifest is re-assembled after the site builds,
  so any rendered digest would be stale by construction.
- **`/stats.json`** — the raw bytes of `builds/<id>/congress/stats.json`
  passed through verbatim. The route must never parse and re-serialize;
  `test/post/http-status.test.ts` pins the served bytes, the emitted `dist/`
  bytes, and the canonical copy together.

Note for CI runners: the gates are not runnable under a bare `CI=1` (the data
layer refuses the newest-local-build fallback there), and the two builds that
deliberately use fixture inputs (`fixture-preview`, `entity-orchestration`)
need `CI` cleared in their child environment. Neither is a shipping build.

## Response-header defense in depth (RUN PUBLIC-SECURITY-HARDENING PR 5)

`public/_headers` is the one Cloudflare Pages provider control this site ships
(LD13): the locked CSP (`script-src 'self'` plus only the R28 analytics beacon
origins — no inline hashes, no `unsafe-eval`), HSTS `max-age=31536000`
(deliberately without `includeSubDomains`/`preload`, so `max-age=0` remains an
emergency rollback), `X-Content-Type-Options: nosniff`, and
`Referrer-Policy: strict-origin-when-cross-origin`.

Because `script-src` carries no hashes, **no executable inline script may exist
anywhere in the built tree**. Two mechanisms keep that true:

- the pre-paint theme IIFE lives in `public/theme-init.js`, loaded
  synchronously from `<head>` (`is:inline src=` — external, unbundled, no
  FOUC), and
- `vite.build.assetsInlineLimit: 0` in `astro.config.mjs` stops the bundler
  from re-inlining small modules (the masthead toggle module was one).

`test/post/inline-surface.test.ts` gates both after every build: the emitted
executable-inline-script set must be EMPTY, the policy must pin zero hashes,
`theme-init.js` must be referenced synchronously from every page's head, and
`dist/_headers` must be byte-identical to `public/_headers`.
`<script type="application/json">` data islands are inert and exempt.

Deploy-side, `_headers` is an **attested control**: site inventory v2 lists it
under `controls` (kind `cloudflare-pages-headers`), and preview/production
verification requires the exact header values on representative HTML/JS/CSS/
JSON responses while `/_headers` itself still answers 404 (Pages consumes it
as configuration). `src/populus/deploy/verify.py` pins
`LOCKED_CONTENT_SECURITY_POLICY` against the shipped bytes — edit the policy in
both places or the deploy refuses.
