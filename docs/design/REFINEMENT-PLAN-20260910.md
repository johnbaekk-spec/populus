# Refinement plan — publicfilings.org build 20260910.1

**Status:** proposed 2026-09-10, grounded in the live site and `origin/main` @ `4f4769d`.
**Inputs:** the owner's click-through audit (P0–P3, 20 findings), three code traces of the
dashboard and pipeline, and live probes of the served artifacts (routes, search index,
activity shards, filer pages). Every cause below cites the file that produces the symptom.
**Audience:** the engineering agent. Milestone 1 (§7) is startable without a question.

Two audit assumptions were corrected by the traces and change the sequencing:

- The `sid:sec:prov:…` keys on filer pages **can be named today**. The same rows in the
  activity shard already carry `issuer_name` and `cusip6` (`serving_activity`), and the
  filer's own holdings rows carry `issuer_name` + `cusip`. The QoQ table simply never
  joins them (`dashboard/src/lib/ui/institutional.ts:391` prints the key verbatim). Render
  fix, milestone 1.
- The TICKER column and the `/institutional/tickers/{T}/holders/` route are **not** a
  render bug and **not** the missing `POPULUS_TICKER_MAP` (that is set since #106,
  `.github/workflows/publish.yml:513`). Both need a CUSIP→issuer bridge; 0 of 26,158 13F
  securities are entity-resolved, and the bridge is gated on the `cusip-redistribution`
  counsel question (`docs/roadmap.md:82-88`). §3 gives a no-CUSIP interim that the owner
  must approve or reject; the route is made non-dead either way.

---

## 1. Product principle

Public Filings exists so that an ordinary person can open it and see **who the main players
are, what they just did, and go one or two clicks deeper** — without reading a wall of words.
The site already has the receipts; this plan changes only *where they sit*.

**The one rule that resolves every hierarchy conflict:**
**Data first. Receipts one click away. Methodology one click further.**
If a panel, strip, or sentence does not answer the page's single question (§2), it moves
below the data, behind a disclosure, or to `/methodology/`. Nothing is deleted.

**Voice rules for copy (apply mechanically):**

1. Every inline explainer longer than one line becomes a disclosure (`ⓘ` popover via
   `note()` in `format.ts:227`, or a `<details>` "How this is computed").
2. Every abbreviated column header gets a full-word label at ≥900 px; the abbreviation
   survives only under 900 px, with the full word in the `ⓘ`.
3. No pipeline vocabulary in user-visible text: *render bound, shard, projection,
   tombstone, coverage bucket, change_kind, grain, watermark, bioguide*. Each has a plain
   replacement in §5.
4. A number's caveat travels with the number as a marker (`LATE·371d`, `≈`, `§`), never
   as a paragraph above the table.
5. Empty panels are removed, not explained. A planned panel is one `Planned` badge line.

---

## 2. Information architecture

Template for every entity page: the congress ticker page (`/congress/tickers/NVDA/`) —
identity line → 4 stats → one chart → the ranked "who" table → the transaction list with
inline flags → footnotes. Below, (a) question, (b) above the fold in order, (c) collapsed,
(d) removed.

### Home `/`
- (a) *Who moved this week, and where do I go?*
- (b) 1. One-line masthead claim (≤12 words) + search box. 2. **Three live tiles**: latest
  Congress disclosures (5 rows: member · ticker · side · amount · filed), notable-manager
  moves this quarter (5 rows, §6-i), top Signals (3 rows, ticker first). 3. Module nav
  cards (Congress / Institutional / Signals; Financials, Macro as `Planned`).
- (c) "What a number looks like here" card → a `ⓘ` on the first range amount and a
  methodology link. Philosophy paragraph → one sentence under the masthead, rest to
  `/methodology/#principles`.
- (d) Nothing removed; the hero explainer is relocated, not cut.

### Congress landing `/congress/`
- (a) *Who in Congress is trading, and what?*
- (b) 1. **Leaders · net disclosed flow** — 10 rows, sortable, full-width, top of page
  (today: 5 rows at the bottom). 2. **Tickers · most disclosed** — 10 rows. 3. The feed,
  50 rows per page, filters in a sidebar/inline panel that never covers the table.
- (c) The coverage strip (`TRANSACTIONS · HOUSE PARSE · SENATE PARSE · PAPER`) → one
  line "71,852 disclosures · updated {date}" with a `ⓘ` carrying parse rates and paper
  counts. The three context cards (largest lower bound, late filing, known gaps) → a
  single collapsed "Notes on this data" `<details>` below the feed.
- (d) Nothing.

