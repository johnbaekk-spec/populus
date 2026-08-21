# Public Filings dashboard

The public static dashboard (ARCHITECTURE §12): Astro, static output, deployed
publisher-side on Cloudflare Pages. **This directory implements the full P3
surface set** from the approved design handoff (`docs/design/handoff/`): the
`/congress` feed (P3-1) plus — RUN P3-2 — Home, member and ticker entity
pages, the deep congressional ticker view, the institutional filer/holders
pages bound to the published `inst_agg` contract, `/methodology`, the
`/financials` and `/macro` shells, states S1–S7, the global header search,
and the generic client-rendered entity route `/e/`.

## Build

```bash
cd dashboard
npm ci
npm run gates        # check + test + build + test:post && geometry:install && test:geometry (the declared gates, in order)
npm run build        # emits dist/
npm run preview      # serves dist/ on :4321
```

Gate surfaces: `npm run check` (astro check / tsc), `npm test`
(`node --test` over `test/*.test.ts`), `npm run build`, and `npm run
test:post` (`test/post/*.test.ts`), which `gates` sequences **strictly after**
the build so post-build checks never run against a stale `dist/` — it spawns
`astro preview` for the served status contract, performs its own isolated
forced-cut build into `dist-cut/`, and builds the institutional fixture
preview into `dist-fixture/`. `src/lib/format.ts`, `src/lib/derive.ts`, and
`src/lib/ui.ts` are pure and environment-agnostic precisely so the honesty
rules can be tested without a browser or a database.

This whole chain also runs under the **repository's canonical `make test`**
(root `Makefile`): its `test` target runs the Python suite and then
`cd dashboard && npm ci && npm run gates`, so the deterministic QA gate runner
— which executes and records `make test` and `make security` — records the
Astro/TypeScript unit suite, the static build, and the post-build suite with
their exit status under one entrypoint, not as a separate unrecorded command.

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
| `SITE_CODE_SHA` | the commit the site was generated from. Emitted verbatim as `<meta name="populus:code_sha">` on every page and echoed in the footer; CI passes the **full** `github.sha` because deploy verification compares the marker exactly. Dev fallback: `git rev-parse --short HEAD`. |
| `POPULUS_TICKER_MAP` | path to a `company_tickers.json` snapshot (SEC primary source) — the Locked #18 ticker→issuer mapping input. Dev default: the committed pipeline fixture `tests/fixtures/inst/mcp/company_tickers.json`. **Under `CI` a path resolving into `tests/fixtures/` is refused** (including the unset default), because a build that shipped fixture mappings would present them as production data and the served-tree sweep could not detect it — the served bytes would faithfully equal the built bytes. An absent path → `null` → every ticker renders the honest no-map state, which is what the deployed site ships (TD-7: no real snapshot exists on a runner). |
| `POPULUS_INST_DB` | optional override for the institutional aggregate path; default `$POPULUS_BUILD_DIR/inst_agg.db`. The module renders only when the manifest declares `inst` AND the artifact is readable. |
| `POPULUS_TEST_PAGE_BUDGET` | **test only** — forces a small entity-page budget so the rank-cut → `/e/` path is provable (`test/post/entity-orchestration.test.ts` builds `dist-cut/` with it). Production uses the §9.10-derived constant. |

What is read, all of it from published artifacts (DR-4 — published artifacts
are the API):

- `builds/<id>/congress/stats.json` → stat tiles, as-of timestamp, data note —
  **and its raw bytes, re-served verbatim at `/stats.json`** (see below)
- `builds/<id>/manifest.json` → module availability (`modules` keys). The
  manifest is **not** hashed for display: it is re-assembled after this site
  builds, so any digest a page rendered would be stale by construction.
- `builds/<id>/DATA-LICENSE.md`, `NOTICE` → served verbatim at `/legal/…`
- `releases/data-<id>/congress.db` → feed rows (`v_default_transactions`
  joined to `filings` for `doc_url` and `members` for name/party/state), plus
  active `needs_ocr` filings for the paper-filing rows

### Build markers and `/stats.json`

Two things the deploy verification reads out of the built site:

