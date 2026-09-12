# PLAN — Public Filings refinement 20260910 (M1 Fix, M2 Reorder, M3 Polish)

Source: `docs/design/REFINEMENT-PLAN-20260910.md` (owner-directed, 2026-09-10). This file is the
canonical plan-v1 conversion of it. Every symptom, cause, fix, acceptance test and owner decision
in the source is carried here; where the source and this file differ, the difference is stated
and justified (see "Corrections to the source plan" under Current State). The source's section
numbers (§2 IA, §3 F-1 … F-7, §4 components, §5 copy, §6 alpha surfaces, §8 walkthrough) are cited
as `SRC §n` and remain the detailed reference for page layouts and copy tables.

## Goal and Success Criteria

**Goal.** An ordinary visitor can open publicfilings.org and see who the main players are, what
they just did, and go one or two clicks deeper without reading a wall of words. The rule that
resolves every hierarchy conflict: **data first, receipts one click away, methodology one click
further.** Nothing factual is deleted; panels, strips and sentences that do not answer a page's
single question move below the data, behind a disclosure, or to `/methodology/`.

**Success criteria (each milestone's Definition of Done, carried from SRC §7):**

- **M1 Fix:** no `sid:` in any visible cell; no dead `/institutional/tickers/` href; the landing
  header and filer pages agree on the quarter; the BlackRock artifact is gone from the landing;
  no value-only add/trim; no numeric issuer labels; "Druckenmiller" resolves in search; the Tier C
  ticker mapping file exists with ~4,000 verified rows and a 50-row spot-check manifest.
- **M2 Reorder:** every page in SRC §2 has its (b) order; nothing above the first data table but
  the identity line and stats; no "render bound" string in `dist/`; the Congress feed is 50 rows
  per page.
- **M3 Polish:** the SRC §5 copy table is fully applied (a grep for each observed string returns 0
  in `dist/`); all abbreviated headers are full-word at ≥900 px; duplicate issuers are folded;
  signal cards name the ticker.
- **All milestones:** each ends green on the full standing gate set (Tasks and Verification,
  "Standing gates") and the SRC §8 acceptance walkthrough; a milestone that fails its gates
  stops the run. The run stops at local commits on `feat/refinement-20260910`: no push, no PR,
  no deploy.

## Requirements

Milestone 1 — Fix (P0 data, route, search):

- **R1 (F-1, render + serving)** Filer-page Position changes show the issuer name first. Names
  come from a **deduplicated display relation with exactly one row per
  `(cik, period, position_key)`**: the projection already builds this lookup in memory
  (`display`, `src/populus/inst_serving.py:399,495-501`, consumed by activity rows with a
  prior-period fallback at `:798-800`). It is persisted to the serving DB as
  `serving_position_display(cik, period, position_key, issuer_key, issuer_name, title_of_class)`
  with that triple as PRIMARY KEY. The dashboard loads it into a Map (same serving-DB handle
  `filer-payload.ts` already opens) and enriches each `agg_qoq_deltas` row by key lookup —
  current period first, prior period for exits — never by a SQL join across the two artifacts
  and never by a raw join on `serving_filer_rows`, which is not unique on that key (every holding
  row is appended, `inst_serving.py:430`). Enrichment must not change delta row count,
  identities, or monetary totals. `issuer_name` is the first column, class is secondary ink,
  the raw `position_key` moves inside the row's `ⓘ`.
- **R2 (F-2a, render)** No dead holders link: the congress ticker page's "13F institutional
  holders" link renders only when `tickerInstSection(build, t).state === "data"`;
  `/institutional/tickers/[t]/` has NO bare route at all — it simply 404s; a
  post-build test asserts every `/institutional/tickers/…` href in `dist/` resolves to a built file.
  **Amended 2026-09-11, recorded rather than silently applied.** The shipped mechanism was
  neither the stub route written here nor the `_redirects` file that replaced it: publish
  refuses BOTH. `src/populus/publish/inventory.py` prohibits `_redirects`, `_worker.js` and
  Functions at every seam — exactly one control ships, the root `_headers` — and ~3,850 stub
  pages do not fit under the 18,000-file self-cap. R2's guarantee was always "no dead internal
  link in `dist`", never "a redirects file", and the post-build href resolver is what enforces
  it: nothing links to the bare route unless a holders page was built, so the unlinked URL
  404ing is the correct end state, and it is what the deploy-time control-path probes already
  assert. Discovered when `publish.yml` run 34670708472 failed at step 23 after 2h39m; the
  packaging check now runs in `test:post`.
- **R3 (F-2b, pipeline + owner) Tier C ticker mapping — OWNER-CHOSEN.** A reviewed mapping file,
  built like `manager_registry.yaml`, keyed on the SEC canonical issuer name + title of class,
  **never on CUSIP**. (1) Auto-draft a candidate ticker for every security in the closed quarter
  by exact normalized-name match against `company_tickers.json`. (2) Verify row by row every
  security in the top 2,000 by aggregate reported value plus every security held by the 37
  `notable` managers — about 4,000 rows after overlap; verification checks issuer identity and
  share class (Alphabet Class A → GOOGL, Class C → GOOG; Berkshire Class B → BRK.B). (3) Each row
  records `verified_date`, `verified_by`, `method` (`exact-name` | `class-resolved` | `manual`).
  (4) Unverified or ambiguous rows ship **no ticker**, never a guess. (5) The file carries a
  seeded 50-row random sample manifest so the owner's pre-merge spot-check is reproducible. The
  render marks every ticker from this file in its `ⓘ` as "verified against the SEC company list on
  {date}". G14 is amended (ARCHITECTURE.md) to: "Symbols are never inferred automatically; only
  reviewed mapping rows supply a 13F ticker." A coverage report publishes the verified-row count,
  dollar coverage, and the unmapped residue.
- **R4 (F-3, render)** One source for the quarter: the institutional landing header shows the
  closed analytics period and its filer count from the same table; the manifest watermark moves
  to a footnote as "newest filing received: {date}"; filer-page period buttons render only
  periods that have rows for that filer.
- **R5 (F-3, pipeline)** History depth: `serving_filer_rows` publishes 4 periods for the 37
  `notable` filers and 2 for everyone else (owner decision). Serving-DB size and largest-shard
  size are measured before and after; the run stops and reports if growth exceeds 25% or any
  published file reaches ≥ 90% of the 25 MiB Cloudflare Pages per-file cap
  (`inst_budget.MAX_SHARD_BYTES`).
- **R6 (F-4, pipeline)** CIK succession and artifact suppression: the manager registry schema
  gains `predecessor_ciks`; `_match_periods` (or its caller) bridges a CIK with no prior-period
  filing to its predecessor's filing for that period and flags rows `filer_migrated`; a filer
  whose ≥95% of positions read `exit` in one period with no successor match is flagged
  `book_discontinuity` and excluded from landing feeds (kept in shards and on the filer page,
  with a banner).
- **R7 (F-4, render)** Landing activity: restricted to `notable` filers (join
  `agg_manager_registry.notable`), ordered filed-date desc then |Δvalue|, money column shows
  signed Δvalue (and Δshares), never `curr_value_usd` for an exit.
- **R8 (F-5, pipeline + render)** Value-only rows are not add/trim: Δshares == 0 → new kind
  `held` (code 5, "no share change"); Δshares NULL with mismatched units stays `unclassified`;
  the value fallthrough and the `classified_by_value` flag are retired. `held` rows render in a
  collapsed "Mark-to-market only (no share change)" group and are excluded from every
  landing/notable feed; kind labels read `Add / New / Trim / Exit / No change`.
- **R9 (F-6, render + pipeline)** One issuer display-name rule: a shared `displayIssuerName`
  (modal name; drop pure-numeric or ≤3-char candidates when a longer one exists; fold `TR` →
  `TRUST`; title-case), mirrored in Python, replaces `MIN(issuer_name)` in the dashboard cluster
  board and hero stat and in both pipeline issuer-holder aggregates.
- **R10 (F-7, render)** Search finds principals and ranks: the filer tuple becomes
  `[cik, name, principal|"", notable 0|1, top]`; match on name **or** principal; rank notable
  first, then by row count; render "Citadel Advisors · Ken Griffin" as one result. Index the 113
  EDGAR-verified `person` principals already in `manager_registry.yaml` (owner decision: **no new
  colloquial alias list** this cycle). Ticker keys are trimmed/normalized at index build and
  entries failing `/^[A-Z.\-]{1,6}$/` are dropped. The index must not grow past its current
  measured size by more than the principal strings add, and must not worsen B18.3.

Milestone 2 — Reorder (IA, hierarchy, truncation):

- **R11 Congress landing order** (SRC §2): Leaders · net disclosed flow first (10 rows,
  sortable, full width); Tickers · most disclosed second (10 rows); the coverage strip becomes
  one line "N disclosures · updated {date}" with a `ⓘ` carrying parse rates and paper counts; the
  three context cards become one collapsed "Notes on this data" `<details>` under the feed.
- **R12 Feed paging:** the Congress feed shows 50 rows per page (was `DESIGN_FEED_PAGE_SIZE = 8`),
  SSR page 1; the 16.8 MiB single feed JSON is additionally published as byte-bounded per-year
  parts (LD7), each under `SHARD_RESPONSE_CEILING_BYTES` (1 MiB), so first paint needs one part; the "More filters" panel
  is inline (or a left sidebar at ≥1280 px) and never overlays table rows.
- **R13 Compact sections:** compact sections render 10 rows SSR with a real server-side "Show 50
  more" (hidden rows or a per-section JSON shard), no dependency on the full feed download, and
  no "render bound" copy anywhere in `dist/`.
- **R14 Institutional landing** (SRC §2, §6-i, §6-iii): period selector (closed quarters only) +
  one header line from one source (R4); **Notable managers — latest named moves** band (15 rows
  SSR, "Show 50 more" from `/institutional/data/notable-moves/{period}.v1.json` ≤1 MiB, kinds by
  shares, `book_discontinuity` excluded, sort |Δ$| desc within New > Exit > Add > Trim, chips New
  stakes · Exits · Adds · Trims · Hedge funds · Family offices, row click → filer page anchored at
  the issuer, ticker shown when R3 maps it, issuer name always); manager directory with *Hedge
  funds* selected by default when the visitor has no watchlist, principal names shown, "Latest
  notable" naming the issuer; consensus board over notable filers only
  (`HAVING COUNT(DISTINCT cik) ≥ 3`, issuer name via R9, sort new-stake count desc then net $,
  10 rows expand to 50) replacing the cluster board, whose row 1 feeds the hero "Consensus add"
  tile; recent activity below the fold per R7; the "Position discovery / Quarterly record /
  Reported changes" cards and shard-budget paragraph removed or reduced to one footnote line.
- **R15 Filer page** (SRC §2): identity (name · principal · type · AUM-reported); 4 stats
  (reported value · positions · new stakes · exits); Position changes (R1) with 20 rows and a
  real show-more; Holdings one row per issuer with expand; value-only changes in the collapsed
  mark-to-market group (R8); *Sector rotation*, *Congress overlap*, *Signals for this filer*
  panels replaced by one `Planned` line.
- **R16 Member page** (SRC §2): identity · 4 stats · quarterly buy/sell chart · tickers this
  member trades ranked · transactions with `LATE` flags and receipts · signals; *Holdings from
  annual disclosure*, *Reconciliation*, *Institutional overlap* panels and the `—` stats they
  feed removed, replaced by one `Planned: annual holdings, 13F overlap` line.
- **R17 Signals page:** hits table Ticker · Who · What · Filed · Size · Src, 50 per page with a
  real pager over `signals.v1.json` (replacing `HITS_RENDER_CAP = 60`); filter by rule and
  watchlist; Rule Book as `<details>` below the hits and behind each rule name's `ⓘ`; evidence one
  line with full text in the row expand; the Superseded/tombstone table removed from the page and
  linked from the footnote as "Changes since last build".
- **R18 Home:** one-line masthead claim (≤12 words) + search; three live tiles — latest Congress
  disclosures (5 rows), notable-manager moves this quarter (5 rows, R14 data), top Signals (3
  rows, ticker first); module nav cards (Financials, Macro as `Planned`); the explainer card and
  philosophy paragraph relocated (one sentence + `/methodology/#principles`), not cut.
- **R19 Overlap band** (SRC §6-ii), one shared derivation and component, on `/tickers/{T}/` and
  on the holders page (R20): Congress (last 90 days) buyers/sellers
  beside notable managers adding/trimming (closed quarter), each name linked, plus a 20-row
  merged timeline. The 13F half uses R3 tickers; if R3 has not mapped the ticker, the 13F half
  shows a `Planned` badge and the Congress half still ships.
- **R20 Holders route:** `/institutional/tickers/[t]/holders/` generates for every ticker that R3
  maps (no longer gated on `issuer_key_source === "entity"`), showing identity, 4 stats (holders ·
  combined value · adds · exits), holders ranked by value with Δshares and kind (all from
  `agg_ticker_holders`, class-grain), the R19 overlap band, and a link to the Congress ticker page.

Milestone 3 — Polish (copy, empty panels, density):

- **R21 `cardFoot({short, full})`** in `format.ts`: short one-liner + `ⓘ` with the full text, or a
  `<details>` "How this is computed" when the text has more than 2 clauses; the six table footers
  (`congress.ts`, `ticker.ts`, `signals.ts`, `INST_STAMP_CAVEAT`) converted.
- **R22 Header labels:** abbreviated column headers (`RCPT`, `TXNS`, `Δ POS`,
  `INTERVAL · LOG $1K–$50M+`, `GROSS PURCH ·§`) become full words at ≥900 px (`Source`, `Trades`,
  `Position change`, `Amount range`, `Gross bought`); the abbreviation survives only under 900 px,
  with the full word in the `ⓘ`; `§`/`ⓘ` markers retained.
- **R23 Copy pass:** every row of the SRC §5 table applied, each full text moved to its stated new
  home (`ⓘ`, methodology anchor, or artifact); methodology anchors `#published-dataset`,
  `#coverage`, `#13f-method`, `#ranges`, `#position-grain`, `#ticker-mapping`, `#site-weight`,
  `#principles` exist on `/methodology/`.
- **R24 Empty panels:** panels that render only a frame and a paragraph (`shared.ts` callers) are
  removed; each page gets one `Planned:` line; the filer directory drops the Turnover and Congress
  overlap `—` columns.
- **R25 Fold duplicate issuers:** `serving_filer_rows` gains `issuer_key`; holdings fold by
  `position_key|put_call|unit` via the existing `foldPositions`, then group by `issuer_key`; the
  expand shows the raw rows ("as it reported it").
- **R26 Member signal cards ticker-first:** Ticker · Kind · Filed · Size · Src
  (`s.entities.ticker` is already in scope).
- **R27 Banned-vocabulary gate:** the §1 rule-3 pipeline vocabulary (render bound, shard,
  projection, tombstone, coverage bucket, change_kind, grain, watermark, bioguide) is added to the
  existing post-build banned-wording scan over `dist/` user-visible text.

Cross-cutting:

- **R28 Milestone gating and stop point:** M1 → M2 → M3 in order; each milestone ends with the
  full standing gate set, its Definition of Done check, and the SRC §8 walkthrough; a failed gate
  stops the run. Work is committed locally on `feat/refinement-20260910` in the worktree only; no
  push, no PR, no deploy.

## Scope and Non-goals

**In scope:** R1 … R28 as listed; the dashboard (`dashboard/src/**`), the 13F pipeline
(`src/populus/inst_agg.py`, `inst_agg.sql`, `inst_serving.py`, `manager_registry.*`), one new
reviewed mapping file and its loader/drafting script, the G14 text in the architecture docs, and
tests for each.

**Non-goals (explicit):**

- Tier A (automatic name-match tickers) and Tier B (FTD/registry CUSIP crosswalk) — superseded
  by the owner's Tier C choice for this cycle. No CUSIP→ticker table is created or published.
- A colloquial alias list for search (owner decision: principals only).
- Resolving the `cusip-redistribution` counsel question or entity-resolving 13F securities.
- Annual financial-disclosure ingest (member-page holdings/reconciliation panels stay `Planned`).
- Any deploy, push, PR, publish-workflow change, or Cloudflare action.
- The optional M3 `agg_security_directory` pipeline table mentioned in SRC F-1 (deferred; R1's
  render join is sufficient).
- Reducing the existing B18.3 search-index overrun (R10 only must not worsen it).

## Current State and Detected Stack

### Detected Stack

- **Python 3 / uv** (`pyproject.toml`, `uv.lock`): pipeline under `src/populus/`; tests under
  `tests/` via `uv run pytest -q` (`[tool.pytest.ini_options]` in `pyproject.toml`).
- **Node / TypeScript / Astro** (`dashboard/package.json`): static site; `npm run gates` = `astro
  check` → `node --test test/*.test.ts` → `build:bounded` (requires ≥32 GiB RAM; this machine has
  64 GiB) → `test:post` → Playwright geometry → holders-browser.
- **CI** (`.github/workflows/checks.yml`): pytest full tree, `npx astro check`, `npm test`. The
  build, post-build and browser lanes are local-only (Makefile comment on `dashboard-gates`).
- **Make:** `make check` = `test` + `security` + `abs-paths`.

### Worktree state (observed 2026-09-10)

Worktree `.claude/worktrees/refinement-20260910`, branch `feat/refinement-20260910`, HEAD
`0c7aa33` (#111). The source plan was grounded on `4f4769d`; the only delta
`4f4769d..0c7aa33` touches `src/populus/deploy/*` and deploy tests, none of which this plan
edits. `dashboard/node_modules` is a symlink to the main checkout's `node_modules`.

### Code facts re-verified in the worktree (supporting each requirement)

- R1: `dashboard/src/lib/ui/institutional.ts:395` renders `esc(d.position_key)` as the first cell;
  the loader `dashboard/src/lib/inst.ts:172-177` selects from `agg_qoq_deltas` with no name
  column; `serving_filer_rows` (`src/populus/inst_serving.py:558-577`) carries `issuer_name`,
  `cusip`, `title_of_class`, `position_key`.
- R2/R20: `holders.astro:23-35` generates a path only when a holder row has
  `issuer_key_source === "entity"`; `tickerInstSection` (`dashboard/src/lib/data.ts:982-996`)
  filters to entity rows only; `_issuer_key` (`src/populus/inst_agg.py:110-127`) emits `entity:`
  only for resolved securities; the TICKER cell is a literal `—` at
  `dashboard/src/lib/holdings.ts:1352`; the holders link is unconditional at
  `dashboard/src/lib/ui/congress.ts:597-599`. `POPULUS_TICKER_MAP` is set in
  `.github/workflows/publish.yml:513`. `docs/roadmap.md:82-88` records 0 of 26,158 securities
  entity-resolved.
- R3: G14 is defined at `ARCHITECTURE.md:952` ("No identity time travel"), elaborated at
  `ARCHITECTURE.md:259`, `docs/architecture/data-contracts/institutional-13f.md:113`, and cited
  at `dashboard/src/lib/holdings.ts:983` and `docs/frontend/qoq-presentation.md:150`. A local
  `company_tickers.json` exists at `data-cache/inst/registry/company_tickers.json` (main
  checkout); the Official 13(f) List PDFs are under `data-cache/13flist/`.
- R4: the header's "Latest quarter-end" is `inst.watermarks.latest_period_of_report`
  (`dashboard/src/pages/institutional/index.astro:178`), set from
  `MAX(period_of_report) FROM v_default_inst_filings` (`src/populus/publish/build.py:1359-1366`);
  the "N filed" count comes from the closed concentration period
  (`dashboard/src/lib/inst-analytics.ts:28-62`).
- R5: `PUBLISHED_PERIODS = 2` (`src/populus/inst_serving.py:68`); `publication_periods`
  (`:134-152`) takes the N most recent periods corpus-wide; `MAX_SHARD_BYTES = 25 MiB`
  (`src/populus/inst_budget.py:134`); `dashboard/test/post/file-budget.test.ts` reads caps from
  `inst_budget.py`.
- R6: `_match_periods` (`src/populus/inst_agg.py:291`) matches within one filer; BlackRock Inc
  (CIK 2012383, `manager_registry.yaml:766-771`, `notable: false`) and the superseded
  predecessor BlackRock Finance (CIK 1364742, rejected-candidate note at
  `manager_registry.yaml:1082-1083`); registry loader `src/populus/manager_registry.py`
  (`REQUIRED_FIELDS` at `:38`); `agg_manager_registry` written at `inst_agg.py:2677-2679`.
- R7: `ACTIVITY_ORDERING` starts `abs(delta_value_usd) desc` (`dashboard/src/lib/activity.ts:92-99`).
- R8: the value fallthrough is `src/populus/inst_agg.py:263-265`; kind codes
  `_QOQ_CHANGE_KIND_CODES` (`:1486-1492`, new=0 … unclassified=4); an integrity query rejects
  `change_kind_code NOT BETWEEN 0 AND 4` (`:1720`); the public view maps codes at
  `src/populus/inst_agg.sql:80-118`, where flag bit 2 is `classified_by_value`; TypeScript
  unions at `dashboard/src/lib/activity.ts:110` and `dashboard/src/lib/inst.ts:40`.
- R9: `MIN(issuer_name)` at `dashboard/src/lib/activity.ts:1369`, `MIN(issuer_name_raw)` at
  `src/populus/inst_agg.py:1959` and `:2003`; the modal precedent `_adds_issuer_name` at
  `src/populus/inst_agg.py:1240`.
- R10: filer search tuple `{cik, name, top}` at `dashboard/src/lib/data.ts:912-916`;
  `ManagerTyping.person`/`notable` loaded at `dashboard/src/lib/inst.ts:405-423` but not indexed;
  `searchQuery` linear with `limit = 8` at `dashboard/src/lib/derive.ts:1461`; registry has 113
  `person` rows and 37 `notable: true` (counted with grep); index budget ≤128 KiB asserted in
  `dashboard/test/post/http-status.test.ts:80`; B18.3 overrun at `docs/roadmap.md:96`.
- R12/R13: `DESIGN_FEED_PAGE_SIZE = 8` (`dashboard/src/lib/format.ts:759`),
  `compactDisclosure` (`:1389`), `SHARD_RESPONSE_CEILING_BYTES = 1_048_576`
  (`dashboard/src/lib/shards.ts:23`), feed JSON route `dashboard/src/pages/congress/data/feed.v1.json.ts`,
  overlay CSS `dashboard/src/styles/late-additions.css:822`, `compact: 5` at
  `dashboard/src/pages/congress/index.astro:79,104`.
- R17: `HITS_RENDER_CAP = 60` (`dashboard/src/lib/ui/signals.ts:259`); member signal rows at
  `:645-648`.
- R24/R22: `DESIGN_INST_INDEX_HEADS` at `dashboard/src/lib/inst-index.ts:329`.
- R27: the post-build banned-wording scan exists (`dashboard/test/post/banned-wording.test.ts`
  using the helper `dashboard/test/lib/banned-scan.ts`).

### Corrections to the source plan (applied here)

1. **Point72 and Citadel are `notable: false`** (`manager_registry.yaml:398-402, 380-384`). The
   SRC §6-i/§6-ii example rows and the SRC §8 walkthrough 3 ("click Point72") are illustrative
   only; acceptance uses whichever notable managers appear (walkthrough 3 is restated in Tasks).
2. **Owner decisions supersede SRC F-7's alias list and Tiers A/B** (see Non-goals).
3. Line drift vs `4f4769d` is cosmetic (e.g. `institutional.ts:391` → `:395`,
   `activity.ts:1368` → `:1369`); `holdings.ts` is `dashboard/src/lib/holdings.ts`, not `lib/ui/`.
4. G14's current text is "no identity time travel", not the SRC paraphrase; R3 rewrites it in
   `ARCHITECTURE.md` and the data contract.

### Memories consulted

`plan-v1-fixed-heading-schema` and `plan-v1-literal-rid-tokens` (heading set and literal R-ids —
the validator now uses this 10-heading form); `make-test-is-owner-tier-only` (32 GiB build,
private data); `measure-closed-quarters-only` (size the Tier C draft and coverage from a CLOSED
quarter); `mockups-are-not-measurements` (SRC example numbers are not acceptance data);
`mutation-tests-pin-properties` and `mutation-harness-pycache-phantom` (R8 mutation test);
`verify-against-a-frozen-tree` (hash the tree around gate runs); `pages-25mib-filer-cap`
(R5 cap); `design-handoff-honesty-fold` (moving caveats behind `ⓘ` must not delete them);
`design-overhaul-state` (current dashboard baseline); `failure-modes.md` F0–F5.

## Reuse Map

| Existing symbol / path | Decision | Why |
|---|---|---|
| `serving_filer_rows` (`inst_serving.py`) | reuse | already carries `issuer_name`/`title_of_class` per `(cik, period, position_key)` — R1 join source |
| `tickerInstSection`, `resolveTicker` (`data.ts`, `derive.ts`) | extend | add a Tier C resolution branch alongside the entity branch (R2, R20) |
| `manager_registry.yaml` + `manager_registry.py` + `scripts/maintenance/verify_manager_registry.py` | extend | add `predecessor_ciks` (R6); pattern for the new mapping file (R3) |
| `ManagerTyping` (`inst.ts`) | reuse | `person`/`notable` already loaded — R10, R7, R14 |
| `_adds_issuer_name` (`inst_agg.py:1240`) | extend | generalize into the Python half of `displayIssuerName` (R9) |
| `note()` (`format.ts:227`), `compactDisclosure` | reuse / extend | `ⓘ` carrier for all moved text; compact rework (R13) |
| `foldPositions` (`filer-payload.ts`) | reuse | R25 fold before issuer grouping |
| `shards.ts` + `SHARD_RESPONSE_CEILING_BYTES` | reuse | per-year feed shards and notable-moves shard (R12, R14) |
| `banned-wording.test.ts` / `banned-scan` | extend | add §1 rule-3 vocabulary (R27) |
| `file-budget.test.ts`, `inst_budget.py` | reuse | R5 cap measurement |
| `agg_manager_registry.notable` | reuse | notable-only feeds (R7, R14, R18) |
| `company_tickers.json` cache (`scripts/fetch_ticker_registry.py`) | reuse | R3 draft source |
| Tier C mapping file + loader | **new** | no existing reviewed name+class → ticker source; justified by the owner's Tier C decision |
| `cardFoot()` | **new** (in `format.ts`) | six footers share one shape; no existing helper |
| `displayIssuerName` | **new** (TS in `format.ts`, Python beside `_adds_issuer_name`) | one rule in both runtimes |

## Architecture and Locked Decisions

**LD1 — Owner decisions (2026-09-10) are final and implemented as stated:** all three
milestones in one run M1 → M2 → M3, each gated; Tier C tickers; 4 quarters for notables / 2 for
others with the 25% / 25 MiB stop rule; search indexes the 113 `person` principals, no alias
list; stop at local commits, no push/PR/deploy.

**LD2 — Tier C data flow (R3, R20).**
- The mapping file `src/populus/ticker_mapping_13f.yaml` has one row per
  `(issuer_name_canonical, title_of_class)` with `ticker`, `verified_date`, `verified_by`,
  `method`, optional `note`. **It has no CUSIP column and no CUSIP-derived key.** The loader
  `src/populus/ticker_mapping_13f.py` rejects duplicate keys, a ticker failing
  `/^[A-Z.\-]{1,6}$/`, a ticker absent from the pinned `company_tickers.json` snapshot, unknown
  `method`, missing verification fields, and any field named or containing a 9-character CUSIP
  pattern.
- Draft script `scripts/draft_ticker_mapping_13f.py` reads **security-grain holdings from the
  composed institutional source DB** (`POPULUS_INST_DB`, view `v_filer_reported_holdings`,
  `src/populus/views.sql:179`, which carries `cik`, `issuer_name_raw`, `title_of_class`,
  `value_usd` per holding), never from `inst_agg.db` (no `title_of_class`; issuer top-holder rows
  collapse classes and truncate holders). `--period` is required and must be a closed quarter:
  the script refuses the newest period present in the source. Population = every
  `(normalized issuer_name, normalized title_of_class)` key with `value_usd` summed over all
  filers for that period; target set = top 2,000 keys by that sum ∪ every key held by any
  `notable` CIK (registry), both computed over the full population, never from top-N aggregates.
  It emits candidates by exact normalized-name match against `company_tickers.json` (upper,
  punctuation stripped, suffixes INC/CORP/CO/LTD/PLC/TR/TRUST folded) with `status: candidate`,
  and writes the target list. Candidates never ship: only rows promoted to verified
  (with the three verification fields) are loaded.
- Verification is performed by the developer agent row by row against the SEC company list and
  the filed `issuer_name`/`title_of_class`; `verified_by` names the agent run. Ambiguous rows
  stay unverified (no ticker).
- **Ticker identity is class-grain end to end.** A verified row maps one normalized
  `(issuer_name, title_of_class)` key to one ticker, and nothing downstream collapses it to
  `issuer_key` before the ticker is attached. The pipeline builds a new aggregate
  `agg_ticker_holders(ticker, period_of_report, rank, cik, filer_name, value_usd, shares,
  prev_shares, delta_shares, change_kind, method, verified_date)` **inside `build_inst_agg`,
  entirely from source holdings** (`v_filer_reported_holdings`, current and prior closed period)
  joined on that key, summing value and shares per `(cik, key, period)` only within the key.
  Δshares = current − prior per filer and key; kind follows the R8 rule (no prior → `new`, no
  current → `exit`, Δshares > 0 `add`, < 0 `trim`, = 0 `held`, unit mismatch `unclassified`).
  It has **no dependency on the serving projection or `serving_position_display`**, which
  `publish/build.py` builds only after the aggregate (aggregate at `build.py:1255`, serving
  projection at `:1369`), and it never reads a pre-existing artifact. It never reads
  `agg_issuer_top_holders`, which sums across classes (`src/populus/inst_agg.sql:124-126`). So
  GOOGL (Class A) and GOOG (Class C) get separate holder lists, amounts and changes. The
  row-level holdings TICKER cell (`holdings.ts:1352`) resolves per row from that row's own
  `issuer_name` + `title_of_class`. `resolveTicker`/`tickerInstSection` gain a `mapped` state
  that reads `agg_ticker_holders`; `holders.astro` generates for every mapped ticker with rows.
  Entity-keyed resolution stays as-is. The table has no CUSIP column.
- Sample manifest: `src/populus/ticker_mapping_13f.sample.json` lists 50 row keys drawn with a
  recorded seed over verified rows; a test re-derives the sample from the seed.

**LD3 — History depth (R5), complete path.**
(1) Candidates: `build.py:1354` calls `publication_periods(source, width=PUBLISHED_PERIODS_NOTABLE)`
with a new named constant `PUBLISHED_PERIODS_NOTABLE = 4`; `PUBLISHED_PERIODS = 2` stays for
everyone else. (2) Retention: the filer projection keeps all candidate periods for notable CIKs
(registry `notable: true`) and only the newest 2 for all other filers. (3) Activity window:
`_build_activity_rows` and the activity shards receive only the newest 2 periods as an explicit
argument (behaviour unchanged). (4) Payload: `filer-payload.ts` (`:185-202`, today prior +
current only) assembles `rowsByPeriod`/`totalsByPeriod` for **every** published period of that
filer, each under the existing per-period embed cap, and each filer shard stays ≤
`FILER_SHARD_BYTE_CEILING` (`inst_budget.py:228`). (5) Selector: the period selector lists
exactly the periods present in `rowsByPeriod`; the comparison column uses the selected period
and its immediate predecessor in that list.

**LD4 — `held` kind (R8).** Code 5 = `held`; the integrity bound becomes `NOT BETWEEN 0 AND 5`;
flag bit 2 (`classified_by_value`) is no longer set by new builds and its view label is kept
only so old aggregates still decode. TypeScript `ChangeKind` unions and `CHANGE_KINDS` gain
`held`.

**LD5 — Succession (R6).** `predecessor_ciks` is an optional list on registry rows; BlackRock
Inc (2012383) lists 1364742. Matching: when CIK X has no filing for period P−1 and a
predecessor has one, the predecessor's P−1 book is the prior side; resulting rows carry
`filer_migrated` (a new flag bit 32; the integrity bound on `flags_mask` widens to 63).
`book_discontinuity` is a filer-period attribute in a new small table consumed by the landing
feeds.

**LD6 — Rendering rules.** Moved text goes behind `note()`/`<details>` or to a methodology
anchor; no fact is deleted (honesty-fold rule). Tickers from R3 always carry the "verified
against the SEC company list on {date}" `ⓘ`.

**LD7 — Feed sharding (R12).** Feed rows, in the feed's existing deterministic order, are cut
per year into **byte-bounded parts**: a part closes as soon as adding the next row would push
its complete serialized response (rows plus metadata) past `SHARD_RESPONSE_CEILING_BYTES`, so a
year yields as many parts as it needs. Parts are served at
`congress/data/feed/{year}-{n}.v1.json`, listed with row counts and first/last row keys in
`congress/data/feed/index.v1.json`. Half-year splitting is not used (a read-only measurement in
review found 2025-H2, 2025-H1 and 2020-H1 each over 1 MiB). Paging: page k maps to global row
offsets and the client fetches only the part or parts covering it (a page may span two parts).
Filtering: page 1 renders from the first part alone; applying any filter first loads every part
(or the full `feed.v1.json`), so filter results cover the complete corpus. The full `feed.v1.json` stays published unchanged: it is the "published dataset" that
`rankings.ts:566`, the congress/tickers/leaders/watchlist pages and the `<noscript>` link point
to, and `watchlist-client.ts:164` keeps reading it. Only `feed-client.ts` (`:216`) switches to the
byte-bounded per-year parts for first paint and paging; `test/r17-single-fetch.test.ts` is
updated to assert exactly one part fetch for page 1 (the single-fetch property is kept, the URL
changes).

**Rejected abstractions:** a generic "ticker resolution service" (one table + one branch
suffices); a CUSIP-keyed crosswalk (owner forbids); a client-side search engine rewrite (tuple
extension + ranking is enough); a new CSS framework for disclosures (reuse `note()`).

## Planned Files

Pipeline and data:
- `src/populus/inst_agg.py`
- `src/populus/inst_agg.sql`
- `src/populus/inst_serving.py`
- `src/populus/manager_registry.py`
- `src/populus/manager_registry.yaml`
- `src/populus/ticker_mapping_13f.py`
- `src/populus/ticker_mapping_13f.yaml`
- `src/populus/ticker_mapping_13f.sample.json`
- `scripts/draft_ticker_mapping_13f.py`
- `scripts/maintenance/verify_manager_registry.py`

Docs:
- `ARCHITECTURE.md`
- `docs/architecture/data-contracts/institutional-13f.md`
- `docs/frontend/qoq-presentation.md`
- `docs/roadmap.md`
- `docs/design/TICKER-MAPPING-13F-COVERAGE.md`

Python tests:
- `tests/test_inst_agg.py`
- `tests/test_inst_serving.py`
- `tests/test_manager_registry.py`
- `tests/test_ticker_mapping_13f.py`

Dashboard library:
- `dashboard/src/lib/inst.ts`
- `dashboard/src/lib/ui/institutional.ts`
- `dashboard/src/lib/holdings.ts`
- `dashboard/src/lib/ui/congress.ts`
- `dashboard/src/lib/data.ts`
- `dashboard/src/lib/derive.ts`
- `dashboard/src/lib/activity.ts`
- `dashboard/src/lib/inst-analytics.ts`
- `dashboard/src/lib/format.ts`
- `dashboard/src/lib/filer-payload.ts`
- `dashboard/src/lib/inst-index.ts`
- `dashboard/src/lib/congress-columns.ts`
- `dashboard/src/lib/shards.ts`
- `dashboard/src/lib/ui/signals.ts`
- `dashboard/src/lib/ui/home.ts`
- `dashboard/src/lib/ui/ticker.ts`
- `dashboard/src/lib/ui/shared.ts`
- `dashboard/src/scripts/search-client.ts`
- `dashboard/src/scripts/feed-client.ts`
- `dashboard/test/r17-single-fetch.test.ts`
- `dashboard/src/styles/late-additions.css`

Dashboard pages and routes:
- `dashboard/src/pages/index.astro`
- `dashboard/src/pages/congress/index.astro`
- `dashboard/src/pages/congress/members/[bioguide].astro`
- `dashboard/src/pages/congress/data/feed.v1.json.ts`
- `dashboard/src/pages/congress/data/feed/[part].v1.json.ts`
- `dashboard/src/pages/congress/data/feed/index.v1.json.ts`
- `dashboard/test/filer-payload.test.ts`
- `dashboard/src/pages/institutional/index.astro`
- `dashboard/src/pages/institutional/filers/[cik].astro`
- `dashboard/src/pages/institutional/tickers/[t]/index.astro`
- `dashboard/src/pages/institutional/tickers/[t]/holders.astro`
- `dashboard/src/pages/institutional/data/notable-moves/[period].v1.json.ts`
- `dashboard/src/pages/signals/index.astro`
- `dashboard/src/pages/tickers/[ticker].astro`
- `dashboard/src/pages/methodology/index.astro`
- `dashboard/src/pages/search/index.v1.json.ts`

Dashboard tests:
- `dashboard/test/inst.test.ts`
- `dashboard/test/activity.test.ts`
- `dashboard/test/search.test.ts`
- `dashboard/test/holdings.test.ts`
- `dashboard/test/signals-page.test.ts`
- `dashboard/test/format.test.ts`
- `dashboard/test/pages-render.test.ts`
- `dashboard/test/refinement-m1.test.ts`
- `dashboard/test/refinement-m2.test.ts`
- `dashboard/test/refinement-m3.test.ts`
- `dashboard/test/post/http-status.test.ts`
- `dashboard/test/post/banned-wording.test.ts`
- `dashboard/test/post/file-budget.test.ts`
- `dashboard/test/post/refinement-dist.test.ts`
- `dashboard/test/lib/banned-scan.ts`
- `dashboard/test/fixtures/institutional.ts`
- `dashboard/test/fixtures/make-inst-preview.py`

## Tasks and Verification

**Standing gates (every milestone, run in the worktree, full tree):** `uv run pytest -q`;
`cd dashboard && npm run gates` (never `npm ci` / `make dashboard-gates` here — see Risks);
`uv run python scripts/maintenance/dependency_guard.py` + the `pip-audit` step of `make
security` + `cd dashboard && npm audit --audit-level=high`; `make abs-paths`. Hash the tree
before and after each gate run; a changed hash invalidates the run.

| Task | R-id | Test / check | Definition of Done |
|---|---|---|---|
| T1 persist `serving_position_display` (PK cik, period, position_key; from the existing `display` lookup plus `title_of_class`); QoQ loader enriches by Map lookup (current, prior-period fallback for exits); render issuer first, class secondary, key in `ⓘ` | R1 | `tests/test_inst_serving.py`: PK uniqueness; a fixture with one position repeated across two filings and reporting subdivisions in BOTH periods yields identical delta row count, delta identities, Σ delta_value_usd and Σ delta_shares before and after enrichment; node test over the fixture build: names cover 100% of `new/add/trim` rows and ≥99% of `exit` rows (residue reported); post-build: on `/institutional/filers/1067983/` every Position-changes row has a non-empty issuer name and zero cells match `/^sid:/` | both tests green; residue listed in Dev Notes |
| T2 gate congress holders link on `state === "data"`; no bare `/institutional/tickers/[t]/` route (see the R2 amendment — a stub route and a `_redirects` file are both refused by publish); post-build href resolver | R2 | post-build test: every `/institutional/tickers/…` href in `dist/` resolves to a built file; unit test: link absent when state ≠ data | zero dead hrefs in `dist/` |
| T3 Tier C: draft script, mapping file + loader + validator, verify ~4,000 rows, seeded 50-row sample manifest, class-grain `agg_ticker_holders`, per-row TICKER cell, render + `ⓘ`, G14 amendment in `ARCHITECTURE.md` and the data contract, coverage report | R3 | `tests/test_ticker_mapping_13f.py`: loader rejects CUSIP-shaped fields, duplicate keys, bad tickers, unverified rows; sample re-derives from seed; draft refuses the newest (open) period; target-set equality on a source fixture containing two classes of one issuer, a notable-only tail security below the top-2,000 cut, and holders beyond any aggregate top-N cutoff; `tests/test_inst_agg.py` end-to-end fixture with Alphabet Class A and Class C (distinct holders and amounts) mapped to GOOGL and GOOG yields separate holder lists, totals and changes, and a third, unverified class stays unmapped (no ticker on its rows, no holders page); clean-build test: with no pre-existing `inst_agg.db` or `inst_serving.db`, one fixture build produces the class-specific GOOGL/GOOG holders and changes (proves no serving-artifact dependency); real build: Berkshire's holdings table shows `AAPL`, `KO`, `BAC`; verified-row count ≥ target set minus reported ambiguous residue | file committed with verification fields on every shipped row; coverage report written; spot-check manifest present (owner spot-check is a pre-merge operator step) |
| T4 institutional header from the closed period + filer count from the same table; watermark → footnote; period buttons only where the filer has rows | R4 | unit test: header period == filer default period; no disabled/empty period button in rendered filer pages | landing header date equals the period every filer page defaults to |
| T5 LD3 complete path: candidate width 4, per-filer retention 4/2, activity window 2, payload assembles every published period, selector lists exactly those; measure serving DB and largest shard before/after | R5 | `tests/test_inst_serving.py`: a notable fixture filer has 4 periods in `serving_filer_rows`, a non-notable exactly 2, activity rows cover only the newest 2; `dashboard/test/filer-payload.test.ts`: the 4-period notable payload has `rowsByPeriod` for all 4, each selectable period renders its own rows, the non-notable payload has exactly 2, every filer shard ≤ `FILER_SHARD_BYTE_CEILING`; real build: Berkshire shows ≥2 browsable quarters, and 4 when the corpus holds 4 (count reported); measurement table in Dev Notes; `file-budget.test.ts` green | growth ≤25% and no file ≥90% of 25 MiB, else STOP and report |
| T6 `predecessor_ciks` in registry + loader + verifier; `_match_periods` succession bridge, `filer_migrated`; `book_discontinuity` table and feed exclusion | R6 | `tests/test_inst_agg.py`: synthetic CIK migration fixture yields continuing positions with real Δshares; ≥95%-exit synthetic filer flagged; `tests/test_manager_registry.py` accepts/validates `predecessor_ciks`; real build: BlackRock Inc shows AAPL/NVDA as continuing | fixture tests green; no landing row is an `exit` with `curr_value` 0 where the predecessor still reports it |
| T7 landing activity notable-only, filed-date desc then abs(Δvalue), signed Δvalue and Δshares | R7 | `dashboard/test/activity.test.ts`: ordering and notable filter; money cell is Δvalue | landing feed contains only notable filers |
| T8 `held` code 5, integrity bound, retire value fallthrough and `classified_by_value`, TS unions, render group, landing exclusion, labels | R8 | `tests/test_inst_agg.py`: Δshares 0 → `held`, NULL/mismatch → `unclassified`; mutation test that restores the value fallthrough must FAIL the suite (run with `PYTHONDONTWRITEBYTECODE=1` and a green sanity run first); post-build: no visible add/trim row with Δshares 0 | mutation killed; zero value-only add/trim in `dist/` |
| T9 `displayIssuerName` (TS) + Python twin; replace `MIN(issuer_name)` in `activity.ts:1369` and `inst_agg.py:1959`/`:2003`; hero stat and cluster board | R9 | fixture test over the observed bad names ("1ISHARES TR", "HONA", "438516106"); parity test TS vs Python on the same list; post-build: no issuer label on `/institutional/` matches `/^\d/` or `/^[A-Z0-9]{9}$/` | both runtimes' tests green |
| T10 search tuple with principal + notable, name-or-principal match, notable-first ranking, ticker-key trim/filter | R10 | `dashboard/test/search.test.ts`: "Druckenmiller" → Duquesne Family Office first; "Berkshire" → Berkshire Hathaway first with "Warren Buffett"; zero index keys contain whitespace; all ticker keys match `/^[A-Z.\-]{1,6}$/`; post-build: index size before/after recorded, growth ≤ added principal bytes | M1 DoD met; no alias list added |
| T11 M1 gate: standing gates + SRC §8 walkthroughs 1, 2, 4, 5 on a local build | R28 | standing gates green; walkthrough transcript in Dev Notes | M1 committed locally |
| T12 Congress landing reorder, one-line strip + `ⓘ`, cards → `<details>` | R11 | `dashboard/test/refinement-m2.test.ts`: section order Leaders → Tickers → Feed; Leaders 10 rows | page matches SRC §2 (b) order |
| T13 feed 50/page, byte-bounded per-year parts + part index (LD7), cross-part paging, full-corpus filtering, inline filter panel | R12 | unit: page size 50; an oversized synthetic year splits into ≥2 parts each ≤ ceiling; a page crossing a part boundary shows the correct 50 rows; concatenating all parts equals the full feed row for row (no duplicates, no omissions); a filter's results equal filtering the full feed; `r17-single-fetch.test.ts`: page 1 costs exactly one part fetch; post-build: every feed part ≤ `SHARD_RESPONSE_CEILING_BYTES`; geometry: filter panel never overlaps table rows at five widths | feed first paint needs one part |
| T14 compact sections SSR 10 + real show-more | R13 | post-build: `grep -r "render bound" dist/` returns 0; show-more works without the full feed | no "render bound" in `dist/` |
| T15 institutional landing: notable-moves band + shard, directory default Hedge funds, consensus board, activity below fold, cards removed | R14 | unit: band population = notable filers, kinds by shares, `book_discontinuity` excluded, sort order; shard ≤1 MiB; consensus `COUNT(DISTINCT cik) ≥ 3` | hero "Consensus add" equals consensus row 1 |
| T16 filer page template, show-more, mark-to-market group, `Planned` line | R15 | `refinement-m2.test.ts`: order identity → stats → changes → holdings; empty panels absent | matches SRC §2 filer order |
| T17 member page template, removed panels, `Planned` line | R16 | render test on a fixture member: no `—` stat tiles; one `Planned` line | matches SRC §2 member order |
| T18 signals pager, ticker-first, Rule Book below, tombstone table removed | R17 | `signals-page.test.ts`: 50/page pager over all hits; Ticker first column; no Superseded table in page | "Showing 1–50 of N · Next" rendered |
| T19 home masthead + three live tiles | R18 | render test: masthead ≤12 words; three tiles with 5/5/3 rows | explainer relocated to methodology, not deleted |
| T20 shared overlap-band derivation + component, placed on `/tickers/{T}/` (and reused by T21) | R19 | render tests on BOTH routes: Congress half uses exactly the last-90-day window (a 91-day-old fixture trade is excluded); 13F half uses notable filers in the closed quarter only, from `agg_ticker_holders` (a non-notable and an open-quarter fixture row are excluded), else a `Planned` badge; merged timeline is 20 rows ordered by filed date; walkthrough 3 restated: Congress landing → Tickers · most disclosed → a ticker → overlap band lists a notable manager adding → click it → filer page | band renders on NVDA in a local build |
| T21 holders route generation from class-grain `agg_ticker_holders`, plus the T20 overlap band | R20 | render test: the holders page contains the overlap band; post-build: `/institutional/tickers/NVDA/holders/` returns 200 and lists ≥10 holders including BlackRock, Vanguard, State Street; a test enumerates the top-50 congress tickers by disclosures and asserts ≥80% generate a holders page (list reported); distinguishing check: `SELECT issuer_key_source, COUNT(*) FROM agg_issuer_top_holders GROUP BY 1` recorded before/after | acceptance met on a local real-data build |
| T22 M2 gate: standing gates + SRC §8 walkthrough 3 | R28 | standing gates green | M2 committed locally |
| T23 `cardFoot()` + convert six footers | R21 | `format.test.ts`: short/`ⓘ`/`<details>` branches | six footers converted |
| T24 header label pass | R22 | geometry lane at ≥900 px shows full words; <900 px abbreviation with `ⓘ` | no abbreviated header at ≥900 px |
| T25 SRC §5 copy replacements + methodology anchors | R23 | `dashboard/test/post/refinement-dist.test.ts`: each SRC §5 observed string returns 0 in `dist/`; each anchor id exists on `/methodology/` | §5 fully applied |
| T26 remove empty panels, `Planned` lines, drop Turnover and Congress overlap columns | R24 | render tests: no frame-plus-paragraph panels; directory has no `—` columns | one `Planned:` line per page |
| T27 `issuer_key` on `serving_filer_rows`; fold + group by issuer | R25 | `tests/test_inst_serving.py`: column populated; `holdings.test.ts`: one row per issuer, expand shows raw rows | no duplicate issuer rows |
| T28 member signal cards ticker-first | R26 | render test: first cell is the ticker | ticker named on every card |
| T29 banned-vocabulary gate | R27 | `banned-wording.test.ts` extended; a planted term in a fixture page fails it | gate green on real `dist/` |
| T30 M3 gate: standing gates + full SRC §8 walkthrough; final stop at local commits | R28 | standing gates green; `git log origin/main..HEAD` shows only local commits; `git status` clean | run ends; no push, PR or deploy |
| T31 rollback smoke test (M1 gate): baseline artifacts copied and hashed before M1 pipeline work; new code built against the baseline artifacts (no `agg_ticker_holders`, no `serving_position_display`, no `held`) completes filer payload assembly and `npm run build:bounded`; restoring the baseline artifacts verifies their sha256 | R28 | scripted check; transcript in Dev Notes | both checks pass before the M1 commit |

## Rollout and Rollback

1. Work only in `/Users/johnbaek/projects/Populus/.claude/worktrees/refinement-20260910`. Copy
   any gitignored input the build needs (e.g. `.env`) from the main checkout; do not touch the
   `dashboard/node_modules` symlink.
2. Real-data builds: point `POPULUS_BUILD_DIR`, `POPULUS_INST_DB`, `POPULUS_TICKER_MAP` at
   worktree-local copies or new directories; never write into the main checkout or into
   `/Users/johnbaek/populus-build-20260817.1` (read it only for baseline measurements). Rebuild
   `inst_agg.db` / `inst_serving.db` after M1 pipeline tasks, then `npm run build:bounded`.
3. Order: M1 pipeline tasks (T3, T5, T6, T8, T9 Python half) before M1 render tasks, because
   fixtures need the `held` code and the issuer-name join; then M2; then M3.
4. Commit locally at the end of each milestone after its gate task (T11, T22, T30). Never push,
   open a PR, or deploy.
5. Rollback — code and artifacts move together. Before the first M1 pipeline change, copy the
   baseline `inst_agg.db`, `inst_serving.db` and built `dist/` into a new directory outside both
   checkouts (e.g. `~/populus-build-refinement-baseline/`) and record their sha256. Reverting code
   alone is NOT a rollback: the old dashboard rejects any change kind outside its set during
   payload validation (`filer-payload.ts:388`), and the `agg_qoq_deltas` view that emits `held`
   is stored inside the new aggregate. Rolling back a milestone = `git revert` of its local
   commit series AND either restoring the hash-verified baseline artifacts or rebuilding them
   with the reverted producer. In the other direction the new dashboard must tolerate baseline
   artifacts: absent `agg_ticker_holders` / `serving_position_display` tables and no `held` rows
   are treated as "no data" (no tickers; position key shown in place of the name). T31 is the
   rollback smoke test.
6. Stop conditions: any gate red; R5 growth >25% or a file ≥90% of 25 MiB; Tier C verification
   cannot reach the target set (report achieved count and residue instead of shipping guesses).

## Risks, Debt, and Failure-Mode Sweep

### Risks

- **`npm ci` destroys the shared `node_modules`.** `make dashboard-gates` and `make security`
  run `npm ci`, which removes `dashboard/node_modules` — here a symlink into the main checkout.
  Run `npm run gates` and `npm audit` directly; never `npm ci` in the worktree.
- **CUSIP co-publication (operator residual).** Filer shards already publish `cusip`,
  `issuer_name` and `title_of_class` per row (`filer-payload.ts:172,297`). Adding a verified
  ticker on the same issuer makes a CUSIP→ticker pairing derivable from published data even though
  no CUSIP-keyed table exists. The mapping file and `agg_ticker_holders` carry no CUSIP (LD2);
  whether derivability matters is part of the owner's `cusip-redistribution` counsel question and
  is surfaced to the owner, not decided here.
- **Owner spot-check is operator-only.** The 50-row sample manifest is produced; the spot-check
  happens before any merge, which is outside this run's stop point.
- **Verification volume.** ~4,000 hand-verified rows is the largest task; partial completion
  ships fewer tickers (never guesses) and is reported with the residue.
- **Real-data acceptance depends on the local 13F store and a 32 GiB build.** If the store is
  unavailable, the real-data checks (T1 filer 1067983, T3 Berkshire tickers, T5, T6, T21) are
  recorded as operator-blocked, not passed.
- **Search index budget** is already ~3.9× over (B18.3); R10 adds principal strings — measured,
  not allowed to grow beyond that addition.

### Declared debt

| Debt | Owner | Impact | Removal condition |
|---|---|---|---|
| Legacy flag bit 2 `classified_by_value` label kept in the view | John Baek | dead label in SQL | remove after one build cycle confirms no aggregate sets it |
| Tier C is a hand-maintained file | John Baek | new securities appear unmapped until verified | Tier B lands after counsel answers `cusip-redistribution` |
| `agg_security_directory` (SRC F-1 optional) deferred | John Baek | R1 joins at render | pipeline adds the directory table |

### Failure-mode sweep

- **F0 full-set sweep:** R8 touches every `change_kind` consumer (Python codes, integrity bound,
  SQL view, `activity.ts` + `inst.ts` unions, `CHANGE_KINDS`, `filer-payload.ts`); R9 replaces
  all three `MIN(issuer_name)` sites; R2 covers every `/institutional/tickers/` href via the dist
  scan; R23 is verified by a grep of every SRC §5 string. **Secrets:** no credentials involved.
  **Verify, don't assume:** real-data acceptance runs against a build, never asserted from code.
- **F1:** full standing gate set listed; units defined (Δshares, signed Δvalue USD; NULL →
  `unclassified`, never 0); closed-quarter-only measurement (R3 draft, R4 header); re-baselined on
  0c7aa33.
- **F2:** full-tree gates; every new boundary has a failing-if-removed test (T2 href scan, T8
  mutation, T29 planted term); stale comments fixed after moves; no dead CSS selectors after
  removing the overlay popover.
- **F3:** function verified end to end via the walkthroughs; doc numbers (coverage %, row counts)
  reconciled against the build.
- **F4/F5:** plan validated with `workflow_validate_content` before review; any source repair
  invalidates prior QA evidence.
- **N/A:** auth/RLS, SQL pooling, production writes, bulk backfills (no production database).