### Member page `/congress/members/{bioguide}/`
- (a) *What does this member trade, and what did they do last?*
- (b) 1. Identity line (name · party–state · committees). 2. 4 stats: disclosures ·
  net flow range · distinct tickers · late filings. 3. Quarterly buy/sell chart (as the
  ticker page). 4. **Tickers this member trades** ranked (buys/sells/flow, like "Members
  disclosing NVDA"). 5. Transactions with `LATE` flags and receipts. 6. Signals for this
  member, **ticker first** in each card.
- (c) Coverage/context band → footnotes.
- (d) *Holdings from annual disclosure*, *Reconciliation*, *Institutional overlap* panels
  and the `—` stats they feed: removed (data-bound; annual FD not ingested). One
  `Planned: annual holdings, 13F overlap` line under the stats.

### Congress ticker page `/congress/tickers/{T}/` — keep as is
- (a) *Who in Congress trades this ticker?* Already answered. Changes: the
  "13F institutional holders ↗" link is gated on data (§3 F-2); the coverage band folds
  into footnotes; headers get full-word labels.

### Institutional landing `/institutional/`
- (a) *What did the big managers just do?*
- (b) 1. Period selector (closed quarters only) + one line "Latest closed quarter
  2026-03-31 · N filers reported" — **one source for both numbers** (§3 F-3).
  2. **Notable managers — latest named moves** (§6-i): 15 rows, ticker/issuer first,
  add/new/trim/exit **by shares**, size, filing link. 3. **Manager directory** with the
  existing filter chips, *Hedge funds* selected by default when the visitor has no
  watchlist, principal names shown, "Latest notable" column naming the issuer.
  4. Consensus board (§6-iii) restricted to the notable set.
- (c) Recent activity feed → below the fold, **restricted to notable filers**, artifact
  rows suppressed (§3 F-4), ordered by filed date then |Δshares×price| not raw |Δvalue|.
  Cluster board, shard-budget paragraph, "Position discovery / Quarterly record /
  Reported changes" cards → removed or one footnote line.
- (d) Hero stat "Consensus add: 1ISHARES TR" until §3 F-6 lands (then restored with a
  normalized name). Conviction leaders over all 9,451 filers → replaced by the notable-
  restricted version (§6-i, "new stake ≥2% of book" screen over notables only).

### Filer page `/institutional/filers/{CIK}/`
- (a) *What does this manager hold, and what changed last quarter?*
- (b) 1. Identity (name · principal · type · AUM-reported). 2. 4 stats: reported value ·
  positions · new stakes · exits (closed quarter). 3. **Position changes** — issuer name
  first (§3 F-1), Δshares, Δvalue, kind-by-shares, filing link; 20 rows + real show-more.
  4. **Holdings** — one row per issuer (§4), expand to share classes / filings.
- (c) The dual-period selector stays but shows only periods with rows. Value-only changes
  move to a separate collapsed "Mark-to-market only (no share change)" group.
- (d) *Sector rotation*, *Congress overlap*, *Signals for this filer* panels → one
  `Planned` line. The "as it reported it" duplicate rows → inside the issuer expand.

### 13F holders page `/institutional/tickers/{T}/holders/` — fixed route
- (a) *Which institutions hold this ticker, and who added?*
- (b) 1. Identity (ticker · issuer). 2. 4 stats: holders · combined value · adds ·
  exits. 3. Holders ranked by value with Δshares and kind. 4. Link to the Congress
  ticker page ("N members disclosed {T}").
- Interim while the CUSIP bridge is pending: `/institutional/tickers/{T}/` **redirects to
  `/tickers/{T}/#institutional`** (the unified page, live today), and the congress-page
  link points there and only renders when that section has data. The dedicated holders
  page generates for every ticker the bridge resolves (§3 F-2).

### Signals `/signals/`
- (a) *What unusual thing just happened, in which ticker?*
- (b) 1. Hits table: **Ticker · Who · What (rule short-name) · Filed · Size · Src**,
  50 per page with a real pager over `signals.v1.json` (486 KB, already complete).
  2. Filter by rule and by watchlist.
- (c) Rule Book → `<details>` per rule *below* the hits, and the rule text also behind
  the `ⓘ` on each hit's rule name. Evidence column → one short line ("first MCD
  disclosure by this member"), full evidence in the row expand.
- (d) The 90-row Superseded/tombstone table → removed from the page; kept in the JSON
  artifact and linked from the footnote as "changes since last build".

---

## 3. Data fixes required before UI work (P0)

Layer legend: **P** = pipeline (`src/populus/…`, changes `inst_agg.db`/serving DB),
**R** = dashboard render (`dashboard/src/…`), **CI** = workflow/env, **O** = owner decision.

### F-1 · Position-change table shows `sid:sec:prov:…` — **R** (M1)
- **Symptom:** filer page "Position changes" first column is the raw position key; no
  issuer name.
- **Cause:** `institutional.ts:391` renders `position_key` verbatim; the `QoqDeltaRow`
  loader (`inst.ts:172-176`) never selects a name because `agg_qoq_deltas` has none. But
  the same `(cik, period, position_key)` exists in `serving_filer_rows` with
  `issuer_name`, `cusip`, `title_of_class`, and in `serving_activity` with `issuer_name`
  and `issuer_key`.
- **Fix:** in the QoQ loader, LEFT JOIN the current-period holding row on
  `(cik, period, position_key)` and select `issuer_name`, `title_of_class`, `cusip`; render
  `issuer_name` as the first column, class as secondary ink, the key inside the row's
  `ⓘ`. Fall back to the prior-period row for exits. Pipeline follow-up (optional, M3): the
  planned `agg_security_directory` (R8) makes this a first-class column.
- **Acceptance:** on `/institutional/filers/1067983/` every Position-changes row shows a
  non-empty issuer name; zero cells match `/^sid:/`; a node test over the fixture build
  asserts the join covers 100% of `new/add/trim` rows and ≥99% of `exit` rows (report
  the residue).

### F-2 · Holders route 404 and TICKER `—` — **P + O** (M1 for the dead link, M2 for data)
- **Symptom:** `/institutional/tickers/NVDA/holders/` and `/institutional/tickers/NVDA/`
  404; TICKER column is `—` on every holdings row.
- **Cause:** `holders.astro:23-34` generates only when some holder row has
  `issuer_key_source === "entity"`; `inst_agg.py:108-126` emits `entity:` keys only for
  entity-resolved securities, and 0 of 26,158 are resolved. `company_tickers.json` has
  no CUSIP, so nothing bridges a 13F CUSIP to a symbol. The ticker cell is a hardcoded
  `—` at `holdings.ts:1352`. The link at `congress.ts:597-599` is emitted unconditionally.
- **Fix, M1 (R):** gate the congress-page link on `tickerInstSection(build, t).state ===
  "data"`; add `/institutional/tickers/[t]/index` as a redirect stub to `/tickers/{T}/`;
  add a post-build test that every `/institutional/tickers/…` href in `dist/` resolves.
- **Fix, M2 (P, O):** build the CUSIP→issuer bridge. Two tiers, owner picks:
  - *Tier A (no CUSIP redistribution):* deterministic **exact normalized-name match**
    between 13F `issuer_name` (upper, punctuation-stripped, corporate suffixes folded:
    INC/CORP/CO/LTD/PLC/TR/TRUST) and `company_tickers.json` `title`, one-to-one only,
    ambiguous names unmatched, result flagged `name-matched` on every row and in the
    `ⓘ`. This violates the current G14 "symbols are not inferred from names" rule; the
    plan proposes amending G14 to "…except one-to-one exact-name matches, always
    flagged". Coverage test on the closed quarter: expect large caps (NVDA, AAPL, MSFT,
    BRK) resolved; publish the hit rate.
  - *Tier B (counsel-gated):* the FTD/registry CUSIP crosswalk in `identity/bootstrap.py`
    → `security_supersessions` → `entity:` keys. Correct and complete; blocked on the
    `cusip-redistribution` question. The site would store CUSIP→CIK internally and
    publish only ticker/name, which may already satisfy counsel — ask.
  - **Tier C (OWNER-CHOSEN 2026-09-10):** a reviewed mapping file, built like
    `manager_registry.yaml`, keyed on the SEC canonical issuer name + title of class (from
    the Official 13(f) List / the filed `issuer_name`), **never on CUSIP**, so no CUSIP→ticker
    database is created or published. Process: (1) auto-draft a candidate ticker for every
    security in the closed quarter by exact normalized-name match against
    `company_tickers.json`; (2) verify row by row every security in the top 2,000 by
    aggregate reported value (~95% of dollars, Q1 2026: 29,883 securities total, top 1,000 =
    88.1%, top 2,000 = 95.3%) plus every security held by the 37 `notable` managers (~3,446),
    about 4,000 rows after overlap; verification checks issuer identity and share class
    (e.g. Alphabet Class A → GOOGL, Class C → GOOG; Berkshire Class B → BRK.B); (3) each row
    records `verified_date`, `verified_by`, and `method` (`exact-name` | `class-resolved` |
    `manual`); (4) unverified or ambiguous rows ship **no ticker**, never a guess; (5) the
    owner spot-checks a random sample of 50 verified rows before merge, and the file carries
    a sample manifest so the spot-check is reproducible. The render marks every ticker from
    this file in its `ⓘ` as "verified against the SEC company list on {date}". G14 is
    amended to: "Symbols are never inferred automatically; only reviewed mapping rows supply
    a 13F ticker."
