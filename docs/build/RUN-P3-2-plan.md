# RUN P3-2 — Full public dashboard frontend from the approved design handoff

`plan-v1` · transport `orchestrated-artifact` · rev 3 (post plan-review rounds 1–2) · repo `/Users/johnbaek/projects/Populus-p3-frontend` · branch `ws/p3-frontend-handoff` (observed; carries the P3-1 feed `edf15f9`+3 QA rounds plus the handoff import `85e56ae` and brief `2957b8e`). Governing brief: `docs/build/RUN-P3-2-brief.md`. Governing design spec: `docs/design/handoff/HANDOFF.md` + 12 `.dc.html` mockups. Governing data contracts: `docs/build/M2-CONTRACT.md` §3 (consumer-access matrix), `src/populus/inst_agg.sql` (published institutional aggregate schema), `src/populus/publish/manifest.py` (module/artifact/watermark envelope), and the RUN M2-4 identity precedent (`docs/build/RUN-M2-4-plan.md`: ticker→issuer resolution via `company_tickers.json`, G14-labeled).

## Goal and Success Criteria

Implement every remaining public dashboard surface in `dashboard/` from the approved design handoff: Home, Congress Member, unified + deep ticker pages, Institutional Filer, 13F Holders, Methodology, `/financials` `/macro` module shells, an `/institutional` landing, states S1–S7, global header search, and the ≤720px mobile fold — with the G1–G7 uncertainty grammar promoted into seven shared single-implementation components consumed by the existing `/congress` feed and every new page. Institutional surfaces bind to the **published aggregate contract** (`inst_agg.sql`) with **period-correct semantics** and a **locked ticker→issuer mapping contract** (Locked #18), never to mockup-shaped data the producer deliberately does not publish (M2-CONTRACT §3: per-filer holdings detail is "not served — link out to EDGAR").

Success =

1. All routes in **Scope** build statically from the real published build (dev build `20260724.3` verified locally), render at desktop + mobile, light + dark, with zero hardcoded stats.
2. The seven G-components exist exactly once each, and the P3-1 feed consumes them via a surgical diff (P3-1 QA continues in parallel on `feat/p3-congress-feed` in the main checkout — merge friction must stay low).
3. The two standing deviations hold: the mobile fold removes no honesty content (enforced by a CSS-prohibition gate, not just markup assertions), and `--ink3`/`--hatch` keep the corrected WCAG-AA values in `dashboard/src/styles/global.css:23,52,75`.
4. Gates green: `make test` (pytest via uv, frozen lockfile — `Makefile:22-23`), `uv run python scripts/dep_guard.py` (`Makefile:28-29`), and `npm test` in `dashboard/` — which is **`node --test "test/*.test.ts"`** (`dashboard/package.json:15`), *not* vitest; the brief's "vitest" label (`docs/build/RUN-P3-2-brief.md:90`) is a documentation error this plan corrects rather than obeys. Post-build checks run via a new `test:post` script sequenced **after** `astro build` inside `npm run gates` (explicit ordering — never against an incidental stale `dist/`).
5. Every requirement R1–R20 below has a task, a verification check, and a DoD entry.

## Requirements

- **R1 — Shared G1–G7 components, one implementation each.** Canonical exported renderers `rangeBand` (G1), `dualDate` (G2), `terminusRow` (G3), `flagTags` (G6), `footnoteBlock` (G5), `srcLink` (G7), `statTiles` (StatBadge) in `dashboard/src/lib/format.ts`, promoted from the feed's existing inline implementations; the feed (`dashboard/src/pages/congress/index.astro`, `dashboard/src/scripts/feed-client.ts`) adopts them with a minimal diff.
- **R2 — `/` Home** per `Home.dc.html`: hero + verbatim copy blocks, honesty-specimen card (built from a real row in the build, not the Pelosi sample), module grid with live stats from `stats.json`/manifest (absent modules render honest absence, never sample numbers), commitments strip.
- **R3 — `/congress/members/{bioguide}`** per `Congress Member.dc.html`: breadcrumb, entity header + watch star ("watching · saved on this device"), stat strip (filings incl. paper, txns, T12M disclosed-flow *range*, median lag, late count), quarterly disclosed-flow ribbon (div-drawn, zero-based, gaps stay gaps — C1–C7), most-disclosed tickers with `§` footnote, full txn table (Filed▾ default sort, paginated via the existing spec'd mechanism), member's needs-OCR paper filings (S5 treatment).
- **R4 — `/tickers/{ticker}`** unified per `Ticker Unified.dc.html`: search-first masthead emphasis, entity header + star, stat tiles, section index (Congress n · Institutional · Financials SOON · Macro SOON), congressional members+filings cards, 13F top-holders section — populated only when the ticker resolves through the Locked #18 mapping AND the issuer is entity-keyed in the aggregate; otherwise the section renders the honest unresolved/absent state (issuer-name browse hint, mirroring the M2-4 MCP behavior), never a guessed join — with truncation terminus and planned-section placeholder cards.
- **R5 — `/congress/tickers/{t}`** deep view per `Congress Ticker.dc.html`: two-sided quarterly ribbon (purchases above axis / sales below, hatch overlay when a quarter's bound rests on unparsed amounts, with the printed % caption), members-disclosing table, recent-disclosures table with pager, `v_default_transactions` exclusions footnote.
- **R6 — `/institutional/tickers/{t}/holders`** per `Ticker Holders.dc.html`, **bound to `agg_issuer_top_holders`** (`inst_agg.sql:72-86`) **via the Locked #18 ticker→issuer contract**: static paths are generated only for tickers that resolve to an entity-keyed issuer present in the aggregate; period selector chips, stat tiles, holders table with exactly the published columns — rank, filer (link), summed `value_usd`, `security_count`, per-row `flags`, `issuer_key_source` disclosure — the mapping's present-day nature carries a `†` G14 label; source-truncation terminus (top-N is a build parameter, attributed to Populus per G3); 13F-caveat footer. The mockup's per-holder Filed/Lag/shares/doc-link columns are **not published in the aggregate** (verified: no such columns in `inst_agg.sql`) → dropped with a printed caveat line and a register entry; the table's as-of stamp is the R15 institutional form (quarter-end + module filed-date watermark); per-row provenance is the G7 aggregate form ("derived ·§" → build digest + EDGAR filer link), never a fabricated document link.
- **R7 — `/institutional/filers/{cik}`** per `Institutional Filer.dc.html`, **bound to the published aggregates with period-correct sourcing**: "What a 13F is — and is not" explainer, period selector; **all period-scoped tiles (positions, reported value, null-value positions, top-N share, HHI) come from `agg_filer_concentration` for the selected period** (`inst_agg.sql:92-103`) — NULL → "n/a ·§" never 0; `agg_filer_registry` supplies only identity + `latest_period` (its `position_count`/`total_value_usd`/`unkeyed_positions` are cumulative across ALL retained periods — `inst_agg.py:460-496` accumulates without a period predicate — so they are either omitted or explicitly labeled "all periods on record ·§", never presented as a quarter's value); position-changes table from `agg_qoq_deltas` (change_kind chips per Locked #8, prev/curr/delta value + shares NULL-honest, put_call + ssh_prnamt_type grain disclosed, flags), below-threshold/topn terminus. The mockup's full holdings table is contractually unservable (M2-CONTRACT §3) → changes table + designed EDGAR link-out block, registered with the contract citation. Changing the period selector changes every period-scoped number (test pins two periods with different totals).
- **R8 — `/methodology`** per `Methodology.dc.html`: per-module sources & conditions, M1 tiles wired to `stats.json` keys that exist (`totals.*`, `default.*`, `freshness.*` — observed schema `tests/schemas/stats.schema.json:6-14`), M2 section rendering honest absence when the module is not in the build, publication/verification block with the real `build_id` + manifest sha, privacy + required notices. Mockup numbers with no live source are dropped/reworded, registered as deviations.
- **R9 — Module shells**: `/financials` and `/macro` per `Module Shells.dc.html` (caveats-committed boxes; the macro concept sketch is explicitly "for later" and is NOT built), plus `/institutional` landing that fixes the currently-404ing masthead nav link (`dashboard/src/layouts/Base.astro:54-60`).
- **R10 — States S1–S7 wired into their owning surfaces**: S1 module-absent/withheld page at `/institutional` + inline module-absent blocks (Home card, unified ticker section, Methodology M2); S2 out-of-extract entity on the **generic entity route** with primary-source CTA (EDGAR for filers/tickers, bioguide profile for members); S3 filter-empty (already live on the feed — verify only); S4 client-shard skeleton on the generic entity route (shell paints first, endpoint path shown) **with a complete failure-state taxonomy** (network error, HTTP 5xx, malformed/version-mismatched payload, renderer failure → distinct honest error block with retry + raw-endpoint link; the skeleton is never indefinite) **and an executable client-orchestration harness** (R19) covering the full happy path and every failure branch; S5 needs-OCR detail block (feed rows exist; add member-page filings block); S6 empty-watchlist as the search overlay's pre-query state (Locked #5); S7 filing-window-open banner **computed from the calendar** (13F window: quarter-end +45d vs build `generated_at`), suppressed when the module is absent; the mockup's expected-filer coverage % has no published source → dropped, register entry.
- **R11 — Global header search** per `HANDOFF.md:93-97`: build-time index endpoint from the build's entities, same-origin lazy fetch on first focus, "/" focuses (except while typing in inputs), Esc closes, grouped results Tickers · Members · Filers, keyboard navigable with combobox ARIA, free text never leaves the device; **exact payload field allowlist + serialized-size budget asserted in tests**; the feed island's private use of `#site-search` (`feed-client.ts:64,183-188`) is unhooked (anticipated by `dashboard/README.md:161-163`).
- **R12 — Mobile fold ≤720px** per `Mobile.dc.html` for all new surfaces: two-line entity cards reusing the feed's fold classes, wide 13F tables scrolling inside their container with sticky identity column + edge fade, pinned filter chip row where applicable, tap targets ≥44px — under the standing SS4 deviation: nothing honesty-bearing (filed date, lag, owner/partial qualifiers, flags, SRC) is removed; it folds, wraps, or goes visually-hidden-but-announced, never `display:none`. **Enforced two ways:** (a) markup assertions that honesty elements are present in fold-mode card markup; (b) a deterministic CSS-prohibition test that parses every ≤720px media block in `global.css` and fails if any honesty selector (enumerated allowlist) receives `display:none`/`visibility:hidden`/`content-visibility:hidden`; plus a recorded per-surface accessibility-tree audit in QA.
- **R13 — Tokens**: handoff token block copied exactly except the corrected `--ink3` (`#6b6659` light / `#948e7e` dark) and `--hatch` ink values already shipped (`global.css:23,38,52,64,75`); type scale, spacing, radius, hairline rules per `Populus Design System.dc.html` §04.
- **R14 — Zero hardcoded stats**: every number renders from `stats.json`, `manifest.json`, `congress.db`, the institutional aggregate DB (when present), or the Locked #18 mapping input via `dashboard/src/lib/data.ts`; institutional absence degrades to S1/S2; no mockup sample literal ships (test-enforced).
- **R15 — G1–G7 + C1–C7 semantics on all new surfaces**: sums of ranges render as ranges via a **typed `sumRanges` result** (distinguishes empty / all-undisclosed / partially-disclosed / closed / open-bound aggregates; an all-unparsed aggregate renders hatched "not disclosed", never a fabricated `$0+`; the hatch/caption percentage is `undisclosed_rows / total_rows`, count-based), em-dash = absent-in-source ≠ 0 and 0 prints 0, hatch = source-undisclosed, `†/‡/§` markers resolve to printed footnote lines (no tooltip-only channel), **dual dates (G2) scoped to sources that publish both dates**: congressional tables show traded+filed+lag as today; institutional tables — whose published aggregate carries `period_of_report` but no per-row filed date (`inst_agg.sql:45-85`) — show the defined replacement stamp: "quarter-end {period_of_report} · latest filing in build filed {manifest inst watermark `latest_filed_date`}" plus a printed caveat that per-row filing dates are not in the published aggregate (register entry; propagated to R6/R7, Verification, DoD), and never say "current holdings" (HANDOFF G2); LATE chip past 45d on congressional rows; terminus rows name the truncation author; SRC receipt column everywhere (aggregate rows use "derived ·§"); QoQ presentation is **producer-authoritative** (Locked #8); charts zero-based, gaps stay gaps, no sparklines/midpoints; footnotes and honesty content survive print.
- **R16 — Real `<table>` semantics** (caption + `th scope`) on every new tabular surface even though mockups use div grids; verify the P3-1 feed already complies and align it if not.
- **R17 — Deviation register**: every new deviation recorded with its measurement/citation in `dashboard/README.md`'s register (template + 3 entries at `dashboard/README.md:72-103`), including the contract-driven set fixed by this plan (filer holdings table → changes table + EDGAR link-out per M2-CONTRACT §3; holders Filed/Lag/shares columns dropped; institutional dual-date replacement stamp; registry cumulative-fields labeling; ticker-mapping present-day label; S7 coverage % dropped; S6 caption rewording).
- **R18 — Page chrome**: masthead variants (standard / search-first emphasis) and footer variants (standard §13107(c) / 13F-caveat swap on the two 13F pages) as props of the single `Base.astro`; live build stamps (`build {buildId} · code {codeSha}` + snapshot sha) on every page; court-record copy tone; monetization-guardrail wording ("no account required", never "no accounts ever").
- **R19 — Tests + gates**: `node --test` suites for every new pure function and renderer; executable QoQ presentation-mapping table (producer `change_kind` × flags); honesty-in-mobile-DOM markup assertions + the CSS-prohibition gate; SSR/client parity for entity body renderers; pagination invariants reused; **post-build suite (`test:post`, sequenced after `astro build` in `npm run gates`)**: HTTP-status contract test (`astro preview`: `/e/` 200, canonical 200, garbage 404) AND an **entity-client orchestration harness** — the client driver is written against injected `fetch`/DOM-adapter/timer seams and the harness executes it over **real built payload bytes from a dedicated forced-cut build** (`POPULUS_TEST_PAGE_BUDGET=<small> npx astro build --outDir dist-cut`, asserting cut-page-absent / endpoint-present / listing-links-`/e/` before traversal) through happy path (decode → body render → DOM apply → star wiring), every failure branch (404→S2, 5xx, network, bad-payload, version-mismatch, renderer-throw), retry, and watchdog; institutional loader tests against a **producer-built fixture aggregate DB** (`build_inst_agg` over an identity-seeded corpus per Locked #19); a **fixture-preview envelope** (Locked #19) makes the institutional happy paths buildable and previewable; mutation-verified per the specify-before-rewriting corollary; all three gates green. Residual real-browser DOM/event risk is an explicitly listed manual QA obligation, not silently assumed covered.
- **R20 — Accessibility**: WCAG 2.1 AA contrast with the corrected tokens, full keyboard paths (search combobox, period chips, expanders, star buttons), 2px focus ring, `aria-current` nav, party/side colors always word-accompanied, sr-only summaries for div-drawn ribbons, acceptable print output. Lighthouse a11y ≥95 stays a review obligation (no CI gate exists — none is added this run). Institutional surfaces get the same manual viewport/theme/print pass as congressional ones, **against the Locked #19 fixture-preview build** (which emits the filer + holders happy-path routes), since production builds currently publish no institutional module.

## Scope

Routes/endpoints added or changed (complete enumeration — failure-mode F1):

| Surface | Route | Source mockup |
|---|---|---|
| Home | `/` (replaces meta-refresh redirect) | `Home.dc.html` |
| Member | `/congress/members/{bioguide}` (114 in dev build) | `Congress Member.dc.html` |
| Unified ticker | `/tickers/{ticker}` (791 keys in dev build) | `Ticker Unified.dc.html` |
| Deep congress ticker | `/congress/tickers/{t}` | `Congress Ticker.dc.html` |
| 13F holders | `/institutional/tickers/{t}/holders` (paths = mapped entity-keyed issuers; 0 in dev, ≥1 in fixture preview) | `Ticker Holders.dc.html` |
| Filer | `/institutional/filers/{cik}` (0 static paths in dev; ≥1 in fixture preview) | `Institutional Filer.dc.html` |
| Institutional landing | `/institutional` (S1 when module absent) | `States….dc.html` S1 |
| Methodology | `/methodology` | `Methodology.dc.html` |
| Shells | `/financials`, `/macro` | `Module Shells.dc.html` |
| Generic entity route | `/e/` (S4 shard-render for in-extract long-tail, S2 for out-of-extract; HTTP 200 — Locked #3) | `States….dc.html` S2/S4 |
| 404 page | `/404` (plain not-found: search + module links; HTTP 404) | — |
| Entity data | `/congress/data/members/{bioguide}.v1.json`, `/congress/data/tickers/{key}.v1.json` | feed.v1.json precedent |
| Search index | `/search/index.v1.json` | `HANDOFF.md:93-97` |

Plus: the seven promoted components with feed adoption; global search client; watchlist v2 store + migration; ticker→issuer mapping input (Locked #18); fixture-preview envelope (Locked #19); mobile fold + print CSS; states S1–S7; tests incl. the post-build suite; `dashboard/docs/qoq-presentation.md` spec; README register entries.

Scope class: **L** — the brief (`docs/build/RUN-P3-2-brief.md:96-101`) sizes it as one orchestrated run on rails P3-1 laid, and mandates the sequencing this plan follows (specs → components → data → routes → states/search/mobile → verification). The items under **Non-goals** are the explicit follow-ups.

## Non-goals

- No rebuild of the `/congress` feed, `/legal/*` routes, `Base.astro` shell structure, tokens, or the data-layer contract; feed files change only to adopt promoted components, the shared watch util, and release `#site-search`.
- No public deploy and no deploy workflow. Site remains undeployed per `dashboard/README.md:156-160`.
- No Lighthouse/axe/DOM-harness CI gate (stays deferred per `dashboard/README.md:254-261`); the CSS-prohibition test and the orchestration harness are static/injected-seam gates, not browser harnesses; real-browser verification remains a listed manual obligation.
- No accounts, paid-tier UI, analytics, tracking, or cookies; watchlist stays localStorage-only.
- No backend/pipeline changes: `stats.json` schema, DB views, `inst_agg.sql`, `manifest.py`, and the pipeline's own extracts are fixed inputs. The fixture aggregate and fixture-preview envelope are **built by existing producer code + a nonshipping assembly script** — no producer edits. No institutional publish work (M2-6 runs in parallel).
- No macro concept-sketch implementation (`HANDOFF.md:88`).
- No new npm dependencies (dep_guard doesn't police npm — `scripts/dep_guard.py:33,95-128` is Python-only — but DESIGN-BRIEF §7 forbids client-heavy kits and nothing here needs one). `package.json` gains scripts only (`test:post`, gates reorder), no deps.
- No re-litigation of the standing deviations (`docs/build/RUN-P3-2-brief.md:57-72`).

## Constraints

- Static Astro output (`dashboard/astro.config.mjs`: `output:"static"`, directory format, `site` deliberately unset — all fetches same-origin relative).
- One published data build: dev fallback = newest `builds/<id>` under `../populus-data` (`data.ts:89-109`); CI requires `POPULUS_BUILD_DIR`+`POPULUS_DB` and refuses the fallback (`data.ts:77-88`). `node:sqlite`, Node pinned 24.16.0, no native deps.
- Institutional consumer contract: M2-CONTRACT §3 — dashboard gets aggregate slices (`inst_agg.db` per `inst_agg.sql`; the module's single artifact per `manifest.py:52-56` with watermarks `latest_period_of_report` + `latest_filed_date`); per-filer holdings detail is **federated to EDGAR, never served**. NULL-honest integer columns; flags are canonical sorted JSON arrays. `agg_filer_registry` totals are cumulative all-period values; period-scoped numbers live in `agg_filer_concentration`.
- Identity: `inst_agg.db` deliberately carries **no ticker/identity registry** (RUN M2-4 decision record); ticker→issuer resolution follows the M2-4 precedent — `company_tickers.json` (SEC primary source, public domain) parsed per `identity/bootstrap.py:353` semantics, `issuer_key = 'entity:cik:<cik>'`, present-day mapping G14-labeled, unresolved → honest state. The dashboard admits it as an explicit provenance-checked build input (Locked #18), never a guessed name/derived-key join.
- Page/file budgets: ARCHITECTURE §9.10 (≤4,000 module-1 pages), §12.1 (15,000 global; **generic client-rendered route** for in-extract beyond-budget entities; primary-source link-out for out-of-extract). Dev counts (114/791/0) sit far inside every budget.
- SSR/client byte-parity is a tested invariant (`format.test.ts:520-531`); renderers must remain pure string functions usable by both sides.
- Pagination/count logic is governed by `dashboard/docs/pagination-and-counts.md` (I1–I6); reused unchanged.
- Fonts self-hosted via `@fontsource` (`Base.astro:4-10`); no external requests anywhere (the mapping input is a build-time file, not a fetch).
- P3-1 QA continues in parallel on `feat/p3-congress-feed` in the main checkout: keep diffs to `pages/congress/index.astro`, `scripts/feed-client.ts`, and `format.ts` minimal and mechanical.
- Gates (exact, complete — F1 gate-list): `make test`, `uv run python scripts/dep_guard.py`, `cd dashboard && npm test`; plus `cd dashboard && npm run gates` — re-sequenced this run to `check && test && build && test:post` so post-build checks always run against the just-built `dist/`.
- Copy: court-record tone, no emoji/hype; §13107(c) + not-financial-advice footers; "the data is free forever" never "everything free forever".

## Current State

- `dashboard/` is ~10 source files; **no components directory exists**. The G-patterns live as pure string renderers in `dashboard/src/lib/format.ts` and CSS in `global.css`: band geometry `bandGeometry` (`format.ts:127-136`) + band markup inline in `txnRowHtml` (`format.ts:494-496`); dual dates `tradedText` (`:211-214`) + `lagHtml` (`:449-460`); flags `FLAG_PRESENTATION`/`flagChips` (`:218-248`); SRC `srcCellHtml` (internal, `:405-415`); footnote block hardcoded in `pages/congress/index.astro:171-176` with `†`/`‡` only; stat tiles markup inline in `index.astro:58-67` over `StatTile` data (`data.ts:32-38`, `buildTiles` `:224-280`). **TerminusRow (G3) does not exist anywhere.**
- `data.ts` is congress-only and memoized (`getBuildData` `data.ts:286-364`): reads `congress/stats.json`, `manifest.json`, `DATA-LICENSE.md`, `NOTICE`, and queries `v_default_transactions` + needs-OCR filings from `congress.db` (`loadRows` `:122-187`), emitting the columnar `/congress/data/feed.v1.json` dataset. It throws loudly on absent coverage keys (`:231-235`) — the established honest-degradation precedent. Its env surface today is exactly `POPULUS_BUILD_DIR`/`POPULUS_DB`/`POPULUS_DATA_REPO` (`data.ts:6-11,71-109`) — the mapping input and fixture-preview envelope extend this surface explicitly (Locked #18/#19).
- Existing routes: `/` (meta-refresh → `/congress/`), `/congress`, `/congress/data/feed.v1.json`, `/legal/*`. Masthead nav already links `/institutional/` and `/methodology/`, which 404 today.
- Verified dev build `20260724.3` (`~/projects/populus-data`): `congress/` module only — 114 members, 786 pipeline ticker slices vs 791 extract tickers, 3,911 default rows; `manifest.json.modules` contains only `congress`; zero institutional tables. `members` columns: `bioguide_id, full_name, chamber, party, state, district, terms, raw`.
- **The institutional aggregate contract exists in-repo**: `src/populus/inst_agg.sql` defines the five published tables with NULL-honest integer semantics and canonical flag arrays; `inst_agg.py` computes `change_kind ∈ {new,add,trim,exit,unclassified}` + flags (`value_undisclosed_one_side`, `shares_unit_mismatch`, `classified_by_value`, `change_kind_undeterminable`, `identity_reconciled_by_cusip`) — the producer owns QoQ classification. **Registry totals are cumulative** (`inst_agg.py:460-496` — no period predicate); per-period totals live in `agg_filer_concentration`. The aggregate carries **no ticker and no per-row filed date**; the module manifest publishes watermarks `latest_period_of_report` + `latest_filed_date` (`manifest.py:56`). M2-CONTRACT §3 excludes per-filer holdings detail. Committed real fixtures exist (`tests/fixtures/inst/real/CIK0001067983`, 4 Berkshire filings / 314 holdings, multiple periods); `build_inst_agg` builds a real-schema fixture aggregate; `identity/bootstrap.py:353 load_company_tickers` + a committed fixture at `data-cache/inst/registry/company_tickers.json` (`cli.py:421`) give the ticker→CIK primary-source path the M2-4 MCP already uses.
- The mockups are DC-runtime files; `support.js` is a disposable generated framework. Band geometry matches the shipped `bandGeometry`. The masthead search dropdown is unbuilt (prose spec only). The mobile mockup drops honesty elements by omission — the standing SS4 deviation applies. The Institutional Filer/Holders mockups show columns the published contract does not serve — resolved by R6/R7 + register entries.
- Watchlist storage today is a bare member-id array under `populus:watch:members` (`feed-client.ts:44`) — superseded by Locked #16.
- Test harness: `node --test` over `dashboard/test/*.test.ts`; no DOM harness, no vitest. `npm run gates` today = `check && test && build` (`package.json:16`) — re-sequenced by this run (Constraints).
- No `AGENTS.md`/`CLAUDE.md`; no CI runs the gates. Register + decisions live in `dashboard/README.md:72-166`.

## Detected Stack

- **Languages:** Python 3.12 (`pyproject.toml` at repo root), TypeScript + Astro (`dashboard/package.json`, `tsconfig` extends `astro/tsconfigs/strict`).
- **Python runner:** `uv run …` (`uv.lock`; `Makefile:17-29`).
- **Node runner:** `npm run <script>` (`package-lock.json`); Node 24.16.0 pinned; `node:sqlite` for build-time DB reads.
- **Test frameworks:** pytest (`pyproject.toml:35-36`); **`node --test` + `node:assert/strict`** (`dashboard/package.json:15`). No vitest, no DOM harness.
- **Framework:** Astro 7 static (`astro@^7.1.6`), zero UI libraries; fonts via `@fontsource/*`.
- **Linter/typecheck:** `astro check` via `npm run check`; no eslint. Python side ships no lint gate in `make` (not detected — do not invent one).
- **Canonical commands:** `make test`, `make security`, `cd dashboard && npm run gates` (re-sequenced to `check && test && build && test:post` this run).

## Reuse Map

| Existing asset | Decision | Why |
|---|---|---|
| `format.ts` string renderers + `esc` + types | **Reuse/extend** — the seven canonical components are extracted here | SSR/client parity is byte-tested; `.astro` can't render inside islands (Locked #1) |
| `bandGeometry`/`amountText`/`fmtMoney`/`amountVerdict` (`format.ts:87-136,259-272`) | Reuse as-is under `rangeBand` | Matches mockup B-maps; tested |
| `tradedText`/`lagHtml` (`format.ts:211-214,449-460`) | Extract into `dualDate` | Already implements G2 incl. negative-lag anomaly |
| `flagChips`/`FLAG_PRESENTATION` (`format.ts:218-248`) | Rename/export as `flagTags`; extend with the five producer institutional flags | Producer flags are source facts/parse defects in the same two visual classes |
| `srcCellHtml` (`format.ts:405-415`) | Export as `srcLink` | Scheme-allowlisted, tested |
| Feed footnote block (`index.astro:171-176`) | Generalize into `footnoteBlock` with `†/‡/§/n-c` registry | G5 needs `§` + derived markers |
| Stat tiles markup + `StatTile`/`buildTiles`/`pct` | Extract markup into `statTiles` | One tile grammar site-wide |
| `mergeFeed`/`pageSlice`/`pageCountFor`/`feedCountText`/`PAGE_SIZE` (`format.ts:276-386`) | **Reuse unchanged** | `pagination-and-counts.md` is normative |
| Columnar codec `TXN_COLS`/`PAPER_COLS`/`*ToArray`/`*FromArray` | Reuse for per-entity endpoints (+`v` version field) | Same contract as `feed.v1.json` |
| `loadRows` one-pass DB query (`data.ts:122-187`) | Reuse; group per entity in memory | 3,911 rows — no per-entity SQL |
| **Producer QoQ classification** (`inst_agg.py`) | **Consume as authoritative — never reclassify** | One owner for business logic (Locked #8) |
| **`inst_agg.sql` published schema** | Bind loader + TS types directly; period-correct sourcing per table (registry=identity, concentration=period tiles) | The contract exists, is digest-stable, git-tracked |
| **`identity/bootstrap.py` `load_company_tickers` semantics + `data-cache/inst/registry/company_tickers.json` fixture** | Mirror the parse/normalize rules in the build-time mapping input; parity-test against a committed fixture | M2-4 MCP precedent: ticker→CIK→`entity:cik:<cik>`, G14-labeled (Locked #18) |
| **`build_inst_agg` + the resolved mini-corpus pattern (`tests/test_mcp_server_inst.py:52-85`) + `tests/fixtures/inst/mcp/company_tickers.json`** | Seed resolved identities, build the fixture aggregate with real producer code, reuse the existing mapping fixture; wrap in the Locked #19 preview envelope | Real schema, real classifier output, entity-keyed issuers, multiple periods; no fixture drift |
| **`manifest.py` module policy** (`INST_MODULE`, `REQUIRED_INST_ARTIFACTS`, `INST_WATERMARK_KEYS`) | Mirror exactly in the fixture-preview manifest and in the R15 institutional as-of stamp | The envelope must be structurally faithful; the watermark is the honest filed-date signal |
| `Base.astro` masthead/footer/theme | Extend with variant props | One shell (Locked #11) |
| `global.css` tokens + ≤720px fold | Reuse classes; append | Feed's fold already encodes honesty treatments |
| Watchlist store + `starHtml` | Supersede with versioned v2 + migration (Locked #16) | Bare array can't host ticker watches |
| `memberHref`/`tickerHref` (`format.ts:395-400`) | Reuse; retarget `tickerHref` to `/tickers/{t}/` | Locked #4 |
| Feed S3/S4 CSS | Reuse for the generic entity route | Same visual grammar |
| `tests/schemas/stats.schema.json` | Read-only reference for methodology tiles | Producer-side contract |
| Pipeline per-entity slices | **Do not consume** | Missing paper filings + member metadata; 786≠791 |
| `support.js` | **Do not port** | Generated mockup runtime |

## Architecture

**Rendering model (unchanged, scaled up).** Every page body that shows entity data is a pure string renderer (new `dashboard/src/lib/ui.ts`, composing `format.ts` components), called by a thin `.astro` page for SSR and by the generic-entity-route client driver for long-tail/out-of-extract paths. Parity is by construction — one function, two callers.

**Data flow.** `data.ts` gains one entity-assembly step over the existing single `loadRows` pass: group merged txn+paper rows by `bioguide_id` and by ticker key, join member metadata, and compute per-entity aggregates via pure functions in `derive.ts` (typed `sumRanges`, quarterly ranges, top tickers, median lag, late counts). `getStaticPaths` prerenders every entity in the extract; the budget walk discloses rank-cuts via `terminusRow` on listing surfaces and cut entities link to `/e/?k=…`. Each entity gets a columnar endpoint (`{v, t, p, meta}`).

**Institutional adapter (`inst.ts`).** Binds to `inst_agg.sql` verbatim (`number | null` semantics; canonical flag arrays). Discriminated absent/present on `manifest.modules` + DB presence. **Period-correct sourcing:** filer identity from `agg_filer_registry` (name, latest_period); period tiles from `agg_filer_concentration`; changes from `agg_qoq_deltas`; holders from `agg_issuer_top_holders`. Cumulative registry fields render only with the explicit "all periods on record ·§" label or not at all.

**Ticker→issuer mapping (Locked #18).** Build-time input `POPULUS_TICKER_MAP` (path to a `company_tickers.json` snapshot; dev default: the committed fixture path checked into this repo's test fixtures; CI: the publisher's cached snapshot). Parsed with rules mirroring `identity/bootstrap.py` (normalize CIK to 10 digits, normalize ticker); `issuer_key = 'entity:cik:<cik>'`; matched **only** against entity-keyed `agg_issuer_top_holders` rows. Unresolved ticker, missing map, or non-entity-keyed issuer → honest unresolved state with issuer-name browse hint (M2-4 MCP behavior). The mapping's present-day nature is G14-labeled (`†` footnote). Ambiguity (one ticker → multiple CIKs in the source) → deterministic rejection with the honest state, never a pick. Tests: parity against the committed fixture, ambiguity, rejected-mapping, fallback-key, absent-map.

**Module availability.** `manifest.json.modules` drives S1 surfaces and S7 suppression.

**Generic entity route (S2/S4) — Locked #3.** `/e/` is a prerendered page (HTTP 200); its client **driver** is a pure orchestration function over injected seams (`fetch`, DOM adapter with the `innerHTML`/`querySelector` surface the driver uses, timer): key parse → S4 skeleton → endpoint fetch → outcome classifier (ok / 404→S2-CTA / 5xx / network / bad-payload / `v`-mismatch / renderer-throw) → same `ui.ts` body renderer → DOM apply → star wiring; distinct honest error blocks with retry + raw-endpoint link; watchdog ends the skeleton. `404.astro` stays plain (HTTP 404). The driver's seams exist so the post-build harness can execute the real orchestration over real dist bytes (R19) — they are the same seams the browser entry uses with native `fetch`/DOM.

**Fixture-preview envelope (Locked #19).** `dashboard/test/fixtures/make-inst-preview.py` (nonshipping): (1) seeds a source DB with **resolved issuer identities before aggregation**, reusing the established mini-corpus pattern from `tests/test_mcp_server_inst.py:52-85` (AAPL/MSFT/NVDA securities linked `entity:cik:<cik>` with `link="resolved"`, Berkshire multi-period filings with QoQ timeline and the SH→PRN unit-mismatch case) — a raw-Berkshire-only build cannot emit `entity:` issuer keys (`inst13f.py:1143-1144` resolves CUSIPs only through pre-existing `security_identifiers`; `inst_agg.py:99-116` falls back to `cusip6:`/`name:`); (2) runs `populus.inst_agg.build_inst_agg` over that seeded source; (3) assembles a temp build dir: dev congress build artifacts + `inst_agg.db` + a manifest extended with the `inst` module entry exactly per `manifest.py` policy, watermarks (`latest_period_of_report`, `latest_filed_date`) **derived from the seeded source DB's filings**; (4) self-checks that the specific mapped issuer `entity:cik:0000320193` (AAPL via the reused `tests/fixtures/inst/mcp/company_tickers.json` mapping fixture) exists in `agg_issuer_top_holders` — failing loudly with remediation instructions if not (no silent skip); (5) prints the exact env/commands: `POPULUS_BUILD_DIR=<tmp> POPULUS_DB=<congress.db> POPULUS_TICKER_MAP=tests/fixtures/inst/mcp/company_tickers.json npx astro build --outDir dist-fixture` + `astro preview`; (6) the post-build fixture check verifies both happy-path URLs (`/institutional/filers/1067983/`, the AAPL holders page) are emitted and render institutional content, and the production `dist/` contains no fixture-derived paths. Manual viewport/theme/print QA for institutional surfaces runs against this preview.

**Search.** Index endpoint with exact field allowlist + ≤128 KiB budget; `search-client.ts` owns `#site-search` (lazy fetch, "/", Esc, groups, combobox ARIA, keyboard); pre-query = v2 watchlist quick links or S6 starters. `feed-client.ts` unhooks.

**Watchlist v2 (Locked #16).** `populus:watch:v2` `{v:2, members:[], tickers:[]}`; one-time validated migration from the legacy array; legacy write-through until the P3-1 reconciliation merge; corrupt-storage quarantine; full test set.

**Mobile fold.** Feed fold classes reused; 13F wide tables scroll in-container with sticky identity column + edge fade (all cells remain in DOM); stat strips reflow. Every fold decision checked against DESIGN-BRIEF §1 before CSS; the CSS-prohibition gate enforces the ban mechanically.

## Locked Decisions

1. **Components are pure string renderers in `format.ts`, not `.astro` files.** Names map: RangeBand→`rangeBand`, DualDate→`dualDate`, FlagTag→`flagTags`, TerminusRow→`terminusRow`, FootnoteBlock→`footnoteBlock`, SrcLink→`srcLink`, StatBadge→`statTiles`.
2. **Entity data from `congress.db` via the existing one-pass query, grouped in memory; dashboard emits its own columnar endpoints.** Pipeline slices not consumed (no paper filings, no member metadata, 786≠791).
3. **Long-tail + out-of-extract entities ride the prerendered generic entity route `/e/` (HTTP 200) per ARCHITECTURE §12.1; `404.astro` stays a plain 404.** HTTP-status test pins both.
4. **`tickerHref` retargets to `/tickers/{t}/`.** Feed diff is one function + test update.
5. **S6 lives in the search overlay's pre-query state**; starters build-derived; caption reworded to "most-active in this build" (register entry); quick links from the typed v2 watchlist.
6. **Institutional types bind to the published `inst_agg.sql` schema with period-correct table sourcing** (registry = identity + latest_period only; concentration = period tiles; cumulative registry fields labeled "all periods on record ·§" or omitted). `loadInstitutional()` returns honest absence for module-less builds.
7. **S5 is a shared needs-OCR block, not a new route.**
8. **QoQ classification is producer-authoritative; the frontend maps, never reclassifies.** `dashboard/docs/qoq-presentation.md` fixes the mapping (new/add/trim/exit chips; `unclassified`/unknown → fail-closed unclassified chip + dashed tag; `value_undisclosed_one_side` → hatched `n/c` on value delta; `shares_unit_mismatch` → em-dash shares + `‡`; `classified_by_value` → `†`; `identity_reconciled_by_cusip` → `‡`; NULL → em-dash never 0; disclosed 0 prints 0; unrecognized flags render as raw dashed tags). Every combination tested against fixture-aggregate rows.
9. **Corrected `--ink3`/`--hatch` values retained verbatim.**
10. **Test runner stays `node --test`; zero new npm dependencies.** `package.json` changes are scripts-only (`test:post`; `gates` = `check && test && build && test:post`). The brief's "vitest" is a label error (evidence: `package.json:15`), noted in Dev Notes.
11. **One `Base.astro`** with nav-active, search-emphasis, and footer-variant props.
12. **Entity txn tables reuse the feed pagination mechanism unchanged.**
13. **Prerender = all extract entities in dev; budget walk rank-cuts beyond consts**, cuts disclosed via `terminusRow` and cut entities linked to `/e/?k=…`. Because `POPULUS_TEST_PAGE_BUDGET` is build-time static-path input (it cannot retroactively cut an already-built dist), the forced-cut proof is a **separate isolated build**: `test:post` first runs `POPULUS_TEST_PAGE_BUDGET=<small> npx astro build --outDir dist-cut`, asserts the selected canonical page is absent from `dist-cut`, its data endpoint is present, and the listing surface links `/e/?k=…` — then the orchestration harness traverses that genuinely cut entity over `dist-cut` bytes. Normal `dist/` is preserved untouched for the status-contract and leakage checks.
14. **Home's honesty-specimen card renders a real row from the build.**
15. **Mockup numbers with no live source are dropped or reworded**; each a register entry.
16. **Watchlist store is versioned v2** with validated migration, legacy write-through until the reconciliation merge, corrupt-storage quarantine, full test set.
17. **S7 is calendar-derived** (quarter-end +45d vs `generated_at`), module-absence-suppressed; coverage % dropped (register entry).
18. **Ticker→issuer mapping is an explicit build input** (`POPULUS_TICKER_MAP` → `company_tickers.json` snapshot; dev default = committed fixture; CI = publisher's cached snapshot), parsed per `identity/bootstrap.py` semantics, matched only against entity-keyed issuers, G14-labeled (`†`), fail-honest on unresolved/ambiguous/missing — mirroring the locked RUN M2-4 MCP precedent (`inst_ticker_holders`). Name-matching and ticker-derived keys are rejected as identity guessing.
19. **Institutional happy paths are made buildable, previewable, and checkable by the nonshipping fixture-preview envelope** (`make-inst-preview.py`: resolved-identity seed per the `test_mcp_server_inst.py:52-85` precedent → producer-built fixture aggregate → manifest extended per `manifest.py` policy with watermarks from the seeded source DB → exact build/preview commands → self-check for the specific mapped issuer `entity:cik:0000320193` → emitted-URL verification → production-leakage assertion). The mapping fixture is the existing `tests/fixtures/inst/mcp/company_tickers.json` — no duplicate fixture is created.
20. **Institutional tables' time stamp is the defined dual-date replacement** (R15): "quarter-end {period_of_report} · latest filing in build filed {latest_filed_date watermark}" + printed caveat; the G2 dual-date rule is scoped to sources that publish both dates; propagated through R6/R7/R15, Verification, DoD, and the register.

## Alternatives Considered

- **`.astro` component wrappers for G1–G7** — rejected: forked render paths break byte-parity verification.
- **404.astro as the long-tail client router (rev 1)** — rejected on review: valid entities served HTTP 404; conflicts with §12.1. Replaced by Locked #3.
- **A frontend QoQ classifier (rev 1)** — rejected on review: producer already emits `change_kind` + flags with different precedence; a second classifier can only agree or drift. Replaced by Locked #8.
- **Mockup-derived institutional types (rev 1)** — rejected on review: `inst_agg.sql` is the published contract; mockup-shaped types encode unpublished data. Replaced by Locked #6.
- **Filer tiles from `agg_filer_registry` (rev 2)** — rejected on review: registry totals are cumulative all-period values (`inst_agg.py:460-496`); period tiles must come from `agg_filer_concentration`. Replaced by Locked #6's period-correct sourcing.
- **Ticker→issuer via issuer-name matching or ticker-derived keys** — rejected: identity guessing (G14); silent wrong-holder risk. Locked #18 admits the validated primary-source mapping instead — the same choice RUN M2-4 locked for the MCP.
- **Publishing a new ticker-mapping artifact from the pipeline** — rejected for this run: pipeline changes are a non-goal; the build-input path needs no producer edit and CI already caches the snapshot.
- **Adopt vitest/jsdom/puppeteer for client testing** — rejected: new dependencies against Locked #10; the injected-seam orchestration harness covers the client driver over real dist bytes, and real-browser residue is an explicit manual QA item (also declared in Tech Debt #3).
- **Serve the pipeline's per-entity JSON slices** — rejected: missing paper filings/member metadata; 786≠791.
- **Per-entity SQL in `getStaticPaths`** — rejected: 3,911 rows; one pass + grouping is simpler.
- **A dedicated `/watchlist` route for S6** — rejected: invents an undesigned surface.
- **Hard key-reconciliation gate (dashboard vs pipeline slices)** — rejected: sets legitimately differ.

## Planned Files

New:
- `dashboard/src/lib/derive.ts` — pure derivations: entity grouping, typed `sumRanges`, quarterly ranges (+count-based hatch fraction), top tickers, median lag, QoQ presentation mapping, S7 calendar window state, generic-route key parser, fetch-outcome classifier, search index build/filter/group, serving-since, ticker-map parse/normalize/resolve (Locked #18).
- `dashboard/src/lib/ui.ts` — pure page/section renderers incl. all state blocks and page bodies.
- `dashboard/src/lib/inst.ts` — institutional adapter: TS types mirroring `inst_agg.sql`, `loadInstitutional()` absent/present, period-correct accessors, flag-array parsing.
- `dashboard/src/pages/congress/members/[bioguide].astro`
- `dashboard/src/pages/congress/data/members/[bioguide].v1.json.ts`
- `dashboard/src/pages/tickers/[ticker].astro`
- `dashboard/src/pages/congress/tickers/[ticker].astro`
- `dashboard/src/pages/congress/data/tickers/[key].v1.json.ts`
- `dashboard/src/pages/institutional/index.astro`
- `dashboard/src/pages/institutional/filers/[cik].astro`
- `dashboard/src/pages/institutional/tickers/[t]/holders.astro`
- `dashboard/src/pages/methodology/index.astro`
- `dashboard/src/pages/financials/index.astro`
- `dashboard/src/pages/macro/index.astro`
- `dashboard/src/pages/e/index.astro`
- `dashboard/src/pages/404.astro`
- `dashboard/src/pages/search/index.v1.json.ts`
- `dashboard/src/scripts/search-client.ts`
- `dashboard/src/scripts/entity-client.ts` — generic-route driver (injected seams) + browser entry + shared watch-star wiring + watchlist v2 store/migration.
- `dashboard/test/derive.test.ts`, `dashboard/test/ui.test.ts`, `dashboard/test/inst.test.ts`, `dashboard/test/pages-render.test.ts`, `dashboard/test/search.test.ts`, `dashboard/test/css-fold.test.ts`
- `dashboard/test/post/http-status.test.ts`, `dashboard/test/post/entity-orchestration.test.ts`, `dashboard/test/post/fixture-preview.test.ts` — the `test:post` suite (runs after `astro build`; spawns `astro preview`; consumes real `dist/` bytes; orchestration harness under forced rank-cut; fixture-preview URL + leakage checks)
- `dashboard/test/fixtures/make-inst-preview.py` — the Locked #19 envelope builder (identity-seed per `test_mcp_server_inst.py:52-85`, then `populus.inst_agg.build_inst_agg`; producer code unmodified; mapping fixture reused from `tests/fixtures/inst/mcp/company_tickers.json` — no duplicate)
- `dashboard/docs/qoq-presentation.md`

Modified:
- `dashboard/src/lib/format.ts` — the seven canonical exports; producer-flag registry entries; `tickerHref` retarget.
- `dashboard/src/lib/data.ts` — entity assembly, endpoints (+`v`), search index, `moduleAvailability`, `POPULUS_TICKER_MAP` input, budget walk + `POPULUS_TEST_PAGE_BUDGET`, memoization preserved.
- `dashboard/src/layouts/Base.astro` — variant props; search-client mount.
- `dashboard/src/pages/index.astro` — redirect → Home.
- `dashboard/src/pages/congress/index.astro` — `statTiles`/`footnoteBlock` swap only.
- `dashboard/src/scripts/feed-client.ts` — unhook `#site-search`; `flagTags` import; shared v2 watch util (legacy write-through).
- `dashboard/src/styles/global.css` — component CSS, fold, sticky/edge-fade, print.
- `dashboard/package.json` — `test:post` script; `gates` re-sequenced (`check && test && build && test:post`). Scripts only, no deps.
- `dashboard/test/format.test.ts` — canonical-export coverage.
- `dashboard/README.md` — register entries + decisions updates.

File-count reconciliation: 17 files under `dashboard/src/` (3 lib + 12 `.astro` pages/routes + 3 data-endpoint generators — see Scope table — minus overlap = 17 total new source files) plus 2 client scripts counted therein; 9 `dashboard/test/` additions (6 unit + 3 post) + 1 fixture asset (envelope builder) + 1 spec doc; 10 modified. The Simplicity Audit derives from this enumeration.

## Implementation Tasks

Ordered; each lands with its tests (requirement IDs in brackets).

1. **T1 — Specs first**: `dashboard/docs/qoq-presentation.md` (Locked #8 mapping; fail-closed unknowns), typed `sumRanges` semantics (kinds; count-based hatch %; all-unparsed → "not disclosed" never `$0+`), S4 failure-state taxonomy, the Locked #18 mapping contract (parse/normalize/resolve/reject rules), and the Locked #20 institutional time-stamp form. [R7, R15, R19]
2. **T2 — Promote the seven components** in `format.ts` (+ producer-flag registry entries, new `terminusRow` + CSS); feed call-site swaps byte-pinned by parity tests; `tickerHref` retarget; stale-comment sweep. [R1, R4, R15, R16]
3. **T3 — derive.ts**: grouping, typed `sumRanges` per T1, quarterly ranges, median/late, top tickers, serving-since, QoQ presentation mapping, S7 calendar state, route-key parser, fetch-outcome classifier, ticker-map parse/resolve (parity vs the committed fixture; ambiguity/rejection cases), search grouping. Exhaustive + mutation-verified tests. [R3, R4, R5, R6, R7, R8, R9, R10, R15, R19]
4. **T4 — data layer**: member metadata join, entity assembly, `moduleAvailability`, `inst.ts` adapter (period-correct accessors; fixture-aggregate tests incl. two-period tile difference), `POPULUS_TICKER_MAP` input wiring, search index data, budget walk + terminus disclosure + `POPULUS_TEST_PAGE_BUDGET`, memoization preserved. [R14, R10, R11, R6, R7, R19]
5. **T5 — Endpoints**: member/ticker columnar endpoints (`{v,t,p,meta}`), search index endpoint (allowlist + ≤128 KiB budget test), URL-safety guard. [R11, R14]
6. **T6 — ui.ts blocks + CSS**: entity header (+star), stat strip, ribbons (C1–C7 + sr-only summaries), period chips, concentration strip, section index, QoQ chips, terminus usages, state blocks S1/S2/S4(+errors)/S5/S6/S7, module cards, specimen card, institutional time-stamp block per Locked #20. [R3, R4, R5, R6, R7, R8, R9, R10, R15, R20]
7. **T7 — Routes**: Home, member (+S5), unified ticker (mapping-gated institutional section), deep congress ticker, holders (mapping-gated static paths), filer (period-correct tiles + changes table + EDGAR block), `/institutional` S1, methodology, shells; real `<table>` semantics, as-of stamps, footer variants throughout. [R2, R3, R4, R5, R6, R7, R8, R9, R16, R18]
8. **T8 — Generic route + 404**: `/e/` page + `entity-client.ts` driver (injected seams) + browser entry; plain `404.astro`. [R10, R14]
9. **T9 — Search + watchlist v2**: `search-client.ts` overlay; v2 store/migration/write-through/quarantine; feed unhook; Base mount. [R11, R10, R20]
10. **T10 — Mobile fold + print**: fold CSS per checklist, sticky/edge-fade, ≥44px targets, `@media print`. [R12, R15, R20]
11. **T11 — Honesty/test hardening**: `css-fold.test.ts` (prohibition gate); pages-render fixture tests (grep-negative literals, honesty-in-markup, captions/`th scope`, em-dash-vs-0, footnote resolution, terminus attribution, SRC allowlist); dead-CSS test; SSR/client parity; secret/abs-path grep over dist. [R19, R12, R15, R16, R20]
12. **T12 — Post-build suite + fixture envelope**: `package.json` scripts (`test:post`, `gates` re-sequence); `test/post/http-status.test.ts` (preview 200/200/404 against normal `dist/`); `test/post/entity-orchestration.test.ts` — **first performs the isolated forced-cut build** (`POPULUS_TEST_PAGE_BUDGET=<small> npx astro build --outDir dist-cut`), asserts cut-page-absent / endpoint-present / listing-links-`/e/`, then executes the driver over `dist-cut` bytes: happy path incl. DOM apply + star wiring, all failure branches, retry, watchdog; `make-inst-preview.py` + `test/post/fixture-preview.test.ts` (identity-seeded envelope build, `entity:cik:0000320193` self-check, happy-path URLs emitted + render institutional content, production-leakage assertion against normal `dist/`). [R19, R10, R6, R7, R20]
13. **T13 — Register + docs**: README deviation entries (each with measurement/citation), decisions updates (watchlist v2; mapping input; institutional stamp), vitest label noted in Dev Notes. [R13, R17]
14. **T14 — Gates + build verification**: freeze tree (hash before/after); `make test`, `uv run python scripts/dep_guard.py`, `cd dashboard && npm run gates` (now incl. `test:post`); verify against the real dev build: 114/791 pages+endpoints, feed rows 3,911 unchanged, nav links resolve, status contract holds, no fixture paths in dist; the forced-rank-cut orchestration pass and the fixture-preview checks are part of `test:post`. [R19, R14, all]

## Testing Strategy

- **Runner:** `node --test`; no new deps. Unit suites (`test/*.test.ts`) run pre-build; the post-build suite (`test/post/*.test.ts`) runs via `test:post` strictly after `astro build` inside `npm run gates` — explicit ordering, never a stale `dist/`.
- **Unit (derive/inst):** every QoQ mapping row against fixture-aggregate rows + mutation checks; `sumRanges` kinds (empty/all-undisclosed/partial/closed/open; real-zero → 0); quarterly gap quarters; S7 calendar states + absence suppression; route-key parser; fetch-outcome classifier (all seven outcomes); serving-since malformed terms; watchlist v2 migration/collision/corruption; ticker-map parity vs committed fixture, ambiguity → rejection, absent map → honest state; **filer period tiles: two fixture periods with different totals must render different numbers, and registry cumulative fields never appear as period values**.
- **Renderer (format/ui):** component markup semantics (hatch, LATE, SRC allowlist, terminus attribution, footnote registry resolution, XSS-escape with hostile fixtures); S1–S7 + S4-error exact-copy assertions; NULL-vs-0 for every institutional integer column; the Locked #20 stamp + caveat on both 13F tables.
- **Page bodies:** fixture-driven full renders (member/tickers/holders/filer/home/methodology) asserting honesty invariants, `<table>` semantics, mobile-card honesty content, grep-negative mockup literals.
- **CSS gate:** `css-fold.test.ts` prohibition check over every ≤720px media block.
- **Post-build (`test:post`):** HTTP-status contract (`/e/` 200, canonical 200, garbage 404) against normal `dist/`; **entity-client orchestration harness** — runs its own isolated forced-cut build first (`POPULUS_TEST_PAGE_BUDGET=<small> npx astro build --outDir dist-cut`; asserts cut page absent, endpoint present, listing links `/e/?k=…`), then executes the real driver over `dist-cut` payload bytes with injected fetch/DOM-adapter/timers: happy path (fetch → decode → body render → DOM apply → star wiring), every failure branch, retry, watchdog; **fixture-preview checks** — identity-seeded envelope builds, `entity:cik:0000320193` self-check passes, `/institutional/filers/1067983/` + the AAPL holders URL emitted with institutional content, no fixture paths in production `dist/`.
- **Parity:** entity body renderers shared by `.astro` and the driver; parity test over columnar-decoded fixtures.
- **Pagination:** existing invariant suites stay green after component adoption.
- **Gates (exact):** `make test` · `uv run python scripts/dep_guard.py` · `cd dashboard && npm test` · `cd dashboard && npm run gates` (= `check && test && build && test:post`).
- **Manual review obligations (listed for QA):** real-browser pass of the generic route and search overlay (the harness's injected DOM is not a browser — declared residue); ≤720px visual pass per surface (light+dark) incl. both institutional pages on the fixture preview; accessibility-tree spot-audit of folded honesty content; keyboard walkthrough; print preview incl. 13F tables; Lighthouse a11y ≥95 spot-check.

## Verification Matrix

| Req | Verification |
|---|---|
| R1 | seven canonical exports, one implementation each (grep-enforced); feed parity byte-stable |
| R2 | Home render: specimen from fixture row, module cards live/absent, verbatim copy, zero sample literals; visual pass |
| R3 | member body: stat strip from fixtures, ribbon zero-based + gap absent, `§` resolves, pager invariants; 114 pages |
| R4 | unified body: section index counts, congress cards, institutional section = mapped fixture data OR honest unresolved/absent state (both asserted), planned placeholders |
| R5 | deep ticker: two-sided ribbon, count-based hatch % caption, exclusions footnote |
| R6 | holders vs fixture aggregate: exactly the published columns (no shares/filed/lag/doc-link anywhere), Locked #20 stamp + caveat, `†` mapping label, topn terminus, `issuer_key_source` disclosed, "derived ·§" resolves; static paths only for mapped entity-keyed issuers; register cross-checked |
| R7 | filer vs fixture aggregate: period tiles from `agg_filer_concentration` — **two periods render different totals**; registry fields identity-only or "all periods ·§"-labeled; concentration NULL → "n/a ·§"; changes table classifies every fixture combination; EDGAR block with citation; terminus; `qoq-presentation.md` precedes `derive.ts` (commit order) |
| R8 | methodology: tile↔stats-key mapping table test, M2 absence honest, real `build_id` + sha; drops registered |
| R9 | shells + `/institutional` build; site-wide link-check resolves |
| R10 | S1 blocks; S2/S4 via parser/classifier tests + post-build status test + orchestration harness (incl. forced-cut traversal); S3 green; S5 feed+member; S6 pre-query; S7 calendar + suppression |
| R11 | search fns; index allowlist + size budget; manual focus/Esc/keyboard/lazy-fetch |
| R12 | `css-fold.test.ts` green; markup honesty assertions; dead-CSS test; manual 720px + a11y-tree pass incl. fixture preview |
| R13 | token assertions (corrected values present; handoff values absent) |
| R14 | grep-negative suite; dev-build build succeeds; endpoint counts 114/791; no fixture paths in production dist |
| R15 | component semantics tests (hatch/em-dash/0/`n/c`/LATE/terminus/footnote/SRC/·§, `sumRanges` kinds, producer-flag mapping, Locked #20 stamp); print keeps footnotes |
| R16 | `<caption>` + `th scope` asserted per table; feed checked |
| R17 | register diff: one entry per deviation with measurement/citation (QA cross-check vs Dev Notes) |
| R18 | footer variant on the two 13F pages, standard elsewhere; build stamps from manifest site-wide |
| R19 | all gates exit 0 on a hash-frozen tree; `test:post` green (status + orchestration + fixture-preview); mutation checks pass |
| R20 | contrast token test + manual; ARIA in renderer tests; sr-only summaries asserted; manual viewport/theme/print incl. fixture preview; Lighthouse manual |

## Rollout / Rollback

- **Workspace:** this worktree (`ws/p3-frontend-handoff`), isolated from the main checkout where P3-1 QA continues. If upstream P3-1 commits land mid-run, re-baseline before gates and re-run the feed parity suite.
- **Gate discipline:** freeze-and-prove around every gate run (tree hash before/after); gates synchronous, never backgrounded; the dev-notes-v1 recovery is budgeted (verify code landed → re-run gates independently → author dev-notes from R-ids + diff → resume `ORCH_QA_ONLY=1`).
- **Landing:** single feature branch off `ws/p3-frontend-handoff`; owner reviews and merges by hand; reconciliation merge with `feat/p3-congress-feed` eased by the surgical feed diff + watchlist write-through.
- **Rollback:** revert the branch — no deploy, no data/pipeline state touched; user-facing risk nil.
- **No-deploy invariant:** `publish.yml`/`record-sign.yml` untouched.

## Simplicity Audit

Minimum coherent design derived from the Planned Files enumeration: 3 lib modules, 2 client scripts, 12 `.astro` pages + 3 endpoint generators, 6 unit + 3 post-build test files, 1 fixture asset (the envelope builder; the mapping fixture is reused from `tests/fixtures/inst/mcp/`), 1 spec doc — zero new dependencies, no new pagination, no producer edits, no component framework, no browser-automation stack. Rejected abstractions: `.astro` component library; client router/hydration framework; S1–S7 state machine; config-driven page schemas; search ranking libraries; per-entity SQL; second wire format; frontend QoQ classifier (deleted — producer owns it); jsdom/puppeteer harness (injected-seam driver instead). The `format.ts`/`derive.ts`/`ui.ts`/`inst.ts` split exists to keep the P3-1 merge surface small.

## Tech Debt Introduced

1. **No production build publishes the institutional module yet** (M2-6 in flight). Adapter binds to the real schema, fixture-aggregate-tested and fixture-previewable; live-build verification waits for the first real `inst_agg.db` publish. Owner: first post-M2-6 dashboard QA pass. Removal: a published institutional build renders both 13F pages from real data with gates green.
2. **Ticker→issuer mapping is a present-day, build-time snapshot** (Locked #18): G14-labeled in the UI; refresh cadence is the publisher's snapshot cadence. Removal condition: the producer publishes a versioned mapping artifact inside the build (a future pipeline decision, not this run's).
3. **Watchlist legacy write-through** until the P3-1 reconciliation merge; removal documented in README decisions.
4. **Real-browser behavior of the client driver and CSS-level fold honesty beyond the prohibition gate remain manual review obligations** (injected-seam harness + static CSS gate narrow but do not close them) until the deferred axe/Lighthouse/browser-harness run.
5. None otherwise — no hidden debt.

## Memory Touch-Points

- `populus-project` — branch/data-contract state; build 20260724.3 counts; no-deploy posture.
- `design-handoff-honesty-fold` — R12 fold rules, DESIGN-BRIEF §1 checklist, display:none prohibition mechanized as `css-fold.test.ts`.
- `specify-before-rewriting` — T1 specs-before-code (mapping, `sumRanges`, taxonomy, stamp), pagination reuse, mutation verification.
- `john-baek-profile` — verified-primary-source discipline: every load-bearing claim checked against the live repo/build/producer contracts; decision records with rationale; costs flagged.
- `orchestrate-devnotes-fluke` — dev-notes recovery budgeted; gates synchronous.
- `orchestrate-worktree-isolation` — isolated worktree; concurrent P3-1 QA acknowledged.
- `verify-against-a-frozen-tree` — freeze-and-prove gate discipline; T14 hashes before/after.

## Failure-Mode Sweep

- **F0 full-set sweep** — applied: component/terminus/footnote/SRC/as-of/table/fold treatments enumerated across ALL routes; producer flag registry covers all five institutional flags with unknown flags fail-visible; the dual-date rule was itself swept (Locked #20) after round 2 caught the institutional gap.
- **F0 secrets** — applied: no secrets in the frontend; dist grepped for abs-path/env leakage.
- **F0 verify-don't-assume** — applied: stats schema, manifest modules + policy constants, DB tables/columns, registry cumulative semantics (`inst_agg.py:460-496`), mapping precedent (M2-4), ticker-key counts — all verified in-repo; nothing institutional is assumed unpublished or published without a citation.
- **F1 route enumeration** — applied: Scope table enumerates every route/endpoint/generic/404; mapped-only holders paths stated.
- **F1 gate-list completeness** — applied: all four gate commands incl. the re-sequenced `gates` and `test:post`.
- **F1 units/NULL states** — applied: em-dash/0/hatch/`n/c` per producer mapping; NULL-honest integers; cumulative-vs-period semantics fixed (Locked #6); `sumRanges` kinds close the `$0+` hole.
- **F1 rebaseline-when-upstream-lands** — applied (Rollout).
- **F1 simplicity-audit-complete** — applied: audit derives from the enumeration.
- **F1 config-rename / F2 prod-writes / F2 SQL-nosec / F2 pooler read-only / F2 bulk-SQL** — N/A: no config renames, writes, dynamic SQL, server, or backfills.
- **F2 behavioral tests** — applied: every boundary (mapping rows, `sumRanges` kinds, parser, classifier, resolver, states, components, migration, CSS gate, status contract, orchestration branches, period-tile difference) has a removal-failing, mutation-verified test.
- **F2 dead-CSS-selectors** — applied (T11).
- **F2 stale comments** — applied (T2 sweep).
- **F3 verify function end-to-end** — applied: real-dev-build reconciliation (114/791/3,911); served-status contract; orchestration harness traverses a genuinely cut entity over real dist bytes; fixture-preview verifies institutional happy-path URLs render.
- **F3 doc-drift multisource** — applied: methodology mapping test; register cross-check; vitest error surfaced.
- **F4 propagation sweep** — applied: the Locked #20 stamp decision propagated through R6/R7/R15/Verification/DoD/register; `tickerHref`/`flagTags`/watchlist changes swept across callers/tests/docs.
- **F5 transport** — applied: synchronous gates, frozen-tree hashing, dev-notes recovery budgeted.

## Definition of Done

- [ ] R1 — seven canonical single-implementation components; feed adopted via surgical diff; parity green.
- [ ] R2, R3, R4, R5, R6, R7, R8, R9 — all nine surfaces build from the real dev build with mockup-faithful layout/copy (subject to registered deviations incl. the contract-driven institutional set) and real table semantics (R16); institutional surfaces bound to the published schema with period-correct sourcing (Locked #6) and the mapping contract (Locked #18).
- [ ] R10 — S1–S7 implemented and wired; S4 failure taxonomy complete; the generic-route path proven by the post-build orchestration harness under a forced rank-cut; S7 calendar-proven + absence-suppressed.
- [ ] R11 — search live on every page; feed unhooked; index allowlist + size budget asserted.
- [ ] R12 — mobile fold with zero honesty removal (markup assertions + `css-fold.test.ts` + recorded a11y-tree pass).
- [ ] R13 — corrected tokens verbatim; token test green.
- [ ] R14 — zero hardcoded stats; grep-negative green; counts reconcile; no fixture paths in production dist.
- [ ] R15 — grammar semantics green incl. typed `sumRanges`, producer-flag mapping, the Locked #20 institutional stamp, and print.
- [ ] R17 — every deviation registered with measurement/citation.
- [ ] R18 — chrome variants + live build stamps site-wide.
- [ ] R19 — `make test`, `dep_guard`, `npm test`, and `npm run gates` (incl. `test:post`: status contract, orchestration harness, fixture-preview checks) all exit 0 on a frozen tree; evidence captured.
- [ ] R20 — a11y tests green; manual keyboard/contrast/viewport/print/Lighthouse review incl. the fixture preview recorded in QA.
- [ ] `dashboard/docs/qoq-presentation.md` merged before its implementing code (commit order verifiable).
- [ ] No unresolved owner decisions (Locked Decisions #1–#20 stand); follow-ups (deploy workflow, axe/Lighthouse/browser harness, first-real-institutional-build QA pass, watchlist legacy-key removal, producer mapping artifact) recorded, not started.