- **`<meta name="populus:build_id">` and `<meta name="populus:code_sha">`**, on
  every page. Verification parses them **by name and compares the values
  exactly** — never a substring search over the footer, which a whole-footer
  replacement would still satisfy. The footer keeps the same two values as
  human-readable text and renders **no digest at all**: the manifest is
  re-assembled after the site builds, so a rendered digest is stale by
  construction and a reader who checked it would be told the build is corrupt.
  The methodology page's verify command is `populus verify --build <id>` for the
  same reason — `--build` alone resolves the manifest.
- **`/stats.json`** (`src/pages/stats.json.ts`), the raw bytes of
  `builds/<id>/congress/stats.json` passed through **verbatim**. The two copies
  must be byte-equal; the producer renders that file as
  `json.dumps(…, ensure_ascii=False, indent=2, sort_keys=True) + "\n"`, so the
  route must never parse and re-serialize. `test/post/http-status.test.ts` pins
  the served bytes, the emitted `dist/` bytes, and the canonical copy together.

Note for anyone running the gates on a CI runner: they are not runnable under a
bare `CI=1` (the data layer already refuses the newest-local-build fallback
there), and if the four-variable contract is supplied, the two builds that
deliberately use fixture inputs — `test/post/fixture-preview.test.ts` and
`test/post/entity-orchestration.test.ts` — hit the `POPULUS_TICKER_MAP` fixture
refusal and would need `CI` cleared in their child environment. Neither is a
shipping build; the production `dist/` leakage check stays as it is.

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
  register, verbatim. Root `/` is the Home page (RUN P3-2) — hero, a
  honesty-specimen card built from a real row in the build, the module grid
  with live stats, and the commitments strip.

## Deliberate deviations from the mockup, and why