- **Acceptance:** `/institutional/tickers/NVDA/holders/` returns 200 and lists ≥10
  holders including BlackRock, Vanguard, State Street; Berkshire's holdings table shows
  `AAPL`, `KO`, `BAC`; a test enumerates the top-50 congress tickers by disclosures and
  asserts ≥80% generate a holders page (report the list that does not).
- **Test that distinguishes "intended" from "bug":** `SELECT issuer_key_source, COUNT(*)
  FROM agg_issuer_top_holders GROUP BY 1` — if `entity` is 0, the route is doing what its
  gate says and the gap is data; any other result is a render bug.

### F-3 · Stale-quarter contradiction — **P + R** (M1)
- **Symptom:** landing says "Latest quarter-end 2026-06-30 · 3,660 filed"; filer pages
  say only 2026-03-31 is in the projection, yet render period buttons back to 2025-03-31.
- **Cause:** three different sources. Header date = manifest watermark
  `MAX(period_of_report) FROM v_default_inst_filings` over the whole corpus
  (`publish/build.py:1360-1366`), which one early Q2 filer sets. "3,660 filed" = count in
  `agg_filer_concentration` for the newest *closed* period (`inst-analytics.ts:28-62`) —
  i.e. 2026-03-31, not 2026-06-30. Filer pages read `serving_filer_rows`, which the
  projection limits to `PUBLISHED_PERIODS = 2` (`inst_serving.py:68,133-152`). The
  rendered period buttons are the analytics period list, not the filer's rows.
