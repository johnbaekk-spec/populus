# Populus dashboard

The public static dashboard (ARCHITECTURE §12): Astro, static output, deployed
publisher-side on Cloudflare Pages. **This directory currently implements the
first P3 surface — the `/congress` feed** — from the approved design project
*UI Mockups for Project* (`Congress Feed.dc.html`, with `Mobile.dc.html` fold
rules and the `States` empty-state specs).

## Build

```bash
cd dashboard
npm ci
npm run build        # emits dist/
npm run preview      # serves dist/ on :4321
```

Node is pinned by `.node-version` (§12.1 pinned-toolchain requirement). The DB
is read with `node:sqlite` — no native dependencies.

### Data inputs

The site builds from **one published data build** and never resolves
`latest.json` (the dashboard is not a pointer consumer — §12.1):

| Variable | Meaning |
|---|---|
| `POPULUS_BUILD_DIR` | path to `builds/<build_id>` of the data repo (CI: required, from the staged verified build) |
| `POPULUS_DB` | path to the matching `congress.db` release snapshot (CI: required) |
| `POPULUS_DATA_REPO` | **dev only** — a local data-repo checkout; the newest `builds/<id>` is used. Defaults to `../populus-data`. |
| `SITE_CODE_SHA` | embedded in the footer; falls back to `git rev-parse --short HEAD` |

What is read, all of it from published artifacts (DR-4 — published artifacts
are the API):

- `builds/<id>/congress/stats.json` → stat tiles, as-of timestamp, data note
- `builds/<id>/manifest.json` → hashed for the footer's `snapshot sha256:` line
- `builds/<id>/DATA-LICENSE.md`, `NOTICE` → served verbatim at `/legal/…`
- `releases/data-<id>/congress.db` → feed rows (`v_default_transactions`
  joined to `filings` for `doc_url` and `members` for name/party/state), plus
  active `needs_ocr` filings for the paper-filing rows

## What's implemented

- `/congress` — the feed page, faithful to the design: masthead, stat tiles,
  filter bar (chamber / party / side / amount-floor / owner / late-only),
  ARIA-labelled table with SSR page 1, log-scale range bands (verified against
  the design's bucket geometry: log10 from $1K to $50M), flag chips, paper
  needs-OCR rows interleaved by filed date, †/‡ footnote, pagination, notice
  footer. Light + dark (explicit toggle + `prefers-color-scheme` default),
  mobile fold per `Mobile.dc.html`.
- Client island (vanilla TS, no framework): filtering/search/pagination over
  the full default view, fetched lazily from the same-origin
  `/congress/data/feed.v1.json` deployed with the build. Page 1 is
  pre-rendered through the **same row renderer** (`src/lib/format.ts`) the
  island uses, so pre-rendered and client-rendered rows are identical.
- S3 empty state ("No disclosures match — and that's an answer, not an
  error") with computed nearest-match relaxations.
- Watchlist stars → `localStorage` (`populus:watch:members`), member-level,
  this browser only. No cookies, no accounts, no external requests of any kind
  (fonts self-hosted via @fontsource).
- `/legal/DATA-LICENSE.md`, `/legal/NOTICE.txt` — the build's conditions
  register, verbatim. Root `/` meta-refreshes to `/congress/` until the
  homepage handoff lands.

## Decisions taken during implementation (vs. the mockup)

- **Real numbers replace mock numbers.** Tiles derive from `stats.json`:
  row count from `default.row_count`; per-chamber parse = `parsed ⁄ (total −
  needs_ocr)` (full breakdown in the tile tooltip); paper count from
  `needs_ocr_filing_count_including_excluded`. The mock's "54,213 rows /
  97.5% / 187 paper" were sample values.
- **Traded-date display**: MM-DD when the traded year equals the filed year
  (as designed), full ISO date otherwise — the backfill contains cross-year
  rows and truncating those would misread.
- **Amount filter semantics**: "Amount ≥ X" matches rows whose statutory
  bucket floor is ≥ X (range-honest; straddling buckets are excluded).
  Unparsed amounts match only "any bucket".
- **Paper rows under filters**: a needs-OCR filing has no side/amount/owner/
  late/ticker, so any active filter on those dimensions hides paper rows;
  they only match on chamber/party/name.
- **Open-ended and unparsed ranges** render as hatch (never a solid bar);
  spouse-cap rows carry ‡ and the hatched open band, per the design.
- **sale_partial** renders as side "Sale" + "· partial" in the owner slot,
  matching the design's grammar. `other` side rows (present in real data,
  absent from the mock) render neutrally as "Other" and are only reachable
  under Side=All.
- **Internal links point at canonical future routes**
  (`/congress/members/<bioguide>/`, `/congress/tickers/<t>/`, `/methodology/`,
  `/institutional/`). Those pages are later handoffs from the same design
  project; **the site must not deploy publicly until they land** (or the
  links are gated). Tracked below.
- **Search** (masthead "member or ticker…") filters the feed on this page:
  member-name substring or ticker prefix. It becomes global navigation when
  entity pages exist.
- Fonts: the design's three families (Source Serif 4 600/700, Public Sans
  400–700, IBM Plex Mono 400–600) are **self-hosted**, latin subsets served —
  no calls to Google Fonts (§5.6: no external requests).

## Verified

- Built against real published build `20260724.3`: 3,911 default rows, 37
  needs-OCR filings; tiles cross-checked against `stats.json`; the Senate
  late-only suggestion count (718) matches `late_filing.by_chamber.senate`.
- Browser-verified: desktop light/dark, 375px mobile fold, filters, search,
  pagination, watchlist persistence across reload, empty state + suggestion
  application, paper-row interleaving, zero console errors, zero external
  requests. `dist/` = 86 files (M1 budget ≤4,000).

## Deferred to later handoffs (same design project)

- `Home.dc.html` (site root), `Congress Member.dc.html`,
  `Congress Ticker.dc.html`, `Ticker Holders.dc.html`,
  `Institutional Filer.dc.html`, `Methodology.dc.html`, `Module Shells.dc.html`
- Long-tail client-rendered entity route + out-of-extract state (S2)
- Filter state ↔ URL synchronisation (shareable filtered views)
- Lighthouse ≥90 CI gate + the §12.1 deploy workflow (`wrangler`, inventory,
  record-sign) — phase-gate items for P3 completion, not per-page work
