# plan-v1: UX Overhaul — publicfilings.org (translation, curation, and insight layers)

**Transport mode:** `interactive-disk`. **Scope class: L.**
**Revision 3 — 2026-08-14.** **Rebaselined** onto `origin/main` at
`ad7fbd7825899ee1d29c4f90dd91960d239fb0dd`. Revisions 1 and 2 were written against
`feat/run-m2-8-holdings-substrate` at `9e1967d`, which is **90 commits and 87,103 insertions
behind** that base; external review round 2 caught that several requirements specified
building code that had already landed. Every claim below was re-verified against the pinned
base. Remediates 19 blockers from round 1 and 11 from round 2
(`.codex-review/uxoverhaul-{1,2}.codex.last.txt`; disposition in
`.codex-review/RESOLUTION-NOTES.md`), and folds in owner decisions of 2026-08-14.

---

## Goal and Success Criteria

Turn the site from a filing viewer — correct, provenance-rich, and unreadable to a
non-specialist — into a surface an average retail investor stays on, explores, and returns
to, **without weakening a single provenance guarantee**.

Success =

1. A visitor who has never read a 13F can open any filer page and learn what that manager
   reported holding, what changed, and whether that change means anything for this kind of
   manager, before scrolling past a caveat block.
2. No default view renders an internal identifier — `sid:` key, raw flag slug, schema or
   contract reference. Each remains reachable one interaction away, and printable.
3. `/institutional/` ranks by research-worthiness rather than size, with every filer one
   click away.
4. A filer page renders differently by archetype, because a dealer's hedged option ledger
   and a concentrated manager's five new positions are not the same kind of fact.
5. The sector panel that already exists on member pages **actually renders**, because the
   data behind it is produced and published.
6. Every honesty feature still exists, relocated but never removed, and a test fails if any
   is dropped.
7. Nothing claims to know a congressional balance, because the filings contain none.
8. The pipeline can ship it: a completed deploy exists, and the nightly is armed only once
   it is safe to arm.

---

## Requirements

Stable IDs carried from Revision 1 so review traceability survives. Each recurs verbatim in
Implementation Tasks, Verification Matrix, and Definition of Done. `[PIPELINE]` marks
`src/populus/`; `[FRONTEND]` marks `dashboard/`; `[OPS]` marks the deploy backlog.
**`[EXTEND]` marks a requirement that Revision 2 wrongly described as new work and that the
rebaseline reclassified as extending landed code.**

### Preconditions

- **R32** The plan is baselined at `origin/main@ad7fbd7`. The implementation branch is cut
  from that commit into a worktree under `<repo>/.claude/worktrees/`, never the stale
  feature branch. If the base advances before work starts, the survey in Current State is
  re-run and any contradicted claim corrected before the affected task begins.
- **R33** The 25-row audit disposition matrix below covers every audit finding, so none can
  be dropped while internal IDs still look traceable.
- **R29** `[PRECONDITION]` The three permanently failing tests in
  `tests/test_m2_11_qa_bundle.py` must be repaired or removed **before the first
  `make check`**. The canonical gate runs `uv run pytest -q` unfiltered while CI deselects
  those three nodes, so every milestone's declared gate is red from the start until this is
  done. Moved out of the standing backlog for that reason.
- **R34** `[EXTEND]` The full-data embed must be proven to fit before implementation. The
  landed holdings component already enforces `HOLDINGS_EMBED_ROW_CAP` of 20,000 rows and
  `HOLDINGS_EMBED_BYTE_CAP` of 2 MiB per page; the measurement therefore establishes whether
  the archetype full-data expansion fits **inside those existing caps** on the largest known
  filer, not against the raw 25 MiB file limit. Exceeding them reopens the mechanism.

### Milestone M0 — deploy closeout, in safety order

- **R2** `[OPS]` The runner controller lock is reboot-safe: it records its owning pid and
  treats a lock whose pid is dead as free.
- **R3** `[OPS]` Runner registration is idempotent (`--replace`).
- **R1** `[OPS]` Only then: roll Cloudflare back to deployment `2f3830b6`, confirm the live
  `populus:code_sha` marker equals `d823597b69d4244b4d78c1bbf6601de4c2390e51`, run one
  publish cycle, witness the deploy job **run** rather than skip, and arm the nightly last.

### Milestone M1 — P0 defects (all three re-verified present at the pinned base)

- **R4** `[FRONTEND]` Remove the build watermark from the masthead. The footer at
  `Base.astro:138` **already** prints the build and code identifiers, so this is a deletion
  of the duplicate at `Base.astro:97`, not a relocation. Add the missing intermediate
  breakpoint so nav, search, and brand cannot collide.
- **R5** `[FRONTEND]` No feed cell paints over its neighbour; each row renders its traded
  date exactly once.
- **R6** `[FRONTEND]` The changes table answers "added or trimmed?" without horizontal
  scrolling, with a scroll affordance at every width.
- **R7** `[FRONTEND]` Member names render legibly; no stat tile is clipped.
- **R8** `[PIPELINE]` `[FRONTEND]` The changes table identifies securities by issuer name
  plus ticker where admitted, never by key — `ui.ts:993` still prints `position_key` raw.
  A period-keyed projection supplies the mapping. Scope is reduced by the rebaseline:
  `issuer_name` is already denormalized onto `serving_filer_rows` and
  `serving_issuer_holder_rows`, so the projection is a join over landed serving data rather
  than a new resolution path. Unresolvable keys render a plain-English unknown.
- **R9** `[FRONTEND]` The stat strip renders exactly the tiles it has data for.
  `global.css:335` is `display: flex`, so this is a flex distribution fix verified by
  rendered geometry, not a grid change.
- **R10** `[FRONTEND]` No raw flag slug reaches a default view **and the fail-visible
  guarantee survives**: an unknown flag still renders a visible generic warning, with the
  escaped raw token in the provenance layer. Near-universal caveats state once at table
  level.
- **R35** `[FRONTEND]` Layout defects are verified by real browser geometry at five widths.
  The browser runtime is a named, provisioned dependency, not left to the implementer.
- **R36** `[FRONTEND]` The analytics mechanism is fully specified before implementation, and
  **the published privacy promise is rewritten in the same change**, because the site
  currently states it collects nothing.
- **R28** `[FRONTEND]` The specified beacon ships with M1, so a pre-redesign baseline exists.

### Milestone M2 — translation layer

- **R11** `[FRONTEND]` One typed slug-to-microcopy map, exhaustive over every existing flag
  and footnote registry.
- **R12** `[FRONTEND]` One shared glossary component, with a static no-JavaScript fallback.
  It must not become a tooltip-only channel: the codebase already forbids that pattern for
  honesty-bearing content, so every definition is also reachable as text.
- **R13** `[FRONTEND]` Per-table footnotes collapse into one "About this data" disclosure
  after the table, generalizing the landed institutional data note rather than replacing it.
  Every caveat carries a **stable caveat ID**; the test asserts ID-set equality across the
  translation, with translated content checked separately. The fold test extension lands
  first.
- **R14** `[FRONTEND]` Contradictory-looking counts get one computed reconciling sentence;
  identical per-row metadata lifts above its table.
- **R15** `[FRONTEND]` No control that cannot act is clickable; the filer page defaults to
  the filer's latest period.
- **R16** `[FRONTEND]` Amount bars declare their scale; dates, filing lag, and owner codes
  render in plain English.

### Milestone M3 — filer intelligence and curation

- **R31** `[PIPELINE]` Calibration is an M3 **entry gate**. Every threshold is selected by a
  specified algorithm over the full corpus on one closed quarter, and its measured outputs
  become the golden fixtures for R17 and R20.
- **R17** `[PIPELINE]` Every filer is classified into an archetype from closed quarters only,
  by **exactly specified predicates** with declared units, denominators, precedence, and
  null behavior, pinned by implementation-independent golden cases.
- **R18** `[PIPELINE]` Identity-language claims are published only for research-confirmed
  filers with a citable source **and an effective period**; outside that interval the
  surface falls back to measured shape language.