- **Which is true:** run against the build dir —
  ```
  sqlite3 inst_serving.db "SELECT period, COUNT(*) FROM serving_filer_rows GROUP BY 1"
  sqlite3 inst_agg.db "SELECT period_of_report, COUNT(*) FROM agg_filer_concentration GROUP BY 1 ORDER BY 1 DESC LIMIT 3"
  jq .modules.inst.watermarks manifest.json
  ```
  If `agg_filer_concentration` has ~3,600 rows for 2026-03-31 and a few dozen for
  2026-06-30, the header is **wrong as a "latest quarter" claim** and Q2 is genuinely not
  yet closed in this build (Q2 13Fs due 2026-08-14; the corpus ingest may lag — B25 in the
  roadmap says CI builds hold only a settled window). If 2026-06-30 has thousands of rows
  but `serving_filer_rows` lacks it, the projection budget dropped it.
- **Fix (R):** the header shows the **closed analytics period** and its filer count from
  the same table; the watermark moves to the footnote as "newest filing received:
  {date}". Period buttons render only periods with rows for that filer. **Fix (P):**
  raise `PUBLISHED_PERIODS` to 4 for notable filers (registry `notable`), 2 for the rest,
  so "compare against prior quarter" works where it matters; measure the serving DB
  delta before merging.
- **Acceptance:** landing header date == the period every filer page defaults to; no
  disabled/empty period button; Berkshire shows ≥2 browsable quarters.

### F-4 · "BlackRock exited NVDA/AAPL" artifact — **P** (M1)
- **Symptom:** Recent activity leads with `exit · NVIDIA · BlackRock, Inc. · $0`.
- **Cause:** two defects. (1) Ordering is `abs(delta_value_usd) DESC` over all 3.2M rows
  (`activity.ts:92-99`) and the money cell renders `curr_value_usd`, which is 0 for an
  exit — the sort key is not what is displayed. (2) `_match_periods`
  (`inst_agg.py:290-300`) pairs periods within one CIK only; BlackRock Inc (CIK 2012383)
  succeeded BlackRock Finance (1364742) and the old CIK's whole book reads as exits. The
  registry already knows this (`manager_registry.yaml:767-769, 1082-1083`) but nothing
  consumes it.
- **Fix (P):** add `predecessor_ciks` to the manager registry schema; in
  `_match_periods`, when a CIK has no prior-period filing, look up its predecessor's
  filing for that period; flag rows `filer_migrated`. Independently, add an
  **artifact suppressor**: a filer whose *entire* book (≥95% of positions) reads `exit`
  in one period with no successor match is flagged `book_discontinuity` and excluded from
  landing feeds (still in shards, still in the filer page with a banner).
- **Fix (R):** activity money column shows `Δ value` with sign; landing feed restricted to
  `notable` filers (join `agg_manager_registry.notable`), ordered filed-date desc then
  |Δvalue|.