The mockup is authoritative on layout, type and colour. It is **not**
authoritative where following it would remove honesty content — DESIGN-BRIEF §7
forbids exactly that ("if a mockup looks cleaner because a caveat disappeared,
it's wrong"). Three places where this implementation departs, each recorded so
it can be reconciled design-side rather than discovered later:

RUN P3-2 entries (4–17) follow the P3-1 entries (1–3); each carries its
measurement or contract citation.

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
4. **13F per-holder Filed/Lag/Shares columns and per-row document links are
   dropped** (holders page + the unified page's institutional section). The
   published aggregate (`src/populus/inst_agg.sql:72-86`,
   `agg_issuer_top_holders`) carries rank, cik, filer_name, issuer identity,
   summed `value_usd`, `security_count`, and flags — no per-holder filed date,
   lag, share count, or accession. The mockup's columns would have been
   fabricated. Per-row provenance is the G7 aggregate form ("derived ·§" →
   derivation footnote) plus a real EDGAR filer link; a printed caveat states
   the drop on both tables.
5. **The filer page's full holdings table is replaced by the position-changes
   table + a designed EDGAR link-out block.** M2-CONTRACT §3: per-filer
   holdings detail is "not served — link out to EDGAR". The changes table
   renders `agg_qoq_deltas` verbatim (producer-classified, Locked #8,
   `docs/qoq-presentation.md`).
   > **SUPERSEDED 2026-08-01 — still accurate for the code as it stands today.**
   > M2-CONTRACT §3 has been reversed by owner decision: per-filer holdings detail
   > **is** to be served (`docs/build/M2-8-holdings-publication-decision.md`). This
   > entry describes current behaviour and stays until RUN M2-8 task T8 restores
   > the designed holdings table; the EDGAR link then becomes provenance rather
   > than a substitute. The user-facing copy asserting the old rule lives at
   > `src/lib/ui.ts:1016` and must be replaced in the same task.
6. **Institutional tables carry a defined dual-date replacement stamp**
   (Locked #20): "quarter-end {period_of_report} · latest filing in build
   filed {latest_filed_date}" + a printed caveat that per-filer filing dates
   are not in the published aggregate — the G2 per-row dual-date rule is
   scoped to sources that publish both dates; this one publishes
   `period_of_report` plus a build-wide filed-date watermark
   (`src/populus/publish/manifest.py:56`).
7. **Registry counts are labeled as all-period values.** `agg_filer_registry`'s
   `position_count`/`total_value_usd` accumulate over every retained period
   (`src/populus/inst_agg.py:460-496` — no period predicate), so they render
   only with the "all periods on record ·§" label (/institutional index) or
   not at all; every period tile comes from `agg_filer_concentration`.
8. **The ticker→issuer join is a present-day mapping, † labeled** (G14,
   Locked #18): `company_tickers.json` parsed per `identity/bootstrap.py`
   semantics, matched only against entity-keyed aggregate issuers; unresolved,
   ambiguous (one ticker → two CIKs), or missing-map states render an honest
   refusal, never a name-match or a pick.
9. **The S7 banner's expected-filer coverage % is dropped** — no published
   source exists for it. The banner is calendar-derived (quarter-end + 45
   days vs the build's `generated_at`, Locked #17) and is suppressed when the
   module is absent.
10. **S6's starter caption reads "most-active in this build"** (was
    "most-viewed pages this build") — this site ships no analytics, so
    activity in the published corpus is the only honest ranking (Locked #5).
11. **The holders terminus attributes the top-N cut to Public Filings, not the SEC.**
    The mockup's "SEC aggregates publish only the top 25" does not describe
    this pipeline: the cut is `DEFAULT_TOPN` in `src/populus/inst_agg.py:44`,
    a Public Filings build parameter, and G3 requires naming the truncation's real
    author.
12. **[RESOLVED — ALPHA-UX B-7] The Asset column now ships.** `TXN_COLS`
    carries `asset`, `assetType` and `txnId` at `DATASET_VERSION` 2; no-ticker
    rows render the asset name as filed (with the source's asset-type value
    verbatim — the client never classifies), and every payload embeds the
    version so a stale cached dataset is refused rather than half-read.
13. **Home's "Run the MCP server" CTA is dropped** — no public destination
    exists this run (the repo is not yet published); the commitments copy
    retains the MCP mention.
14. **Methodology's privacy section says "no analytics of any kind."** The
    mockup's "cookieless page counts (paths, referrers, coarse geography)"
    line described analytics this site does not have and must not claim.
15. **QoQ chips carry no percentages.** The producer publishes `change_kind`
    plus integer deltas; a percent-of-position is not in the aggregate, and
    the chip vocabulary is producer-authoritative (Locked #8).
16. **The filer page has no watch star.** The watchlist v2 store holds
    members and tickers only (Locked #16); a star that could not persist
    would be a lie. (S6 starters likewise draw from members + tickers.)
17. **Methodology numbers with no stats key are dropped or replaced**
    ("1,475 passing", "refreshed nightly", "live since 2026-Q3", the M2
    sample tiles): every remaining tile names its `stats.json` key
    (`methodologyM1Tiles`, asserted by test), M2 renders from the module's
    own manifest watermarks or states absence, and cadence claims are
    replaced by the build stamp.

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

### RUN P3-2 decisions

- **The G1–G7 components are pure string renderers in `src/lib/format.ts`**
  (RangeBand→`rangeBand`, DualDate→`dualDate`, FlagTag→`flagTags`,
  TerminusRow→`terminusRow`, FootnoteBlock→`footnoteBlock`, SrcLink→`srcLink`,
  StatBadge→`statTiles`) — one implementation each (grep-enforced by test),
  consumed by the feed, every entity page, and the client driver. `.astro`
  wrappers were rejected: forked render paths break byte-parity verification.
- **Entity pages render through pure body functions in `src/lib/ui.ts`**,
  called by thin `.astro` pages for SSR and by the `/e/` client driver —
  parity by construction, one function, two callers.
- **The watchlist store is versioned v2** (`populus:watch:v2`,
  `{v:2, members:[], tickers:[]}`): one-time validated migration from the
  legacy bare array, corrupt-storage quarantine to `populus:watch:v2.corrupt`,
  and legacy write-through of the member array until the P3-1 reconciliation
  merge (then remove the write-through — tracked debt).
- **Institutional pages bind to the published `inst_agg.sql` schema with
  period-correct sourcing**: registry = identity only; period tiles from
  `agg_filer_concentration`; changes from `agg_qoq_deltas` with the
  producer-authoritative presentation mapping fixed in
  [docs/qoq-presentation.md](docs/qoq-presentation.md). NULL integers render
  em-dash (never 0), disclosed zeros print 0, undisclosed sides render the
  hatched `n/c`.
- **Ticker→issuer resolution is an explicit build input** (`POPULUS_TICKER_MAP`
  → SEC `company_tickers.json`), parsed with the pipeline's own dispositions
  (malformed / DC1 title-conflict / duplicate), ticker-direction ambiguity
  rejected, matched only against entity-keyed issuers — the RUN M2-4 MCP
  precedent, applied to static paths and the unified page's 13F section. The
  **deployed** site currently carries no map at all (TD-7), so those surfaces
  render the no-map state; `test/pages-render.test.ts` drives that chain end to
  end, because every other suite runs with the dev fixture loaded.
- **The institutional happy paths are proven by a nonshipping fixture
  envelope** (`test/fixtures/make-inst-preview.py`, Locked #19): an
  identity-seeded corpus through the real `build_inst_agg`, wrapped in a
  manifest extended per `populus.publish.manifest` policy and validated by
  `validate_manifest`; `test/post/fixture-preview.test.ts` builds
  `dist-fixture/` from it and pins both happy-path URLs plus the
  production-leakage check. Manual institutional QA runs against this preview.
- **Holders-table sorting ships dormant on production data** (R48): the
  per-filer holdings table sorts, announces state through `aria-sort`, and
  carries the partial-sum caveat — but the **deployed** site renders no rows for
  it. Measured against live at `20260820.2`: `data-sort=` x0 and
  `data-holders-body` x0. **The table needs no code change** to light up; it
  needs entity-resolved issuers, and there are none.
  **Do not read the institutional index as proof this shipped** — it sorted on
  four columns before R48 (`data-inst-sort` x4 on live at `318dea5`), so its
  sorting is not evidence of this deploy. R48's only production-visible effect
  is that the index's sort headers became 44x44 tap targets; the `▾`/`▴`
  indicators are scoped to `th[data-sort]` and stay dormant with the table.
- **Why no issuer is entity-keyed, measured rather than assumed.**
  `_issuer_key` prefers `entity:<id>` and falls back to `cusip6:` only when
  `entity_link_state != 'resolved'`. On the 21 GB institutional store
  (16,922,879 `inst_holdings` rows, 24,929 distinct securities):

  | measure | value |
  | --- | --- |
  | securities with `entity_link_state='resolved'` | **0 of 26,158** |
  | securities with a non-empty `entity_candidates` | **0 of 26,158** |
  | securities with `id_state='provisional'` | 26,158 of 26,158 |
  | holdings rows with no `security_id` at all | 127,594 (0.75%) |

  So the fallback is universal, and nothing has ever even been *proposed* as a
  candidate. **This is not TD-7 alone.** Candidates are stamped by
  `apply_entity_candidates`, fed from `ticker_index.get(observation.symbol)`,
  and production sets `POPULUS_TICKER_MAP` to a deliberately absent path — but
  supplying that registry would still not resolve these, because 13F securities
  are provisional `sec:prov:<hash>` identities carrying no ticker observation
  for the index to match. Closing this needs a CUSIP→issuer bridge, which is
  gated by the `cusip-redistribution` counsel question, not a build input.
  Treat the ticker registry (TD-7) and this as related but **not** the same
  blocker: fixing TD-7 alone leaves this table empty.
- **Long-tail/out-of-extract entities ride `/e/` (HTTP 200)** per
  ARCHITECTURE §12.1; `404.astro` stays a plain 404; the served status
  contract is pinned by `test/post/http-status.test.ts`. The budget walk cuts
  by rank (members then tickers), every cut entity keeps its endpoint, and
  every listing link becomes `/e/?k=…` — proven under a forced cut by
  `test/post/entity-orchestration.test.ts`, which also executes the real
  client driver over `dist-cut` bytes through the full S4 failure taxonomy.
- **Global search owns `#site-search`** (the feed island unhooked it): lazy
  same-origin index fetch, "/" focus, Esc close, grouped combobox results;
  the index's field allowlist and ≤128 KiB budget are asserted post-build.
- **The masthead footer copy now reads "no account required"** (was "no
  accounts") per the monetization guardrail — convenience layers may someday
  exist; the data never gates.

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

### Review history

Two rounds of independent QA, both actioned in full.

**Round 1** on `edf15f9` — 2 blockers, 8 majors, 12 minors, 3 nits. The
blockers: a pagination boundary that dropped paper filings no transaction
preceded, and a mobile fold that deleted the row-level honesty layer.

**Round 2** on `47cb8eb` — 0 blockers, 2 majors, 6 minors, 5 nits. Both majors
were *introduced by round 1's own fixes*, which is worth recording:

- `pageCount(txnCount, paperCount)` was one page short when the transaction
  count was an exact multiple of 50 and a paper row trailed — that row was on
  no page at all, while the count line asserted it existed. The lesson is in
  the signature: **how many pages exist depends on where the paper rows sit,
  which counts cannot express.** Replaced by `pageCountFor(merged)`, a walk
  over the merged feed, and verified by an exhaustive sweep (1,161
  count × paper-position combinations, every item reachable exactly once, no
  page in range empty).
- the new "N amount not comparable" disclosure reached only a
  desktop-visible element and a visually-hidden live region, so a phone reader
  filtering to ≥$5M saw "11 of 11 transactions" and could not learn that 73
  rows were incomparable. Same fold failure as round 1's blocker, one
  breakpoint narrower. Fixed structurally: `feedCountText()` assembles **one**
  string that every sink receives, and `.filter-count` is no longer hidden at
  ≤720px — which also restored the "filtered on this device" privacy statement
  and the only reset control on mobile.

Both fixes are covered by tests, including the multiple-of-50 boundary the
round-1 suite passed only by fixture accident.

**Round 3** on `11ba04a` — **PASS.** 0 blockers, 0 majors, 1 minor, 4 nits. The
minor was a third defect in the same mechanism: on the page that round 2's fix
made reachable, the count rendered `51–50 of 50 transactions`, because the range
was computed from `page × PAGE_SIZE` rather than from what the page holds.

Three rounds of defects in one mechanism met the threshold in a standing project
lesson (*specify before rewriting*), so before touching it a fourth time the
invariants were written down: **[docs/pagination-and-counts.md](docs/pagination-and-counts.md)**.
The diagnostic signature is recorded there — every one of the three defects was
a function reasoning about *where items sit on a page* from parameters that only
described *how many items exist*. The fix then followed from invariant I5:
`CountInputs` carries `txnOnPage` alongside `paperOnPage`, and a page holding
only trailing paper filings says so in words instead of inverting a range. The
test helper now asserts four invariants per configuration (exactly-once, no
empty page in range, order preserved across page boundaries, no inverted range)
rather than one.

Remaining nits were also cleared: the dead `PAGE_SIZE` import that had put a
permanent hint on the typecheck gate, a duplicated selector, the mobile reset
control's touch target, and the desktop filter bar's incidental second row —
now a deliberate one, since the count line carries fragments the mock's
single-row bar was never sized for.

## Deferred / follow-ups

- Filter state ↔ URL synchronisation (shareable filtered views)
- First real-institutional-build QA pass (M2-6 in flight): the adapter is
  fixture-proven; live verification waits for the first published
  `inst_agg.db`
- Watchlist legacy write-through removal after the P3-1 reconciliation merge
- A producer-published ticker-mapping artifact (replacing the build-input
  snapshot); `TXN_COLS` v2 with `asset_name`
- Lighthouse ≥90 CI gate + an automated axe/Lighthouse a11y assertion over
  `dist/` at 375px and desktop in both themes; plus the §12.1 deploy workflow
  (`wrangler`, inventory, record-sign) and its `_headers`/CSP — phase-gate
  items for P3 completion, not per-page work
- A lint/format surface (no eslint/biome/prettier config here yet)
- **A DOM-level test surface.** `src/lib/format.ts` is fully covered, but
  `src/scripts/feed-client.ts` needs a DOM and has none. The count assembly and
  the amount-verdict partition were extracted into `format.ts` precisely so
  they could be tested without one; the empty/failure state machine still
  cannot be. Note also that the mobile-fold regression tests assert **markup**,
  so they cannot see CSS — a future `display:none` in the ≤720px block would
  pass every test. The deferred axe/Lighthouse gate is what actually protects
  it; until then that protection is a review obligation, not coverage.

## The design handoff

The mockups live in the Claude Design project **"UI Mockups for Project"**
(`1edc8435-2597-4222-b30c-647b0a20d66e`), readable with the design MCP
(`DesignSync` → `list_files` / `get_file`). `Populus Design System.dc.html` —
the token and component source of truth — is snapshotted in
[`docs/design/handoff/`](../docs/design/handoff/) as fetched 2026-07-30, so the
token values this stylesheet claims to follow are reviewable in-repo. The
per-page mockups are not snapshotted; read them from the project.