- **R37** `[PIPELINE]` `[FRONTEND]` Where a filer has a publicly identified principal, the
  firm renders with that person's name, role, an as-of date, and a source. Entries go stale
  loudly. Principals enter the **shipped search index**, whose producer is
  `dashboard/src/lib/data.ts`.
- **R19** `[PIPELINE]` `[FRONTEND]` The filer template renders per archetype. **Layout and
  suppression sets, not only rationale strings, are separated by confirmation state**, so an
  unconfirmed filer cannot receive identity-specific omissions. Completeness is asserted as
  an exact multiset of defined record identities with a defined compared-field set.
- **R20** `[PIPELINE]` `[FRONTEND]` A published, formula-transparent follow score ranks by
  research-worthiness, never performance; `/institutional/` defaults to it once the top ~150
  are confirmed, with the complete table one click away.
- **R21** `[PIPELINE]` `[FRONTEND]` A bookmarkable notable-managers surface for the most
  recent closed quarter, its JSON emitted through **exactly one** publication topology: a
  dist-only Astro route derived from the aggregate.

### Milestone M4 — insight layer

- **R22** `[FRONTEND]` A quarter digest with exact formulas and a summary sentence that drops
  any clause whose input is missing.
- **R23** `[PIPELINE]` `[FRONTEND]` Four inline-SVG charts per filer page. The codebase has
  no SVG chart today — only the div-based `flowRibbon` — so these are new, dependency-free,
  each with a data-table fallback, each gapping rather than interpolating.
- **R24** `[FRONTEND]` The archetype renders as a one-line context note under the filer name.
- **R25** `[PIPELINE]` `[FRONTEND]` Cross-navigation, scoped explicitly to entity-keyed
  identities. **Production coverage is measured first and the requirement is conditional on
  it**: below the stated floor, R25 defers rather than shipping a feature that links almost
  nothing.
- **R26** `[FRONTEND]` A live institutional module on the homepage; feed rows make the
  member-profile link obvious.
- **R38** `[PIPELINE]` `[FRONTEND]` Institutional filer pages show **reported holdings
  composition** — holdings ranked by share of reported value — above the changes. The word
  "portfolio" is not used as a claim, matching the existing deliberate stance in
  `holdings.ts:175` and `ui.ts:1139`.
- **R39** `[EXTEND]` `[FRONTEND]` Congressional disclosed-trading views. **Largely landed**:
  `memberV2Sections` already renders net disclosed flow by ticker, largest recent
  disclosures, and the correct "flows, not holdings" framing on top of the landed
  `netFlow` algebra. This requirement is reduced to surfacing that work from the feed and
  reconciling its copy with the M2 microcopy map. **No new interval mathematics.**
- **R27** `[FRONTEND]` Site-wide: data precedes caveats, typography separates provenance from
  insight, wide tables behave on mobile without hiding honesty-bearing content.

### Milestone M6 — sector composition

- **R30** `[PIPELINE]` `[EXTEND]` Wire the landed sector and committee ingests into
  `publish.yml`. The CLI command exists at `cli.py:417` and is never invoked, which is why
  every build ships zero `issuer_sic` rows and the member sector panel is permanently in its
  honest-absence state.
- **R40** `[PIPELINE]` Two genuinely new pieces: **(a)** a SIC snapshot producer, because
  `run_sectors_ingest` reads a cached issuer-to-SIC JSON that nothing in the repository
  produces, and library code deliberately never touches the network; and **(b)** an
  investor-legible sector layer over the taxonomy, whose eleven buckets today are 1987 SIC
  divisions that would render a technology-heavy book as "manufacturing". Funds and
  exchange-traded products get a dedicated bucket; unmapped issuers keep the existing
  declared unknown bucket. Neither is ever redistributed.
- **R41** `[EXTEND]` `[FRONTEND]` `sectorMix` already groups and buckets correctly but
  returns raw transaction counts and flow intervals with **no normalization layer**. Add
  proportional rendering plus a ranked list, honoring that congressional inputs are
  interval-valued and cannot produce an exact scalar share.

### Audit disposition matrix (R33)

| # | Audit finding | Disposition |
|---|---|---|
| 1 | Header watermark overlaps nav | R4 |
| 2 | Feed asset/side overprint | R5; root cause differs, and the asset-name column is owned by handoff B-7 |
| 3 | Changes table clipping | R6; it scrolls — the cue and column order are the defect |
| 4 | Member names truncated | R7 |
| 5 | Empty seventh stat tile | R9; flexbox, not grid |
| 6 | Congress landing imbalance | R7 |
| 7 | Contradictory counts | R14 |
| 8 | Dead period tabs | R15 |
| 9 | Redundant per-row dates | R14 |
| 10 | Keys in the changes table | R8 |
| 11 | Flag slugs as UI text | R10, R11 |
| 12 | Universal badge carries no information | R10 |
| 13 | Footnote soup | R13 |
| 14 | Identifiers billed equally with names | R8, R11 |
| 15 | No tickers on the institutional side | R8, bounded by entity-keyed admission |
| 16 | Zero visualization | R23, R41 |
| 17 | No "so what" layer | R22, R38 |
| 18 | No relative context | R22, R38 |
| 19 | Dealer misread trap | R24, R19 |
| 20 | Unlabeled bars and owner codes | R16 |
| 21 | Cryptic dates and lag | R16 |
| 22 | No entity pages from the feed | R26, R39; member page v2 already landed |
| 23 | Homepage sells mission | R26; congress rail already landed |
| 24 | Alarming truncation notices | R13 |
| 25 | Typography and hierarchy | R27 |

No finding is declined.

---

## Scope

| # | Milestone | Requirements | Exit gate |
|---|---|---|---|
| Pre | Preconditions | R32, R33, R29, R34 | Baselined at the pinned SHA; matrix current; unfiltered `make check` green; embed proven inside landed caps |
| M0 | Deploy closeout | R2, R3, R1 | Attested generation; nightly armed last |
| M1 | P0 defects + baseline | R4–R10, R35, R36, R28 | Geometry green at five widths |
| M2 | Translation | R11–R16 | No raw slug, key, or schema reference in any default view |
| M3 | Curation | R31, R17, R18, R37, R19, R20, R21 | Calibration precedes classification |
| M4 | Insight | R22–R27, R38, R39 | Composition precedes changes |
| M6 | Sectors | R30, R40, R41 | The member sector panel renders real data |

Dependency spine: **Preconditions → M0 → M1 → M2 → M3 → M4 → M6.** M6 is sequenced last by
owner decision, and — correcting an earlier claim in this plan's own history — it is **not**
a cheap win: it is blocked on the production identity-mapping decision described in Current
State, which is counsel-adjacent and not a scheduling matter.

---

## Non-goals

- **No price data, ever.**
- **No proprietary sector or identifier standard.** A licensed classification is barred by
  the paid-vendor denylist gate and the open identifier-redistribution flag.
- **No expansion of the current identifier posture.**
- **No accounts, no server-side state.**
- **No rebuilding of landed work.** The interval algebra, the sector ingest and its taxonomy
  loader, the member disclosed-trading sections, the holdings tables, the notable-this-week
  congress rail, and the banned-wording scanner all exist and are extended, not replaced.
- **Not re-planned here:** the watchlist surface, congress leaders, signals — all landed or
  owned by the standing handoff.
- **No claimed congressional balances.**
- **No virtualization.**
- **No use of "portfolio" as a claim** about congressional disclosures.

---

## Constraints

1. **Banned wording is gate-enforced by word-boundary regex.** The scanner is
   `dashboard/test/lib/banned-scan.ts` (16 patterns), which reads raw bytes rather than
   binary-sniffing, because `derive.ts` carries a deliberate NUL byte that makes plain grep
   report a false green. Two consequences bind this plan's copy: **"between" is safe** and
   the noun **"moves" is deliberately admitted**, while **`sold` is banned outright**, so
   R39 and R22 copy says "sales" and "exited". The post-build gate scans `dist/` only and
   asserts an enumerated covered-file list of at least fifty files; new surfaces must appear
   in that coverage.