- **Acceptance:** BlackRock Inc shows AAPL/NVDA as continuing positions with a real
  Δshares; no row on the landing feed has kind `exit` and `curr_value` 0 where the
  predecessor still reports it; a fixture test with a synthetic CIK migration passes.

### F-5 · Value-only rows labeled add/trim — **P + R** (M1)
- **Symptom:** ΔShares = 0 rows labeled `trim`/`add` with a "classified by value" flag.
- **Cause:** `inst_agg.py:263-265` falls through to sign-of-Δvalue when Δshares is 0 or
  NULL; `delta_value == 0` also yields `add` (`>= 0`).
- **Fix (P):** Δshares == 0 → new kind `held` (code 5, "no share change"); Δshares NULL
  with units mismatched stays `unclassified`; `classified_by_value` is retired. Public
  view `inst_agg.sql:81-118` gains the code. **Fix (R):** `held` rows render in a
  collapsed "Mark-to-market only" group; every landing/notable feed excludes them; kind
  labels read `Add / New / Trim / Exit / No change`.
- **Acceptance:** no visible row has kind add/trim with Δshares 0; a mutation test that
  restores the value fallthrough fails.

### F-6 · "1ISHARES TR", "HONA", "438516106" — **R + P** (M1)
- **Cause:** `MIN(issuer_name)` over raw filed names at `activity.ts:1368` (and
  `inst_agg.py:1959, 2003`); leading digits and CUSIPs typed into the name field win. The
  adds leaderboard already uses a modal pick (`_adds_issuer_name`, `inst_agg.py:1240`).
- **Fix:** one shared `displayIssuerName(names[])`: modal name, drop pure-numeric or
  ≤3-char candidates when a longer one exists, fold `TR`→`TRUST`, title-case. Use in the
  cluster board, hero stat, and both pipeline aggregates.
- **Acceptance:** no issuer label on `/institutional/` matches `/^\d/` or `/^[A-Z0-9]{9}$/`;
  fixture test over the observed bad names.

### F-7 · Search misses principals and ranks nothing — **R** (M1)
- **Cause:** filer tuple is `[cik, name, top]` (`data.ts:912-916`); `ManagerTyping.person`
  and `notable` are loaded (`inst.ts:405-426`) but never indexed; `searchQuery`
  (`derive.ts:1460-1500`) is a linear pass in alphabetical order with `limit 8`. Also
  55 ticker entries are malformed (`"--\n …AM"`) — the raw ticker text was never
  trimmed before indexing.
- **Fix:** filer tuple becomes `[cik, name, principal|"", notable 0|1, top]`; match on
  name **or** principal; rank notable first, then by row count; render "Citadel Advisors ·
  Ken Griffin" as one result. Trim/normalize the ticker key at index build and drop
  entries that fail `/^[A-Z.\-]{1,6}$/`. Add an alias list to the registry for
  colloquial names (Berkshire→1067983, Druckenmiller→Duquesne, Burry→Scion, Li Lu→
  Himalaya, Tepper→Appaloosa, Ackman→Pershing Square, Cohen→Point72, Griffin→Citadel).
- **Acceptance:** "Druckenmiller" → Duquesne Family Office first; "Berkshire" →
  Berkshire Hathaway Inc first with "Warren Buffett"; zero index keys contain
  whitespace; index stays ≤ its budget after the change (B18.3 is already 3.9× over —
  measure, do not worsen).

---

## 4. Component-level changes

