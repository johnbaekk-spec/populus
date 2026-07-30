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
npm run gates        # typecheck + tests + build (the three declared gates)
npm run build        # emits dist/
npm run preview      # serves dist/ on :4321
```

Gate surfaces: `npm run check` (astro check / tsc), `npm test`
(`node --test` over `test/*.test.ts`), `npm run build`. `src/lib/format.ts` is
pure and environment-agnostic precisely so the honesty rules can be tested
without a browser or a database — see `test/format.test.ts`.

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

## Deliberate deviations from the mockup, and why

The mockup is authoritative on layout, type and colour. It is **not**
authoritative where following it would remove honesty content — DESIGN-BRIEF §7
forbids exactly that ("if a mockup looks cleaner because a caveat disappeared,
it's wrong"). Three places where this implementation departs, each recorded so
it can be reconciled design-side rather than discovered later:

1. **`--ink3` is darkened / lightened** (`#8d8779` → `#6b6659` light,
   `#7d7869` → `#948e7e` dark). The design values measure 3.39:1 and 3.68:1
   against the surfaces they sit on, and every consumer is 9–12px text — below
   the WCAG 1.4.3 AA 4.5:1 floor that the brief makes a phase gate. The text
   affected is disproportionately the honesty layer (coverage captions, the
   paper-filing note, "amount unparsed"). Same reasoning for the range hatch
   (`--rule2` at 1.58:1 → 3.13:1 light / 3.67:1 dark, WCAG 1.4.11) and the
   unstarred ☆ glyph (1.58:1 → `--ink3`).
2. **The mobile fold keeps every honesty element.** The mockup's two-line phone
   card drops the filed date, the days-to-file lag, the owner/partial
   qualifier, the flag chips and the provenance link. Those are BRIEF §1
   requirements, so here they fold instead: both dates stay in the
   accessibility tree (visually hidden, not `display:none`, which would delete
   them for screen readers) with a combined "traded → filed" string shown
   visually; flags, the owner qualifier and the source link stay on screen and
   wrap to a third line when the content is wide. Coverage tiles become a
   horizontal scroll strip rather than disappearing, and the lede is
   tightened rather than hidden.
3. **Stat tiles state the denominator they divide.** The mockup pairs "100%"
   with "Senate parse · 53 filings"; the percentage's denominator is the 49
   *e-filed* filings, since the 4 paper ones were never machine-readable.
   Labels now read "· 49 e-filed" and the paper remainder is the fourth tile.
   `pct()` also floors and prints "100" only when numerator equals denominator,
   so 2,499/2,500 reads 99.9, never 100.

## Decisions taken during implementation (vs. the mockup)

- **Real numbers replace mock numbers.** Tiles derive from `stats.json`:
  row count from `default.row_count`, labelled by the **filing** window (the
  build holds one 2023 trade but no pre-2026 filing, so "since 2023" would
  have implied three years of coverage); per-chamber parse =
  `parsed ⁄ (total − needs_ocr)` with the e-filed denominator in the label and
  the full breakdown in the tooltip; paper count from
  `needs_ocr_filing_count_including_excluded`. A missing coverage key throws
  rather than publishing "0 filings". The mock's "54,213 rows / 97.5% / 187
  paper" were sample values.
- **Counts state what they count.** Paper filings are never folded into a
  transaction total: the line reads "1–50 of 3,911 transactions · 37 paper
  filings (2 here)". Paper rows paginate with the transactions they sit among
  and a paper-only result set still renders (and still has a page).
- **Traded-date display**: MM-DD when the traded year equals the filed year
  (as designed), full ISO date otherwise — the backfill contains cross-year
  rows and truncating those would misread.
- **Amount filter semantics**: "Amount ≥ X" matches rows whose statutory
  bucket floor is ≥ X (range-honest; straddling buckets are excluded). Rows
  that disclose only an open-ended cap ("Over $1,000,000") or an unparsed
  amount are **indeterminate** — they can be neither ruled in nor out, so they
  are counted and stated ("73 amount not comparable") instead of being
  silently dropped behind a confident "matches 0".
- **Paper rows under filters**: a needs-OCR filing has no side/amount/owner/
  late/ticker, so any active filter on those dimensions hides paper rows;
  they only match on chamber/party/name.
- **Open-ended and unparsed ranges** render as hatch (never a solid bar);
  spouse-cap rows carry ‡ and the hatched open band, per the design. The
  "amount unparsed" chip is derived from the *value* being unbounded, not from
  the upstream flag vocabulary — 25 rows in this build have no amount bounds
  while carrying only `row_incomplete`/`row_orphan`.
- **sale_partial** renders as side "Sale" + "· partial" in the owner slot,
  matching the design's grammar, with the qualifiers spelled out for assistive
  technology ("partial sale, jointly owned"). `side='other'` rows all carry
  `side_unparsed` in this corpus, so they render as "—" with the chip rather
  than as a confident category named "Other".
- **A negative days-to-file is named, not printed.** Two rows are filed before
  their own stated trade date; they read "filed −320d before trade" (amber,
  with the `date anomaly` chip), never "+-320d".
- **Unknown party is not painted as Independent.** `partyClass("")` returns its
  own neutral class — "we could not read the party" and "this member is an
  Independent" are different claims. Districts print only when a positive
  integer ("0" → AL); sentinels like `-1` are omitted, not shown as "-1".
- **A dataset-fetch failure is stated on the page**, not only in the console:
  the server-rendered first page is left in place and the reader is told that
  filtering needs a dataset that failed to download, with retry and a link to
  the raw JSON.
- **Provenance is scheme-allowlisted**: a `doc_url` that is not `https://`
  renders as unlinked text rather than a live href (the URLs trace to scraped
  government pages).
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

- **Gates:** `astro check` 0 errors / 0 warnings across 10 files; `node --test`
  34 tests passing; `astro build` 5 routes, `dist/` = 86 files (M1 budget
  ≤4,000); `npm audit` 0 vulnerabilities.
- Built against real published build `20260724.3`: 3,911 default rows, 37
  needs-OCR filings; tiles cross-checked against `stats.json`; the Senate
  late-only suggestion count (718) matches `late_filing.by_chamber.senate`.
- Browser-verified: desktop light/dark, 375px mobile fold, filters, search,
  pagination, watchlist persistence across reload, empty state + suggestion
  application, zero console errors, zero external requests.
- Boundary cases verified against the real build rather than assumed:
  searching a member with **paper filings and zero transactions** (Blumenthal,
  4 filings) renders all four rows and reports "0 of 3,911 transactions · 4
  paper filings (4 here)"; "Amount ≥ $25M" reports the 73 indeterminate rows;
  paging to the first/last page keeps keyboard focus on the range readout
  instead of dropping it to `<body>`; at 375px the first row's accessible text
  carries both dates, the partial/joint qualifier, all 35 flag chips and the
  provenance link.

An independent QA review of the first commit (`edf15f9`) returned 2 blockers,
8 majors, 12 minors and 3 nits. Every finding is addressed in the follow-up
commit; the two blockers were a pagination boundary that dropped paper filings
no transaction preceded, and a mobile fold that deleted the row-level honesty
layer. Both now have regression tests.

## Deferred to later handoffs (same design project)

- `Home.dc.html` (site root), `Congress Member.dc.html`,
  `Congress Ticker.dc.html`, `Ticker Holders.dc.html`,
  `Institutional Filer.dc.html`, `Methodology.dc.html`, `Module Shells.dc.html`
- Long-tail client-rendered entity route + out-of-extract state (S2)
- Filter state ↔ URL synchronisation (shareable filtered views)
- Lighthouse ≥90 CI gate + an automated axe/Lighthouse a11y assertion over
  `dist/` at 375px and desktop in both themes; plus the §12.1 deploy workflow
  (`wrangler`, inventory, record-sign) and its `_headers`/CSP — phase-gate
  items for P3 completion, not per-page work
- A lint/format surface (no eslint/biome/prettier config here yet)

## The design handoff

The mockups live in the Claude Design project **"UI Mockups for Project"**
(`1edc8435-2597-4222-b30c-647b0a20d66e`), readable with the design MCP
(`DesignSync` → `list_files` / `get_file`). `Populus Design System.dc.html` —
the token and component source of truth — is snapshotted in
[`docs/design/handoff/`](../docs/design/handoff/) as fetched 2026-07-30, so the
token values this stylesheet claims to follow are reviewable in-repo. The
per-page mockups are not snapshotted; read them from the project.