2. **13(f) value is not assets under management.**
3. **Closed quarters only** for classification, scoring, and aggregates.
4. **Interval arithmetic only through the landed typed algebra** — `sumRanges` and the
   `NetInterval` six-state model with its 5×5 truth table. No parallel implementation.
5. **Quarter-over-quarter copy mirrors the producer.**
6. **Null is not zero, and never satisfies a threshold.**
7. **Fail-visible stays fail-visible.**
8. **`grep -a` always.**
9. **Budgets, at the pinned base:** `GLOBAL_FILE_CAP = 18_000`
   (`src/populus/inst_budget.py:118`, a 90% self-cap against Cloudflare's 20,000, hard CI
   failure) — **not the 15,000 figure Revisions 1 and 2 carried** — plus ≤1,500 filer pages,
   25 MiB per file, and the landed per-page holdings caps of 20,000 rows and 2 MiB.
10. **No new backend queries.**
11. **Nothing honesty-bearing may be hidden by a media query, or exist only in a tooltip.**

---

## Current State

Verified against `origin/main@ad7fbd7`. The stale branch this plan was first written against
is 90 commits and 87,103 insertions behind; treat any Revision 1 or 2 claim not repeated
here as withdrawn.

### Already landed — reclassified from "build" to "extend"

- **Interval algebra, complete.** `sumRanges` (`derive.ts:117`, four kinds), `NetInterval`
  (`:191`, six states), `netFlow` (`:256`), `subNet` (`:247`), `netBounds` (`:218`, which
  throws on undisclosed rather than fabricate an endpoint), `netDirection` (`:263`),
  `netOverlaps` (`:294`, explicitly non-transitive), `compareNet` (`:309`), and
  `rankNetRows` (`:322`, which partitions undisclosed rows into a labeled bucket rendered
  last rather than sentinel-valuing them). The exhaustive 5×5 state-pair table is tested at
  `dashboard/test/net-interval.test.ts:36`.
- **Sector grouping.** `sectorMix` (`derive.ts:724`) with `SectorResolution` (`:712`) and
  three coverage buckets never folded into a sector. It returns transaction counts and flow
  intervals — **no percentage normalization and no fund look-through**, which is the gap
  R41 fills.
- **Sector ingest.** `src/populus/sectors.py`: `sector_for_sic` (`:103`),
  `run_sectors_ingest` (`:123`, full-replace inside `BEGIN IMMEDIATE`), a taxonomy loader
  that rejects overlapping ranges, tables `issuer_sic(cik PK, sic, sector, as_of, source)`
  and `sic_taxonomy_meta`, CLI at `cli.py:417`, tests at `tests/test_sectors.py`.
- **Member page v2.** `memberV2Sections` (`ui.ts:1606`) already renders net disclosed flow
  by ticker, largest recent disclosures, the sector-mix panel, and committee overlap, with
  copy that already states PTRs are flows and explicitly not a portfolio.
- **Filer holdings.** `components/HoldingsTable.astro` over `inst_serving.db`, paginated,
  with provenance cells (`holdings.ts:373-489`) and the embed caps above. The EDGAR block is
  now provenance for those rows, not a substitute.
- **Banned-wording scanner**, NUL-safe and coverage-asserted.
- **Congress notable rail.** `notableRecent` (`derive.ts:868`), `notableRailHtml`
  (`ui.ts:1512`).

### Landed but dark

`run_sectors_ingest` is never invoked by `publish.yml`, and nothing in the repository
produces the issuer-to-SIC snapshot it reads — library code deliberately never performs
network access. So every build ships zero `issuer_sic` rows.