| Component | Current | Target | Pri | Effort |
|---|---|---|---|---|
| Feed page size (`format.ts:759`) | 8 rows; client pages a 16.8 MiB single JSON | 50 rows/page; SSR page 1 with 50; feed JSON split into per-year shards under the 1 MiB `SHARD_RESPONSE_CEILING` so the first paint needs one shard | P1 | M |
| "More filters" (`late-additions.css:822`) | absolute popover over the table at ≥1081 px | inline collapsible row above the table at every width, or a left sidebar at ≥1280 px; never overlays rows | P1 | S |
| Table footers (`congress.ts:342,618,830,856`, `ticker.ts:216`, `signals.ts:659`, `INST_STAMP_CAVEAT`) | inline monospace paragraphs | one shared `cardFoot({short, full})` in `format.ts`: short one-liner + `ⓘ` with full text; `<details>` "How this is computed" when >2 clauses | P3 | S |
| Column headers (`congress-columns.ts`, `DESIGN_INST_INDEX_HEADS`) | `RCPT`, `TXNS`, `Δ POS`, `INTERVAL · LOG $1K–$50M+`, `GROSS PURCH ·§` | full words at ≥900 px (`Source`, `Trades`, `Position change`, `Amount range`, `Gross bought`); abbreviation only <900 px; `§`/`ⓘ` retained | P3 | S |
| Compact/"render bound" (`compactDisclosure`, `format.ts:1387`) | 5–10 rows, "Show all" hidden until the 16.8 MiB feed loads; bound text | Leaders 10 rows SSR + "Show 50 more" server-rendered from the same data (static: emit hidden rows or a per-section JSON shard); no "render bound" copy | P1 | M |
| Signals hits (`signals.ts:259,315`) | 60 cap, member panel 10, 801 "not rendered" | pager over `signals.v1.json` (50/page), Ticker column first, evidence one line + expand | P1 | M |
| Superseded table (`signals.ts`) | 90 rows on page | removed; footnote link to artifact | P1 | S |
| Empty panels (`shared.ts:82` callers, §3 table) | frame + paragraph | removed; one `Planned:` line per page listing them | P2 | S |
| Filer directory `—` columns (`inst-index.ts:329-338`) | Turnover / Top-5 / Congress overlap headers with `why` | drop Turnover and Congress overlap columns; "Latest notable" names the issuer + kind + Δshares | P2 | S |
| Signal cards on member page (`signals.ts:645-658`) | Kind · Filed · Magnitude · Src | **Ticker** · Kind · Filed · Size · Src — `s.entities.ticker` is already in scope | P2 | S |
| Duplicate issuer rows (`filer-payload.ts:160-200`) | one row per holding row × filing × class | fold by `position_key|put_call|unit` via existing `foldPositions`, then group by `issuer_key` (add `issuer_key` to `serving_filer_rows`, `inst_serving.py:558-575`); expand shows the raw rows | P2 | M |
| Search results (`search-client.ts`, `derive.ts:1460`) | name only, alphabetical | principal + notable ranking (§3 F-7) | P0 | S |
| Activity feed (`activity.ts:1218,1294`) | all filers, `abs(Δvalue)` sort, shows curr value | notable only on landing, filed-date then Δ; shows signed Δvalue and Δshares | P0 | S |
| Institutional header stats (`index.astro:173-178`) | manifest watermark + closed-period count | both from the closed period (§3 F-3) | P0 | S |
| Congress coverage strip + 3 cards (`congress/index.astro`) | above the data | one line + `ⓘ`; cards → `<details>` under the feed | P1 | S |
| Leaders section (`congress/index.astro:104`) | `compact: 5`, bottom | 10 rows, first section | P1 | S |
| Home hero (`ui/home.ts`) | philosophy + explainer card | one line + three live tiles (§2) | P1 | M |
| Dead 13F link (`congress.ts:597-599`) | unconditional | gated on section state; redirect stub for `/institutional/tickers/{T}/` | P0 | S |

---

## 5. Copy pass

Every fact is kept; only the location moves. "ⓘ" = `note()` popover; "MP" = methodology anchor.

| Observed string | Replacement (inline) | New home for the full text |
|---|---|---|
| "a render bound, not a data bound" / "801 further hits are in the artifact but not rendered here" | "Showing 1–50 of 861 · Next" | none needed after real paging |
| "Every row remains in the published dataset" | drop | MP `#published-dataset` |
| "v_default_transactions — active filings minus superseded amendment originals" | "Amended filings show the latest version" | ⓘ on the table title |
| "quarter-end 2026-03-31 · latest filing in build filed 2026-07-31 · per-filer filing dates are not in the published aggregate — the filed-date watermark is build-wide, not per row" | "Quarter ended 2026-03-31" | ⓘ: "Newest filing in this build: 2026-07-31. Per-row filing dates are on each receipt." |
| "only 2026-03-31 is in this build's projection for this filer, so there is no prior quarter to browse or compare against" | "Prior quarter not yet available" (only when true after F-3) | ⓘ: "This build carries N quarters per manager." |
| "TRANSACTIONS 71,852 · HOUSE PARSE 93.9% · SENATE PARSE 100% · PAPER 3,053" | "71,852 disclosures · updated {date}" | ⓘ + MP `#coverage` |
| "Position discovery / Quarterly record / Reported changes" cards | remove | MP `#13f-method` |
| "statutory lower bound" | "at least $X" with `≥` marker | ⓘ: "Amounts are disclosed as ranges; this is the low end." |
| "interval subtraction · open bounds propagate" | "net range" | MP `#ranges` |
| "classified by value" flag | gone (F-5); "No change in shares" row group label | ⓘ |
| "producer-classified (change_kind) · grain: position × put/call × unit" | drop | MP `#position-grain` |
| "security not in mapping" chip | "Ticker not yet mapped" | ⓘ + MP `#ticker-mapping` |
| "shard budget" paragraph | drop | MP `#site-weight` |
| "tombstone" / "Superseded — no longer in the current view" | footnote link "Changes since last build" | artifact |
| "gold tick" | "verified" marker | ⓘ |
| "coverage bucket" | "coverage" | MP |
| "bioguide_id=null" | "Member not identified" | ⓘ with the raw name |
| "projection" (user-facing) | "this build" | — |
| Signal evidence "first disclosure of MCD by this member in the corpus" (5 lines) | "First MCD disclosure by this member" | row expand |
| "Jump to a member, ticker or filer" | "Search members, tickers, managers" | — |
| Homepage "The people's financial data, returned to the people… every number tells you exactly how stale it is" | "Who's trading, from the filings themselves." | MP `#principles` |

---

## 6. Alpha surfaces

### (i) Notable-manager moves this quarter — promoted to top of `/institutional/` and a Home tile
```
Manager (principal)   | Ticker/Issuer | Move  | Δ Shares   | Now $   | Δ $     | Filed      | Src
Berkshire (Buffett)   | AAPL Apple    | Trim  | −13.0M     | $57.1B  | −$3.9B  | 2026-05-15 | EDGAR
Point72 (Cohen)       | NVDA Nvidia   | New   | +1.2M      | $1.1B   | +$1.1B  | 2026-05-15 | EDGAR
```
- Population: registry `notable` filers, closed quarter, kinds `new/add/trim/exit` by
  **shares** (F-5), `book_discontinuity` excluded (F-4).
- Sort default: |Δ$| desc within kind priority New > Exit > Add > Trim; secondary filter
  chips: New stakes · Exits · Adds · Trims · Hedge funds · Family offices.
- Rows: 15 SSR, "Show 50 more" from a `/institutional/data/notable-moves/{period}.v1.json`
  shard (≤1 MiB). Row click → filer page anchored at that issuer.
- Ticker column shows the symbol when F-2 resolves it, issuer name always.

### (ii) Congress → 13F overlap for a ticker — new band on `/tickers/{T}/` and the holders page
```
                    Congress (last 90d)              |  Notable managers (closed quarter)
Buyers  4 members   Pelosi, Gottheimer, …  ≥$1.2M    |  Adding  6  Point72, Citadel, Two Sigma …  +$4.2B
Sellers 1 member    Khanna                 ≥$15K     |  Trimming 3 Berkshire, Millennium …        −$1.1B
```
- Two columns side by side; each name links to its page; totals as ranges on the
  Congress side, dollar sums on the 13F side. Below: a merged timeline (filed date,
  actor, move) 20 rows.
- Data: congress side exists today (`tickerInstSection` + rollups); 13F side needs the
  ticker→issuer key (F-2 Tier A or B). Ship the Congress half and a `Planned` badge on
  the 13F half only if F-2 slips.

### (iii) Consensus / cluster signals, tickers first — replaces the cluster board
```
Ticker/Issuer | New stakes (notables) | Adds | Trims | Exits | Net $ | Top mover
NVDA Nvidia   | 4                     | 7    | 2     | 0     | +$6.3B| Point72 (New)
```
- Population: notable filers only; `HAVING COUNT(DISTINCT cik) ≥ 3`; issuer name via
  F-6; sort by new-stake count desc then net $. 10 rows, expand to 50. The hero
  "Consensus add" tile is row 1 of this table.

---

## 7. Sequenced execution plan

### Milestone 1 — Fix (P0 data + route + search)
Definition of done: no `sid:` in any visible cell; no dead `/institutional/tickers/`
href; landing header and filer pages agree on the quarter; BlackRock artifact gone from
the landing; no value-only add/trim; no numeric issuer labels; "Druckenmiller" resolves.

- [ ] F-1 QoQ issuer-name join + render (R) — **M**
- [ ] F-2a gate the dead link; redirect stub; post-build href test (R) — **S**
- [ ] F-2b Tier C: draft all, verify ~4,000 rows, reviewed mapping file, render +
      G14 amendment + coverage report + 50-row owner spot-check manifest (P, O) — **L**
- [ ] F-3 header from closed period; period buttons only where rows exist (R) — **S**
- [ ] F-3 `PUBLISHED_PERIODS` 4 for notables, measure serving DB size (P) — **M**
- [ ] F-4 predecessor CIK in registry + `_match_periods` bridge + `book_discontinuity`
      suppressor (P) — **M**
- [ ] F-4 landing activity: notable-only, filed-date sort, signed Δ (R) — **S**
- [ ] F-5 `held` kind, retire value fallthrough, mutation test (P) — **S**; render
      group (R) — **S**