**But producing that snapshot is necessary and not sufficient**, and this is the single most
important correction in Revision 3. `sectorResolver` (`data.ts:461`) returns null when
*either* `sectorData` **or** `tickerMap` is null, because sector resolution runs
ticker → unique issuer CIK (the Locked #18 mapping, ambiguity refused) → producer-resolved
sector. And `publish.yml:325` sets `POPULUS_TICKER_MAP` to a deliberately nonexistent path,
with the reason stated in the workflow itself: there is no real ticker registry on a runner,
and the dashboard refuses a fixture path under CI, so the site renders the honest no-map
state rather than serving fixture-derived tickers as production data.

So the congressional sector panel is dark for two independent reasons, and the second is a
deliberate posture tied to the counsel-gated identity work — not an oversight to be wired
around. R40 cannot be scoped as "a producer plus two workflow steps". Either a
counsel-compatible production identity mapping is established, or the sector contract is
re-keyed onto an identity already admitted. **That decision is a precondition of M6 and is
recorded as an unresolved dependency, not a task.**

### Still broken at the pinned base

- `Base.astro:97` still renders the masthead watermark, **while `:138` already prints the
  same build and code identifiers in the footer** — so R4 is a deletion, not a relocation.
- `ui.ts:993` still prints `esc(d.position_key)` raw in the changes table.
- `global.css:335` `.tiles` is still `display: flex`.

### Contradicted by the site's own copy

`methodology/index.astro:206` publishes: "No tracking, no cookies, no fingerprinting, no
analytics of any kind, and no account required for anything on this site."
`scripts/search-client.ts:52` repeats the claim. The owner decided on 2026-08-14 to add a
cookieless counter **and rewrite this promise accurately in the same change**; R36 carries
the exact replacement copy as a deliverable, so the site never states something untrue about
itself for even one build.

### Deploy state

The pipeline works but no deploy has completed. Live serves a code marker disagreeing with
the only attested generation, so the deployment-record gate refuses the next publish. The
runner is unregistered behind a stale lock.

---

## Detected Stack

Cache absent from `CLAUDE.md`; detected fresh 2026-08-14.

- **Python ≥3.12** at repository root — `pyproject.toml`, `uv.lock`, pytest with
  `testpaths = ["tests"]`, producer code in `src/populus/`.
- **Node / TypeScript (Astro)** at `dashboard/` — `package.json` with `package-lock.json`,
  `astro check`, `node --test`.
- **Canonical gates from `Makefile` at the pinned base:** `make test` = `test-python`
  (`uv sync --frozen`, `uv run pytest -q`, **unfiltered**) then `dashboard-gates`
  (`cd dashboard && npm ci && npm run gates`). `gates` is
  `npm run check && npm test && npm run build:bounded && npm run test:post` — note
  **`build:bounded`, not plain `astro build`**: it refuses to run on a machine with less
  than 32 GiB of physical RAM and sets a 24 GiB old-space limit. Any added post-build
  suite, including R35's, runs inside that chain and inherits the memory precondition.
  `make security` = `uv run python scripts/dep_guard.py`. `make check` = both. Acceptance
  gates `accept-m1-b`, `accept-m2-5`, `accept-m2-6` exist.
- R35's geometry suite joins the post-build stage, which is the only stage with real `dist`
  output to measure.

---

## Reuse Map

| Need | Landed primitive | Disposition |
|---|---|---|
| Interval mathematics | `sumRanges`, `NetInterval`, `netFlow`, `subNet`, `compareNet`, `rankNetRows` (`derive.ts:117-322`) | **Reuse wholesale.** R39 adds no mathematics. |
| Interval truth table | `dashboard/test/net-interval.test.ts:36` | **Reuse as the guard** for any consumer change |
| Sector grouping | `sectorMix` (`derive.ts:724`) | **Extend** with normalization and a fund bucket (R41) |
| Sector ingest and taxonomy | `sectors.py`, `sic_taxonomy.yaml`, `issuer_sic` | **Wire and extend** (R30, R40) |
| Member disclosed-trading sections | `memberV2Sections` (`ui.ts:1606`) | **Reuse**; surface it and align copy (R39) |
| Holdings tables and provenance cells | `HoldingsTable.astro`, `holdings.ts:373-489` | **Extend** for composition (R38) and per-row disclosure (R25) |
| Issuer names for keys | denormalized `issuer_name` on serving rows | **Join** rather than build a resolver (R8) |
| Institutional data note | `institutionalDataNoteHtml` (`holdings.ts:216`) | **Generalize** into the shared disclosure (R13) |
| Flag rendering and raw fallback | `format.ts:246-301` | **Extend**, preserving fail-visible (R10) |
| Footnotes | `footnoteBlock` (`format.ts:644`) | **Extend** with stable IDs (R13) |
| Ribbon and bar primitives | `flowRibbon`, `barHtml` (`ui.ts:114-216`) | **Follow the pattern** for R23 and R41 |
| Concentration statistics | `agg_filer_concentration`, `filerTiles` (`ui.ts:874`) | **Reuse** as chart and score inputs |
| Notable rail | `notableRecent`, `notableRailHtml` | **Follow the pattern** for the institutional twin (R26) |
| Search index | `searchIndexJson` producer in `dashboard/src/lib/data.ts` | **Extend** with principals (R37) |
| Banned-wording scanner | `test/lib/banned-scan.ts` | **Extend coverage** to new surfaces |
| Owner-signed data files | `sic_taxonomy.yaml`, `committee_jurisdiction.yaml` | **Follow the pattern** (R18, R40) |
| Honesty-fold enforcement | `test/css-fold.test.ts` | **Extend, never weaken** (R13) |

---

## Architecture

### R8 — the security directory, period-keyed

`agg_security_directory(period_of_report, position_key, issuer_key, issuer_name,
class_title, ticker NULL, cusip NULL, resolution_source)`, primary key
`(period_of_report, position_key)`.

Period-keying is required: a single row per key would stamp a present-day ticker onto a
historical row. Deltas join on their reporting period; exit rows join on the prior period.
Where one key has several name or class variants in one period, the representative is the
highest reported value, then lexicographic identity. `ticker` is non-null only for
entity-keyed identities. Because the rebaseline showed `issuer_name` is already denormalized
onto serving rows, the projection reads landed serving data rather than re-deriving
identity. An empty resolved name is a build error.

### R17, R31 — calibration algorithm, then predicates

**The selection algorithm (R31), run on the full corpus for one closed quarter.** For each
input, compute the population distribution across all filers with a non-null value, and set
the threshold at the stated quantile, then round to the nearest reportable unit and record
both the raw quantile value and the rounded constant. Acceptance criterion: the resulting
partition must place at least twenty filers in every computed archetype, and moving the
constant by one reportable unit must not change any archetype's membership by more than five
percent — an unstable boundary means the input is not separating and the archetype falls
back to curated-only. All constants are frozen in one module with their measured
justification, and the measured partition becomes the golden fixture set.

**Inputs**, each with unit, denominator, and null rule. A null input never satisfies a
predicate; a filer missing a required input falls through to `unclassified`.

- `options_share_bps` = value where the option marker is present ÷ total reported value ×
  10,000, one closed period. Null when the denominator is null or zero.
- `position_count` = distinct position keys in the period.
- `turnover_bps` = (Σ|delta value| ÷ 2) ÷ mean(prior, current total value) × 10,000. Requires
  two consecutive closed periods; null with one.
- `topn_share_bps`, `hhi`, `max_position_share_bps` — read from `agg_filer_concentration`,
  which already declares its null-denominator rule; null propagates.

**Predicates**, evaluated in this order, first match wins. `T_*` are the constants R31
freezes:

1. `market_maker` — `options_share_bps ≥ T_opt_high` **and** `position_count ≥ T_pos_many`.
2. `index_passive` — `total_value_usd ≥ T_val_huge` **and** `turnover_bps ≤ T_turn_low`
   **and** `position_count ≥ T_pos_vast`.
3. `systematic` — `position_count ≥ T_pos_many` **and** `hhi ≤ T_hhi_low` **and**
   `topn_share_bps ≤ T_topn_low`.
4. `concentrated_manager` — `position_count ≤ T_pos_few` **and**
   `topn_share_bps ≥ T_topn_high` **and** `options_share_bps ≤ T_opt_low`.
5. `diversified_manager` — `position_count ≤ T_pos_vast` and none of the above.
6. `unclassified` — any required input null, or no predicate matched.

`bank_wealth`, `pension_sovereign`, `insurance`, and `activist` are **curated-only**: their
character is not derivable from a holdings filing. A heuristic may nominate a candidate for
research but never publishes those labels.

### R18, R37 — the curated registry

`src/populus/notable_filers.yaml`, owner-signed. Per entry: `cik`, `display_name`,
`archetype`, `effective_from` and `effective_to` as report periods, `notability` as the
enum `household | well_known | specialist` mapping to 3, 2, 1, `note`, `source` with
publication and access dates, `confirmed`, and optionally `principal`, `principal_role`,
`principal_as_of`, `principal_source`.

Effective periods are load-bearing: a present-day source cannot support a claim about a 2019
filing, and firms change character. Outside the interval the surface falls back to shape
language automatically. A principal older than eighteen months raises a build warning,
because leadership changes and a stale name is a false statement about a real person. Where
no single principal is publicly identified the field is absent and nothing renders.

Principals enter the shipped search index through `dashboard/src/lib/data.ts`, with the
principal name indexed as an alias of the filer entry and subject to the same effective
period; a fixture asserts a principal query resolves and fails when the entry is removed.

### R19 — recipes separated by confirmation state

Two recipe families, not one recipe with two rationale strings — the round-2 correction.

- **Identity recipes** apply only to confirmed filers inside their effective period and may
  omit sections on identity grounds (a dealer's option ledger, an index manager's change
  digest), with a rationale naming the identity.
- **Shape recipes** apply to everyone else. They may reorder and de-emphasize on measured
  grounds, but their **section set is the standard one** — nothing is omitted on identity
  grounds, and rationales cite only measured properties.

A DOM-section parity assertion pins the section set per confirmation state, so an
unconfirmed filer cannot receive identity-specific omissions through layout.

**Record identity for parity (the round-2 gap).** The identity tuple is
`(period_of_report, cik, position_key, put_call, ssh_prnamt_type)`. The compared field set
is every rendered column, the flags array, and the provenance fields (`accession`,
`filed_date`, `period`, lag). Parity asserts multiset equality of tuples **and** field-level
equality per tuple across the server render, the client period re-render, and the full-data
expansion; duplicates are significant, so multiset rather than set.

### R20 — the follow score

Each component is in [0,1]; the weighted sum rounds half-up into [0,100]. Missing components
contribute zero **and** the count of missing components is published beside the score, so a
sparse filer is visibly sparse rather than quietly low.

- notability (40) = tier ÷ 3, zero when unconfirmed.
- concentration (20) = `topn_share_bps` ÷ 10,000, clamped.
- decisiveness (15) = 1 for turnover in `[T_turn_lo, T_turn_hi]`, falling linearly to 0 at
  `T_turn_floor` below and `T_turn_ceil` above; 0 when null.
- readability (15) = 1 at `position_count ≤ T_read_lo`, linear to 0 at `T_read_hi`.
- recency (10) = linear from `T_lag_early` to the statutory deadline, clamped.
- `market_maker`, `index_passive`, `bank_wealth` cap at 25 after summation.

Ties break on reported value descending, then CIK ascending. Every `T_*` is frozen by R31.

### R21 — one publication topology

The notable-managers JSON is produced **solely as an Astro dist route derived from
`inst_agg.db`**. No manifest artifact, no producer, no upload or digest path, no
installation step — and it cannot diverge from the aggregate because it is generated from it
at build time.

### R25 — conditional on measured coverage

A T0 measurement reports, for the latest closed period, the count and share of changed
positions whose `issuer_key` is entity-keyed and therefore resolves to a holders page. The
denominator is all changed positions in that period; the numerator is those with an existing
target page. **If the measured share is below 5%, R25 defers** to a later milestone and is
recorded as deferred rather than delivered, because holder pages currently build almost no
paths under the entity-keyed admission rule. At or above 5%, the measured share becomes the
gate's minimum, and a drop below it fails the build.

### R38 — holdings composition, without the word

Holdings ranked by share of reported value, above the changes, reusing the landed holdings
data. Required statement, once: the filing covers only long US-listed stock and option
positions valued at quarter end, and excludes short positions, bonds, cash, private
holdings, and foreign listings. Consistent with the codebase's existing refusal to call a
13F a portfolio, the heading is "Reported holdings", never "portfolio".

### R40, R41 — the sector unlock

**(a) The snapshot producer.** A script under `scripts/` fetches each known issuer CIK's SIC
from EDGAR's submissions data — federal public-domain work — writes the cached
issuer-to-SIC JSON `run_sectors_ingest` expects, and records its as-of date. It lives in
`scripts/`, not in library code, because `src/populus` deliberately performs no network
access. It is rate-limited and identifies itself per the agency's stated format.

**(b) The investor layer.** `src/populus/sector_rollup.yaml`, versioned and owner-signed like
the existing taxonomy, mapping SIC major groups to roughly eleven investor-legible buckets.
The existing division taxonomy is retained unchanged underneath, so `taxonomy_version`
semantics and the declared unknown bucket keep working. **Funds and exchange-traded
products** are a structural bucket, because a broad index fund's own SIC is an investment
office and would otherwise render a dealer's index-heavy book as a financial-sector holding.
Unclassified is counted and never redistributed.

**R41 normalization.** `sectorMix` returns counts and flow intervals. For institutional
holdings, where values are scalar, shares are exact value shares summing to the reported
total. For congressional disclosures, where every amount is an interval, an exact value share
does not exist; the surface renders a **labeled count share** — the proportion of disclosed
transactions — alongside the flow interval per sector, and states that it is a count share.
No midpoint is ever synthesized.

### R36 — analytics, named, plus the promise rewrite

Mechanism: **Cloudflare Web Analytics**, the first-party counter available on the site's
existing host, injected as one script tag from `static.cloudflareinsights.com`. Collected:
page URL, referrer, coarse user-agent, viewport bucket, load timing, and a country derived
server-side. No cookie, no local storage, no device or canvas fingerprint, no cross-site
identifier. Retention is Cloudflare's default for the product and the exact figure is stated
on the methodology page. Content-security-policy gains exactly one script source
(`https://static.cloudflareinsights.com`) and one connect source
(`https://cloudflareinsights.com`). If the script fails to load the page is unaffected.

**The promise rewrite ships in the same change**, replacing the current claim at
`methodology/index.astro:206` with an accurate one: no cookies, no fingerprinting, no
cross-site tracking, no account, search still resolving on-device, watchlists still never
transmitted — and a plain statement that anonymous page-view counts are collected, naming
the provider, the fields, and the retention. The `search-client.ts:52` copy is reconciled in
the same sweep. Tests assert no cookie and no storage key are written, that the page
functions with the beacon blocked, and that the methodology page contains no absolute
no-analytics claim.

### R35 — the geometry harness, provisioned

Runtime: **`@playwright/test`, Chromium only, as a `devDependency`** in
`dashboard/package.json` with the corresponding `package-lock.json` entry. CI installs it
with `npx playwright install --with-deps chromium` before the post-build stage. It ships
nothing to visitors, so the dependency-light constraint on delivered bytes is unaffected.
The suite loads real `dist` output through the existing preview server at 360, 720, 964,
1080, and 1440 pixels and asserts bounding-box non-intersection for the masthead cluster and
each feed cell pair, absence of unintended overflow, visibility of the scroll affordance, and
zero unoccupied trailing area in the stat strip. It must fail on a deliberately reintroduced
overlap.

### New aggregate tables, fully specified (the round-2 gap)

Four, not five. `issuer_sic` and `sic_taxonomy_meta` already exist.

1. `agg_security_directory` — as above. Producer `inst_agg.py`; consumer `inst.ts` and the
   changes table; null `ticker` means not entity-keyed, never unknown.
2. `agg_filer_profile(cik, period_of_report, archetype, archetype_source, options_share_bps,
   position_count, turnover_bps, hhi, topn_share_bps, follow_score, missing_components)`,
   primary key `(cik, period_of_report)`. Every metric column is nullable and null means
   not computable, never zero.
3. `agg_notable_quarter(period_of_report, section, rank, issuer_key, issuer_name, ticker,
   filer_count, total_value_usd, filer_ciks_json)`, primary key
   `(period_of_report, section, rank)`; `section` is the enum
   `new | exit | consensus_add | crowded`.
4. `agg_filer_optionsmix(cik, period_of_report, put_value_usd, call_value_usd,
   common_value_usd)`, primary key `(cik, period_of_report)`; nulls propagate.

All four are additive, excluded from no digest that currently exists, and each has a
producer test and a typed dashboard row.

### R13 — the disclosure

One disclosure per table, after it, generalizing the landed institutional data note. Each
caveat carries a stable ID; an authored old-to-new mapping is the contract, and the test
asserts ID-set equality with translated content checked separately — sentence equality would
forbid the translation the requirement exists to perform. The in-table terminus row stays.
Because the codebase forbids tooltip-only honesty channels, every caveat is text inside the
disclosure, not only a hover target. The fold-test extension and the `DESIGN-BRIEF.md` entry
land first.

---

## Locked Decisions

Owner decisions of 2026-08-14.

1. **Identifier posture unchanged.** The counsel flag stays open; nothing new is exposed.
2. **Filer labeling — hybrid.** Heuristics classify all filers; identity language requires a
   confirmed, sourced, period-bounded entry; everything else is shape language.
3. **Naming — "Notable managers."** No endorsement vocabulary in copy, routes, or
   identifiers.
4. **Follow score — displayed publicly**, with the research-not-recommendation tooltip, the
   published formula, and per-filer input transparency.
5. **Full-data mechanism — client-side expansion**, subject to R34 proving it fits inside
   the landed embed caps before implementation.
6. **Launch bar — flip the institutional default at ~150 confirmed filers.**
7. **Analytics — add it, and rewrite the published promise in the same change** (owner,
   2026-08-14, after being shown the current no-analytics claim). Specified in R36; the site
   must never ship a build whose copy misstates what it collects.
8. **Congress framing — "disclosed trading," never a portfolio.** Already the landed stance.
9. **Sector composition — its own milestone after the insight layer**, with no interim
   release of the coarse division buckets.
10. **Substrate interface — resolved by rebaseline**: identity is denormalized onto serving
    rows, so R8 is a join.

Inherited: no price data; hold the identifier posture; the three counsel-gated items are not
built.

---

## Alternatives Considered

| Alternative | Why rejected |
|---|---|
| Proceed on the stale feature branch | It is 90 commits and 87,103 insertions behind; three requirements specified rebuilding landed, tested code, and every path and budget claim was unverifiable. |
| Build a new interval-netting helper | `netFlow` and its six-state model exist with an exhaustive 5×5 truth table. A parallel implementation would be a regression with extra steps. |
| Build a new sector ingest | `sectors.py`, its taxonomy loader, its tables, its CLI command, and its tests all exist. Only a data producer and two workflow steps are missing. |
| Ship the coarse SIC divisions as the sector view | Renders technology, pharmaceutical, and automotive holdings as one bucket; teaches visitors the feature is broken. |
| A licensed sector standard | Barred by the paid-vendor denylist gate and the open identifier flag. |
| Value shares for congressional sector mix | Every congressional amount is an interval; an exact share would require synthesizing midpoints. A labeled count share is honest and computable. |
| One recipe with two rationale strings | Layout itself carries the identity claim; an unconfirmed filer would still receive identity-specific omissions. |
| Row-count parity for the full-data view | Passes while a duplicate replaces a missing row or a provenance field disappears. |
| Sentence-set parity for caveats | Incompatible with translating them. |
| Markup assertions for the layout defects | Cannot observe overlap — the exact defect class that shipped. |
| A manifest artifact for the notable JSON | Adds producer, upload, digest, and installation boundaries for data derivable at build time. |
| Keeping the no-analytics promise while adding analytics | Would make the site's own copy false. The promise is rewritten in the same change or the analytics is not added. |
| Arming the nightly right after the first green deploy | Re-arms an unattended job that still has the failure modes M0 exists to fix. |
| Shipping R25 against near-zero production coverage | Fixture-only linking counted as delivered. A measured floor decides whether it ships at all. |

---

## Planned Files

New:

- `dashboard/src/lib/microcopy.ts` (R11, R12)
- `dashboard/src/components/Term.astro` (R12)
- `dashboard/src/pages/institutional/all/index.astro` (R20)
- `dashboard/src/pages/institutional/notable/index.astro` (R21)
- `dashboard/src/pages/institutional/data/notable.v1.json.ts` (R21, R26)
- `src/populus/notable_filers.yaml` (R18, R37)
- `src/populus/sector_rollup.yaml` (R40)
- `scripts/fetch_sic_snapshot.py` (R40)
- `dashboard/test/microcopy.test.ts` (R11)
- `dashboard/test/archetype-render.test.ts` (R19)
- `dashboard/test/post/geometry.test.ts` (R35)
- `tests/test_filer_profile.py` (R17, R18, R31)
- `tests/test_notable_quarter.py` (R21)
- `tests/test_security_directory.py` (R8)
- `tests/test_sector_rollup.py` (R40)
- `tests/test_sic_snapshot.py` (R40)

Modified:

- `dashboard/package.json`, `dashboard/package-lock.json` — Chromium test runtime (R35)
- `dashboard/src/layouts/Base.astro` (R4, R28, R36)
- `dashboard/src/styles/global.css` (R4, R5, R6, R7, R9, R13, R27, R41)
- `dashboard/src/lib/format.ts` (R5, R10, R16)
- `dashboard/src/lib/ui.ts` (R6, R9, R13, R14, R15, R19, R22, R23, R24, R25, R37, R38, R39, R41)
- `dashboard/src/lib/derive.ts` (R8, R19, R41)
- `dashboard/src/lib/holdings.ts` (R13, R25, R38)
- `dashboard/src/lib/inst.ts` (R8, R17, R21, R23)
- `dashboard/src/lib/data.ts` (R37 search index, R40 sector context)
- `dashboard/src/pages/congress/index.astro` (R7, R11, R16, R39)
- `dashboard/src/pages/congress/members/[bioguide].astro` (R39, R41)
- `dashboard/src/pages/institutional/index.astro` (R20)
- `dashboard/src/pages/institutional/filers/[cik].astro` (R19, R22, R23, R24, R37, R38)
- `dashboard/src/pages/institutional/tickers/[t]/holders.astro` (R25)
- `dashboard/src/pages/index.astro` (R26)
- `dashboard/src/pages/methodology/index.astro` (R12, R20, R28, R36, R40)
- `dashboard/src/scripts/search-client.ts` (R36 copy reconciliation)
- `dashboard/test/css-fold.test.ts` (R13)
- `dashboard/test/pages-render.test.ts` (R8, R10, R22)
- `dashboard/test/search.test.ts` (R37)
- `dashboard/test/post/http-status.test.ts` (R21)
- `dashboard/test/post/banned-wording.test.ts` (coverage for new surfaces)
- `src/populus/inst_agg.sql`, `src/populus/inst_agg.py` (R8, R17, R21, R23)
- `src/populus/sic_taxonomy.yaml` (R40)
- `.github/workflows/publish.yml` (R30, R40)
- `tests/test_m2_11_qa_bundle.py` (R29)
- `docs/build/M2-CONTRACT.md` (R8, R21)
- `DESIGN-BRIEF.md` (R13)
- `ops/runner/runner-controller.sh` (R2), `ops/runner/config.sh` invocation (R3)

---

## Implementation Tasks

**Preconditions.**

1. **R32** — Cut the worktree from `origin/main@ad7fbd7`; re-run the survey if the base has
   advanced; correct any contradicted claim before the affected task.
1b. **R29** — Repair or remove the three permanently failing tests, and prove the
   **unfiltered** canonical gate green, before any milestone claims to pass it.
2. **R33** — Keep the disposition matrix current as requirements are revised.
3. **R34** — Measure the full-data expansion for the largest filer against the landed row and
   byte caps; a failure reopens the mechanism before any implementation.

**M0, in safety order.**

4. **R2** — Reboot-safe lock; test dead-pid and live-pid.
5. **R3** — Idempotent registration; test the pre-existing-registration case.
6. **R1** — Roll back, confirm the marker, unbrick, dispatch, verify the generation, arm last.

**M1.**

7. **R4** — Delete the masthead watermark; add the intermediate breakpoint; re-verify the
   active-link offset.
8. **R5** — Contain and ellipsize the ticker cell; render the date once.
9. **R6** — Reorder the changes columns; promote the scroll cue to all widths.
10. **R7** — Regrade the feed template; place the affiliation outside the truncating span;
    reflow the landing head.
11. **R8** — Build the period-keyed directory as a join over serving rows; render names,
    option side in words, and admitted tickers; record it in the contract.
12. **R9** — Re-diagnose the flex distribution against rendered geometry, then fix it.
13. **R10** — Register the known slug; implement the known, unknown, and near-universal split.
14. **R35** — Add the Chromium devDependency and CI provisioning; stand up the geometry suite.
15. **R36** — Land the analytics mechanism, the policy origins, and the rewritten privacy copy
    together, reconciling the search-client claim in the same sweep.
16. **R28** — Ship the beacon.

**M2.**

17. **R11** — Build the map; migrate all registries; add exhaustiveness and the source sweep.
18. **R12** — Build the glossary component and its static section.
19. **R13** — Land the fold-test extension, caveat IDs, the mapping, and the brief entry
    first; then generalize the data note into the shared disclosure.
20. **R14** — Compute the reconciliation sentence; lift repeated metadata.
21. **R15** — Disable unavailable periods; default to the latest period.
22. **R16** — Add the scale legend and plain-English dates, lag, and owner codes.

**M3.**

23. **R31** — Run the calibration algorithm; freeze constants with their justification; emit
    golden fixtures. **Entry gate.**
24. **R17** — Implement the predicates against those constants.
25. **R18** — Run the research pass; author the registry for signature; wire override,
    contradiction warning, and interval fallback.
26. **R37** — Add principal fields, staleness warning, rendering, and the search-index change
    with its removal-failing fixture.
27. **R19** — Implement the two recipe families and the multiset and field parity assertion.
28. **R20** — Compute and publish the score with its chip, tooltip, formula, and missing count;
    add the complete table; flip the default at the bar.
29. **R21** — Build the aggregate and the dist-route JSON; build the surface.

**M4.**

30. **R38** — Add reported-holdings composition above the changes, with the scope statement.
31. **R39** — Surface the landed member sections from the feed; align their copy with the map.
32. **R22** — Assemble the digest and its clause-dropping sentence.
33. **R23** — Add the option-mix table and the four charts with fallbacks.
34. **R24** — Render the archetype note with its provenance link.
35. **R25** — Measure entity-keyed coverage; ship or defer per the floor; on ship, add the
    movers table and the provenance expansion.
36. **R26** — Add the homepage module and the member-link affordance.
37. **R27** — Apply the site-wide reorder, typography, and mobile behavior.

**M6.**

38. **R30** — Add the sector and committee ingest steps to `publish.yml`; re-review the
    loosest committee mapping.
39. **R40** — Build the SIC snapshot producer; author and sign the investor rollup with its
    fund and unclassified buckets.
40. **R41** — Add normalization and the ranked list; apply to both surfaces with the correct
    share semantics per side.


---

## Testing Strategy

- **Geometry, not markup (R35; verifying R4, R5, R6, R7, R9, R27).** Chromium against real
  `dist` at five widths, asserting bounding-box non-intersection, overflow, affordance
  visibility, and zero unoccupied trailing area. Must fail on a reintroduced overlap. Markup
  assertions remain as fast pre-build guards.
- **Absence with presence (R8, R10, R11).** Grep-negative for key prefixes, registry slugs,
  and schema references, paired with positive assertions that an unknown condition still
  warns visibly and its raw token appears exactly once, in provenance.
- **Stable-ID parity (R13)** across the translation, content checked against the mapping.
- **Multiset and field parity (R19)** on the defined identity tuple and compared-field set,
  across all three render paths.
- **Golden fixtures (R17, R20, R31)** from the measured partition, with boundary cases at,
  just below, and just above every frozen constant, plus null-input fallthrough.
- **Reuse guards (R39, R41).** The landed 5×5 interval table and the sector-mix tests must
  stay green; a consumer change that breaks them is a regression, and no new interval or
  grouping mathematics may be introduced.
- **Refusal tests (R21, R31)** — the build fails on open-quarter input.
- **Privacy behavior (R36)** — no cookie, no storage key, functional with the beacon blocked,
  and no absolute no-analytics claim left in copy.
- **Sector honesty (R40, R41)** — fund and unclassified buckets populated, counted, never
  redistributed; institutional value shares sum to the reported total; congressional shares
  are labeled count shares and no midpoint is synthesized.
- **Coverage gating (R25)** — measured share compared against the 5% floor, with deferral
  recorded as deferral.
- **Search (R37)** — a principal query resolves and fails when the entry is removed.
- **Runner behavior (R2, R3)** at shell level.
- **Budget (R34, R21)** against the landed caps and the existing route assertions.
- Gates per milestone: `make check`.

---

## Verification Matrix

| ID | Verification |
|---|---|
| R32 | Worktree base is the pinned SHA; survey diff reconciled before the affected task |
| R33 | All 25 rows present, each pointing at a live requirement or a landed feature |
| R34 | Measured rows and bytes for the largest filer, inside the landed caps, recorded |
| R2 | Dead-pid lock permits a cycle; live-pid refuses |
| R3 | Registration succeeds against a pre-existing same-name runner |
| R1 | Live marker equals the attested sha; generation exists; deploy job log shows it ran; nightly armed only after R2 and R3 |
| R4 | Geometry: no masthead intersection at five widths; exactly one build watermark per page, in the footer |
| R5 | Geometry: 40-character ticker does not intersect the side cell; one date per row |
| R6 | Column order asserted; decisive columns inside 1024px; cue at all widths |
| R7 | Geometry: 20-character member name not truncated at 964px; no clipped tile from 360px |
| R8 | Period-correct join on a historical row; deterministic representative on a multi-variant key; grep-negative for key prefixes; unresolvable renders plain English |
| R9 | Rendered geometry shows zero unoccupied trailing area; tile count equals data |
| R10 | Known slug never raw; unknown still visibly warned; raw token exactly once in provenance; lift rule at 89, 90, 100 percent |
| R35 | Harness fails on a reintroduced overlap and a removed cue; Chromium installs from the committed lockfile |
| R36 | No cookie or storage key; functional with the beacon blocked; policy origins present; methodology copy states provider, fields, and retention and contains no absolute denial |
| R28 | Beacon present on every page |
| R11 | Map key set is a superset of all registries; source sweep clean |
| R12 | Keyboard focus reveals definitions; every used term resolves; definitions also exist as text, not tooltip-only |
| R13 | Caveat ID-set equality; content matches the mapping; print and anchor open it; fold extension green first |
| R14 | Reconciliation sentence from divergent fixtures; no repeated per-row metadata |
| R15 | Unavailable periods disabled with reason; default equals latest period |
| R16 | Legend present; bar title matches range text; codes and lag never untranslated |
| R31 | Every constant traced to a measured quantile with its stability check; golden fixtures emitted |
| R17 | Boundary tests per constant; null fallthrough to unclassified; curated-only archetypes never heuristically assigned |
| R18 | Override, contradiction, and out-of-interval fallback; every confirmed entry has a dated source and an effective period |
| R37 | Principal renders with role and as-of; staleness warning beyond eighteen months; absent principal renders nothing; search fixture fails on removal |
| R19 | Section-set parity per confirmation state; unconfirmed recipes omit nothing on identity grounds; multiset and field parity across three render paths |
| R20 | Components unit-tested; cap enforced; missing count published; ties deterministic |
| R21 | Closed-quarter refusal; four sections render; JSON only as a dist route, within budget; no manifest artifact |
| R22 | Digest renders; missing input drops its clause |
| R23 | Charts at one, two, five quarters; gaps not interpolated; fallback present |
| R24 | Note matches confirmation state and links to provenance |
| R25 | Coverage measured against the 5% floor; ship-or-defer recorded; unlinked names never counted as delivered |
| R26 | Module renders from the dist route and links through; member affordance present |
| R38 | Composition above changes; shares sum to reported total; scope statement present; the word "portfolio" absent |
| R39 | Landed member sections reachable from the feed; copy aligned to the map; the landed interval tests still green; no new interval mathematics added |
| R27 | Ordering assertion per page; nothing honesty-bearing hidden; no body overflow |
| R40 | Snapshot producer emits a dated cache; `issuer_sic` populated in a real build; rollup versioned and signed; fund and unclassified never redistributed |
| R41 | Institutional shares are exact value shares summing to the total; congressional shares are labeled count shares with flow intervals; no midpoint synthesized |
| R30 | Publish workflow invokes both ingests; member sector panel renders real data; loosest mapping re-reviewed |
| R29 | Tests pass on a clean tree or are gone |

---

## Rollout / Rollback

Preconditions, then M0 alone, then one milestone per publish cycle, each gated on
`make check` plus its acceptance list.

Every milestone is additive — new aggregate tables, new pages, new frontend behavior — so
reverting is a revert plus a rebuild, and no existing table changes shape, so an older
dashboard build reads a newer aggregate unchanged. R30 is the exception worth noting: it
changes what a build *contains* rather than what the code does, and its rollback is removing
the workflow steps.

Cloudflare rollback remains the operational escape hatch, and the anchor must be proved
against what the domain actually serves rather than the newest deployment by creation time.
Carried deploy hazards: a skipped deploy job reports success, so confirm it ran; the
post-promotion window can serve truncated bodies, which must never be waited out, so the
settle precedes the first sweep; and a body-hash mismatch is indistinguishable from tampering
and must never be absorbed by widening the propagation reason.

---

## Simplicity Audit

### Files

Two new library or component modules, three pages, one script, two owner-signed data files,
eight test files, four aggregate tables, one devDependency. **The rebaseline removed more
than it added**: an interval helper, a sector ingest, a taxonomy loader, a sector UI panel,
and a member disclosed-trading view all turned out to exist.

Deliberately not added: any shipped chart or client framework, any state manager, a second
static page variant per filer, a third key space, a manifest artifact for derivable data, or
a parallel interval implementation.

### Functions, types, and components

| Unit | File | Responsibility | Reuse target | Caller | Removal-failing test |
|---|---|---|---|---|---|
| `MICROCOPY`, `GLOSSARY` | `microcopy.ts` | Single source for slug and term copy | Replaces four registries | `flagChips`, `footnoteBlock`, `Term` | `microcopy.test.ts` |
| `Term` | `Term.astro` | Definition on hover, focus, tap, plus text | First real component | All surfaces | glossary render test |
| `classifyFiler` | `inst_agg.py` | Predicates over frozen constants | New | Aggregate build | `test_filer_profile.py` |
| `calibrateThresholds` | `inst_agg.py` | Quantile selection with stability check | New | R31 gate | calibration fixture test |
| `followScore` | `inst_agg.py` | Weighted score with missing count | New | Aggregate build | score component tests |
| `validateRegistry` | `inst_agg.py` | Sources, dates, intervals, contradictions | Mirrors taxonomy validation | Aggregate build | registry fixture tests |
| `buildSecurityDirectory` | `inst_agg.py` | Period-keyed join over serving rows | Extends serving reads | Aggregate build | `test_security_directory.py` |
| `buildNotableQuarter` | `inst_agg.py` | Closed-quarter aggregate | New | Aggregate build | `test_notable_quarter.py` |
| `fetch_sic_snapshot` | `scripts/fetch_sic_snapshot.py` | Rate-limited EDGAR SIC cache | New, network stays out of library code | Workflow | `test_sic_snapshot.py` |
| `investorSector` | `sectors.py` | Major-group rollup over the division layer | Extends `sector_for_sic` | Ingest | `test_sector_rollup.py` |
| `sectorShares` | `composition` area of `derive.ts` | Value shares and labeled count shares | Extends `sectorMix` | Both surfaces | share semantics tests |
| `recipeFor` | `ui.ts` | Two recipe families by confirmation state | New | Filer page | `archetype-render.test.ts` |
| `disclosureBlock` | `ui.ts` | One disclosure with stable caveat IDs | Generalizes `institutionalDataNoteHtml` | Every table | fold and ID-parity tests |
| `digestCard`, `digestSentence` | `ui.ts` | Digest with clause dropping | New | Filer page | digest fixture tests |
| `valueTrend`, `concentrationTrend`, `divergingBar`, `optionMix` | `ui.ts` | Four inline-SVG charts | Follows `flowRibbon` | Filer page | chart fixture tests |
| `holdingsComposition` | `ui.ts` | Ranked share-of-value view | Reuses landed holdings reads | Filer page | composition tests |
| `reconcileCounts` | `ui.ts` | Computed reconciling sentence | New | Every count pair | reconciliation tests |

---

## Tech Debt Introduced

1. **The curated registry needs periodic human re-verification.** Effective periods and the
   staleness warning make drift visible; nothing schedules the review.
2. **Frozen constants are a standing calibration surface** with no scheduled re-measurement.
3. **The SIC snapshot is a point-in-time cache** with a full-replace ingest, so sector history
   is as-of the last run rather than per-period. Acceptable for a composition view; wrong for
   any historical sector series, which this plan does not build.
4. **The investor rollup is editorial.** Published and auditable, but reasonable people will
   dispute margins.
5. **A headless browser enters the post-build gate** — slower, and requires a CI runtime.
6. **`ui.ts` grows further** with digest, charts, recipes, disclosure, and composition; the
   natural split is per surface once the component pattern has more instances.
7. **Cross-navigation may never ship** under the current identity posture; R25 now says so
   with a measured floor rather than implying delivery.
8. **The privacy promise becomes a maintained claim.** Once copy enumerates collected fields,
   any provider change silently makes it false unless the copy changes with it.

---

## Memory Touch-Points

- `plan-v1-literal-rid-tokens` — every ID written individually across all four traceability
  sections.
- `verify-against-a-frozen-tree` — the deepest lesson of this plan. Revisions 1 and 2 were
  surveyed on a branch 90 commits stale, which produced three requirements to rebuild landed
  code and a "SIC is stored nowhere" claim that was simply false. R32 pins the base.
- `measure-the-mechanism` — vindicated three times: grid versus flex, a banned archetype
  name, and landed-versus-new. Each was a confident claim killed by reading the tree.
- `plan-review-is-not-code-review` — external review caught the stale base that internal
  reasoning did not; a code round stays budgeted per milestone.
- `design-handoff-honesty-fold` — the disclosure is a fold deviation needing a brief entry
  and a mechanized test before it ships.
- `specify-before-rewriting` — three review rounds against one mechanism meant the spec, not
  the plan prose, was the missing artifact; the predicates, score, tables, and share
  semantics are now written as contracts.
- `pages-25mib-filer-cap` — R34 measures against the landed caps rather than the raw limit.
- `out-of-band-deploy-blocks-r18-gate`, `rollback-anchor-is-newest-not-serving` — M0's
  sequencing and the rollback paragraph.
- `review-scope-decides-the-verdict` — harness provenance stays out of review scope.
- `reversing-a-reviewed-decision` — where this plan contradicts the audit, the property is
  kept and the mechanism replaced with the reasoning recorded.
- `measure-closed-quarters-only` — a constraint, an input rule, and a refusal test.

New memory candidates after execution: that a plan surveyed on a stale branch produced
confident, wrong scope in both directions; and that a published privacy promise is a
constraint on the plan, discoverable only by reading shipped copy.

---

## Failure-Mode Sweep

- **F0 full-set.** The flag work touches every registry; the changes table touches all three
  render paths; the masthead touches every page including 404 and print; the wording scanner's
  covered set must include every new surface; the privacy copy exists in **two** places
  (`methodology/index.astro` and `search-client.ts`) and both are reconciled together.
- **F0 secrets.** No credential material; the SIC producer uses an unauthenticated public
  endpoint; review payloads pass through the bridge's scrubbing.
- **F0 verify, do not assume.** Every claim in Current State is cited to a line at the pinned
  base. The one remaining diagnosis marked open is the flex distribution (R9), explicitly to
  be re-measured rather than assumed.
- **F1 enumerate all consumers.** Each new table has a producer, a typed row, and a
  fixture-preview consumer, all in Planned Files.
- **F1 exact gate list.** `make check` = `make test` (Python, then `npm ci` and the four-stage
  dashboard chain) + `make security`, plus the new Chromium provisioning step.
- **F1 units and null states.** Declared per field; null never renders as zero and never
  satisfies a predicate.
- **F1 re-baseline.** Done, and pinned; R32 keeps it honest if the base advances.
- **F2 full-tree gate scope.** `astro check` covers new tests and components from the first
  commit; the devDependency must install from the committed lockfile.
- **F2 removal-failing tests** enumerated per unit in the Simplicity Audit.
- **F2 no dead CSS.** The existing sweep covers new selectors.
- **F4 propagation.** The archetype vocabulary, the naming decision, and the privacy copy each
  require a whole-tree sweep; a partial pass leaves a banned string in a scanned surface or a
  false claim in shipped copy.
- **F5 transport.** Both artifacts validate before submission; neither overwrites the
  in-flight artifacts at the repository root.

---

## Definition of Done

- **R32** — work is based on the pinned SHA and the survey is reconciled.
- **R33** — all 25 audit findings dispositioned.
- **R34** — the largest filer's expansion measured inside the landed caps.
- **R2** — dead-pid locks no longer brick cycles.
- **R3** — registration is idempotent.
- **R1** — a generation exists for a build whose deploy ran, and the nightly was armed last.
- **R4** — exactly one build watermark per page, in the footer, with no masthead collision.
- **R5** — no cell intersects its neighbour; one date per row.
- **R6** — added-or-trimmed readable without horizontal scrolling, with a cue everywhere.
- **R7** — ordinary member names render in full; no tile clipped.
- **R8** — no key in a default view; every changed position resolves period-correctly or to a
  plain-English unknown.
- **R9** — no unoccupied trailing area, proven by geometry.
- **R10** — no raw slug in a default view, and unknown conditions still visibly warned.
- **R35** — the harness fails on a reintroduced overlap and installs reproducibly.
- **R36** — the mechanism is named and asserted, and no shipped build misstates what the site
  collects.
- **R28** — a baseline exists before M2 lands.
- **R11** — one map, exhaustive over every registry.
- **R12** — every term defined once, reachable by keyboard, without JavaScript, and as text.
- **R13** — one disclosure per table with caveat-ID parity, opened by print and anchor.
- **R14** — no unexplained count pair; no repeated per-row metadata.
- **R15** — no dead-end control; latest period by default.
- **R16** — scale, lag, and owner codes in plain English.
- **R31** — every constant traced to a measured quantile with a stability check, before R17.
- **R17** — every filer classified by specified predicates with declared null behavior.
- **R18** — no identity claim without a dated, period-bounded source.
- **R37** — principals render with role, date, and source, are searchable, and go stale loudly.
- **R19** — identity-grounded omissions occur only for confirmed filers, and full data matches
  by multiset and field.
- **R20** — ranking by research-worthiness with a published formula and inspectable inputs.
- **R21** — the notable surface reports a closed quarter through one publication topology.
- **R22** — the digest leads and never invents a clause.
- **R23** — four charts without a shipped dependency, gapping rather than interpolating.
- **R24** — a dealer's page cannot be misread as directional exposure.
- **R25** — shipped against a measured coverage floor, or recorded as deferred.
- **R26** — the homepage shows something live and links into it.
- **R38** — composition precedes changes, shares reconcile, scope limits stated, and no
  portfolio claim is made.
- **R39** — the landed member sections are reachable and consistent, with no new interval
  mathematics.
- **R27** — data precedes caveats everywhere; nothing honesty-bearing hidden.
- **R40** — a real build ships populated sector data with investor-legible buckets.
- **R41** — value shares on the institutional side, labeled count shares on the congressional
  side, no synthesized midpoints.
- **R30** — the publish workflow produces the data that lights up the sector panel.
- **R29** — no permanently failing tests remain, proven by an unfiltered `make check`
  before the first milestone.