- [ ] F-6 shared `displayIssuerName` in dashboard + pipeline (R+P) — **S**
- [ ] F-7 search index: principal, notable rank, alias list, ticker key trim (R) — **S**

### Milestone 2 — Reorder (IA + hierarchy + truncation)
Definition of done: every page in §2 has its (b) order; nothing above the first data
table but the identity line and stats; no "render bound" string in `dist/`; feed 50/page.

- [ ] Congress landing: Leaders first (10 rows), tickers second, strip → one line — **S**
- [ ] Feed 50/page + sharded feed JSON (per year) + filter panel inline — **M**
- [ ] Compact sections: SSR 10 + real "Show more" from shard — **M**
- [ ] Institutional landing: §6-i band + directory default Hedge funds + §6-iii — **L**
- [ ] Filer page: template from ticker page (stats, chart, changes, holdings) — **M**
- [ ] Member page: template from ticker page; empty panels → `Planned` line — **M**
- [ ] Signals: pager, ticker-first columns, Rule Book below, tombstones out — **M**
- [ ] Home: one-line masthead + three live tiles — **M**
- [ ] §6-ii overlap band on `/tickers/{T}/` (Congress half now, 13F half when F-2b) — **M**
- [ ] Holders page fixed route generation once F-2b lands — **S**

### Milestone 3 — Polish (copy pass + empty panels + density)
Definition of done: §5 table fully applied (grep for each observed string returns 0 in
`dist/`); all headers full-word at ≥900 px; duplicate issuers folded; signal cards
name the ticker.

- [ ] `cardFoot()` helper + convert six footers — **S**
- [ ] Header label pass (`congress-columns.ts`, `DESIGN_INST_INDEX_HEADS`) — **S**
- [ ] Copy replacements per §5 + methodology anchors — **M**
- [ ] Remove empty panels, add `Planned` lines; drop `—` directory columns — **S**
- [ ] Fold duplicate issuer rows (`issuer_key` on serving rows + `foldPositions`) — **M**
- [ ] Member signal cards ticker-first — **S**
- [ ] `dist/` grep gate for banned vocabulary (§1 rule 3) as a post-build test — **S**

Each milestone ends with `npm run gates`, a live-site walkthrough of §8, and the
existing deploy verifier. M1 and M2 can run as separate PRs; M1 pipeline items ship
first because the dashboard fixtures need the new `held` code and `issuer_name` join.

---

## 8. Acceptance walkthrough (≤3 clicks, no explanatory reading)

1. **"What did Berkshire add last quarter?"** Home → type "Berkshire" → first result
   "Berkshire Hathaway · Warren Buffett" (click 1) → filer page opens on Position changes
   with issuer names, kind by shares; filter chip *New/Adds* (click 2). Done.
2. **"Who in Congress is buying NVDA?"** Home → "NVDA" (click 1) → `/congress/tickers/NVDA/`
   "Members disclosing NVDA" ranked with buys/sells. Done in 1 click (already true today).
3. **"Which hedge funds hold the same names Congress is buying?"** Congress landing →
   Tickers · most disclosed, click NVDA (click 1) → `/tickers/NVDA/` overlap band shows
   Congress buyers beside notable managers adding (§6-ii); click "Point72" (click 2) →
   filer page. Requires F-2b for the 13F half.
4. **"Show me the biggest late filing this month."** Congress landing → feed filter
   *Late only* (click 1) → sort header *Amount* desc (click 2) → top row with `LATE·371d`
   and its PTR receipt. Done.
5. **"Watch Pelosi and see her next filing."** Search "Pelosi" (click 1) → member page →
   *Watch* (click 2) → `/watchlist/` lists her; her next disclosure appears at the top of
   the watchlist feed and in the Signals watch band. Done, no account.

---

## Owner decisions (2026-09-10)

- **Scope:** all three milestones in one development run, in order M1 → M2 → M3. Each
  milestone still ends with its own gate run and definition-of-done check before the next
  starts; a milestone that fails its gates stops the run.
- **History depth (F-3):** 4 quarters for the 37 `notable` managers, 2 for everyone else.
  Measure serving-DB and largest-shard growth before merging; stop and report if growth
  exceeds 25% or any file approaches the 25 MiB Cloudflare Pages per-file cap.
- **Search names (F-7):** index the 113 EDGAR-verified `person` principals already in
  `src/populus/manager_registry.yaml`. No new colloquial alias list this cycle.
- **Stop point:** commit on a branch in a worktree under `.claude/worktrees/`. No push, no
  PR, no deploy.
- **Tickers (F-2b): Tier C — hand-verified, name-keyed ticker list.** Supersedes Tiers A
  and B below for this cycle. See F-2b-C in §3.
