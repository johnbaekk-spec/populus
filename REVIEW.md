# Review Brief: ALPHA-SURFACES-V2 — Congress and Institutional one-page overhaul

**Plan:** `PLAN.md` (repo root, validated `plan-v1`)
**Design source:** `docs/design/ALPHA-SURFACES-V2-PLAN.md` (owner-approved 2026-08-21, carries the 112-row curated manager registry in its §5)
**Branch:** `main` (working tree; no commit/push is performed by this loop)
**Review round:** 1 of 3
**Focus areas:** (a) whether the client-side ticker-momentum rollup is the right mechanism on a static site and whether its equivalence guarantee is strong enough; (b) whether the curated manager registry's provenance and decay handling are adequate; (c) whether removing the congress stat-tile strip loses honesty content the methodology page does not actually replace; (d) whether sortable-header adoption can silently violate the interval/bucket semantics the current rankings depend on.

## Summary of Changes

This is a **pre-implementation plan review**. No code has been written; there is no Dev Notes
artifact and no QA report. The plan restructures two public surfaces of a static,
prerendered financial-data site (publicfilings.org) whose core editorial constraint is
*honesty*: statutory dollar ranges are never collapsed to point estimates, undisclosed values
are never rendered as zero, truncation always names its author, and no qualifier may leave the
accessibility tree at any viewport width.

**Congress** currently spans three prerendered pages (feed, leaders, tickers) linked by a
sub-tab nav. The plan collapses them into one scrollable page ordered ticker-momentum →
disclosure-feed → member-net-flow, moves sorting from a three-option `<select>` into sortable
column headers on every table, makes each table compact-by-default with an in-place expand, and
adds a 7d/30d/90d/12m range control with a traded/filed basis toggle to the momentum section.
Because the site is static with no request-time server, that range control must be computed
client-side; the plan reuses the ~12 MB feed dataset the page already fetches and the same pure
rollup functions the server uses, with a characterization test pinning client output equal to
server output for the shared twelve-month window. The build-time stat-tile strip
("rows filed", "House parse", "Senate parse", "paper needs OCR") is removed on the grounds that
`/methodology/#m1` already publishes the same four measures in full through a separate function.

**Institutional** currently shows a sortable filer index plus a cross-filer activity feed derived
from precomputed quarter-over-quarter deltas (`agg_qoq_deltas`, change kinds new/add/trim/exit).
The plan re-orders it to lead with a new recently-added-tickers leaderboard (a new build-time
aggregate grouping those same deltas by issuer and period), then the activity feed re-anchored so
ticker is the primary column, then the filer index re-presented as a *manager directory* with
curated display names, manager-type filter chips, and a new biggest-add column.

Manager type does not exist anywhere in the pipeline today, so the plan introduces a curated,
checked-in registry of 112 managers (CIK → display name, associated person, type) whose every row
was verified against a primary SEC source on 2026-08-21 via three channels: EDGAR company browse
filtered to 13F-HR, the `data.sec.gov` submissions API, and EDGAR full-text search over 2026
13F-HR filings. Candidates no source could confirm were **dropped, not guessed** (GIC Singapore
and Qatar Investment Authority — no 13F-HR filings found; JANA Partners — last 13F-HR 2023;
Aquamarine — no 2026 filings). Verification also corrected three identifiers that memory would
have gotten wrong: BlackRock's post-2024-reorg filer CIK, Caxton's new LLP CIK, and the fact that
KKR/Apollo/Deutsche Bank file under entities distinct from their parent companies. The join is
validated at build time rather than trusted: unmatched rows are reported by identifier and
excluded from typed views, and a match rate below a configured floor fails the build.

## Detected Stack

- **Python 3.12** package `populus-mcp`; dependency manager **uv** with committed `uv.lock`.
  Tests `uv run pytest -q`; supply-chain guard `uv run python scripts/dep_guard.py`.
- **Node / TypeScript** static site in `dashboard/` — **Astro 7**, `output: "static"`,
  `build.format: "directory"`, deployed to **Cloudflare Pages**. Committed `package-lock.json`.
  No framework runtime on the client; interactivity is hand-written TS islands in
  `dashboard/src/scripts/*.ts`.
- **Canonical gate entrypoints** (`Makefile`): `make test` → `uv sync --frozen` + `uv run pytest -q`,
  then `cd dashboard && npm ci && npm run gates`; `make security` → `uv run python scripts/dep_guard.py`;
  `make check` → both.
- **`npm run gates`** = `astro check` → `node --test "test/*.test.ts"` → `build:bounded` →
  `test:post` → `playwright install chromium` → `test:geometry` → `test:holders-browser`.
- **Environment reality:** `build:bounded` hard-refuses under 32 GiB physical RAM and runs with
  `--max-old-space-size=24576`; the geometry lane needs a real browser. Neither runs on a hosted
  runner, so **a local unfiltered `make check` is the only authoritative evidence**. The
  institutional module is *dormant-by-data* in a default local build (`dashboard/dist/institutional`
  is currently ~8 KB), so institutional gates require a build wired to the data repo
  (`POPULUS_INST_SERVING_DB` / `POPULUS_BUILD_DIR` / `POPULUS_DB`).

## Reuse / Duplication Check

Carried from PLAN.md's Reuse Map, with what was verified in the live tree:

| Planned reuse | Verified in tree | Note |
|---|---|---|
| `initSortableTable` for header plumbing | `dashboard/src/scripts/table-sort.ts` (103 lines) | Deliberately owns only plumbing (click wiring, direction toggle, `aria-sort`, live-region announce, innerHTML swap). Comparators are **caller-owned by prior decision** — a shared comparator was explicitly rejected in an earlier review round. It does not repaint on load, so an SSR/client ordering disagreement stays visible rather than being masked. |
| Per-table column contracts with stated reasons | `dashboard/src/lib/inst-index.ts` (`INST_INDEX_HEADS`), `dashboard/src/lib/holders-sort.ts` (`HOLDER_COLUMNS`) | Existing rule: a `key: null` (unsortable) column **must** carry a `why` string — from external review finding F1, "an unexplained unsortable column is indistinguishable from a forgotten one". |
| Pure rollup/ranking math for the client rollup | `dashboard/src/lib/derive.ts` — `congressTickersRollup`, `leadersRollup`, `rankNetRows`, `compareNet`, `netOverlaps`, `sumRanges` | Already imported by the SSR path; pure, so a client call is the same code. |
| Date-range + basis matching | `dashboard/src/scripts/feed-client.ts` (`matchDate`, `filter-date-basis|from|to`) | The filed/traded basis toggle already exists on the feed. |
| Honesty primitives | `dashboard/src/lib/format.ts` — `statTiles`, `footnoteBlock`, `terminusRow`, `flagTags`, `srcLinkDerived`, `watchStarHtml` | Reuse; introduce no parallel primitive. |
| Table markup convention | `.table-scroll` > `table.etable[data-sticky-first]` > `caption.visually-hidden` | There is **no** `<Table>` component; the convention is a string-returning renderer plus fixed markup shape. Do not introduce a table component. |
| Existing QoQ deltas as the source for both new institutional views | `agg_qoq_deltas` (`src/populus/inst_agg.sql`, producer `inst_agg.py`) | Change kinds new/add/trim/exit already computed; the activity feed already slices it. |
| Compact-plus-expand disclosure | Compass `InstitutionalCard.tsx` `tk-disclose` pattern (`aria-expanded`, control omitted at ≤ N) | Referenced cross-repo as the pattern to copy. |

**Duplication risks the reviewer should weigh:**

1. **The stat-tile duplication is code-level, not just visual.** `buildTiles()`
   (`dashboard/src/lib/data.ts:77-140`) and `methodologyM1Tiles()` (`data.ts:1411-1458`) derive
   overlapping measures from the same `stats.json` through **two different functions**. The plan
   removes the *rendering* on `/congress/` but leaves both functions in place. Is deleting one
   call site without collapsing the duplicated derivation the right call, or does it leave a
   function whose only remaining consumer is a page the plan does not touch?
2. **`notableRecent` already implements a rolling-N-day congress window.**
   `dashboard/src/lib/derive.ts:868` — `notableRecent(txns, generatedAtDate, days, limit)`,
   ranked by **lower bound, never the upper bound**, filed-date based, with unrankable disclosure
   and anomaly exclusion; tested by `dashboard/test/a4-notable.test.ts`; called at
   `pages/index.astro:21` with a 7-day window and in `ui.ts:1713` with 90. PLAN.md's R3 names
   the rollup functions generically but does **not** name `notableRecent`. Since R2 asks for
   exactly a 7d/30d/90d window, the reviewer should decide whether the momentum section must
   reuse or align with `notableRecent`'s semantics (especially *lower-bound ranking* and
   *filed-date basis*) rather than introducing a second, subtly different windowing rule.
   **This is the single largest reuse question in the brief.**
3. The client rollup necessarily duplicates window semantics at two call sites (server and
   client), held together only by a characterization test. See Tech Debt.

## Simplicity Audit

Carried from PLAN.md. Complete enumeration of new artifacts:

| New artifact | Justification | Reviewer check |
|---|---|---|
| Congress ranking client island | A static site cannot compute a user-selected range at request time; no other mechanism exists. | Is one island owning both the momentum recompute *and* both ranking comparators too much for one module? |
| Congress column-contract module | Follows the established per-table convention (`inst-index.ts`, `holders-sort.ts`) rather than inventing one. | — |
| Curated manager registry seed (data, not code) | The filings carry no manager type and no human-readable display name; this is the only way to supply them. | Is 112 curated rows the right granularity vs. a smaller high-signal set? |
| Registry loader + join validation | Exists so the join fails loudly rather than silently mislabeling. | Is the match-rate floor the right failure mechanism? |
| Institutional adds aggregate + bounded endpoint | The leaderboard needs an issuer-grouped view the per-position aggregate does not provide. | — |
| Test modules per new boundary | Each new boundary needs a test that fails if the feature is removed. | — |

**No** new abstraction layer, **no** shared comparator, **no** new table component, and **no**
new honesty primitive is introduced. Every new module is a leaf that existing code calls.

## Tech Debt Introduced

Declared in PLAN.md (none hidden; no diff exists yet, so there are no undeclared TODOs to flag):

1. **Curated-subset typing.** Manager type covers ~112 curated rows out of ~8,700 filers, so typed
   views describe a curated subset. Copy must not imply full coverage. Broad classification is
   explicitly deferred.
2. **Hand-maintained data that decays.** Entities reorganize (BlackRock 2024, Caxton's new LLP CIK)
   and stop filing (JANA, last 13F-HR 2023). Join validation *detects* decay but does not repair
   it, creating a periodic re-verification obligation recorded with the seed.
3. **Two-call-site window semantics.** The client rollup duplicates the server's window semantics,
   held together by a characterization test rather than a single shared entry point.
4. **Institutional gates need a wired data build.** Those gates are not exercised by a default
   local run and can therefore drift unnoticed.

## Memory Touch-Points

Selected via `memory-select.sh` over the project memory index, plus the always-loaded
failure-mode catalog:

- `mockups-are-not-measurements` — every number in the approved mockup is placeholder; a prior
  incident shipped an invented "8,412 filers" when the real count was 3,706. **No figure from the
  mockup may enter implementation or copy.**
- `plan-v1-literal-rid-tokens` — the contract validator greps requirement IDs literally; ranges
  FATAL the artifact. PLAN.md uses literal `R1`…`R15` throughout and validates.
- `plan-review-is-not-code-review` — five plan rounds once found zero of ~20 defects that three
  code rounds found in an hour. A code-review round must be budgeted for the implementation; this
  plan round is not a substitute.
- `review-scope-decides-the-verdict` — the same commit drew both APPROVED and 2-blockers depending
  on scope. This review is scoped to **the plan and the registry seed data**; harness provenance
  is out of scope. Per-finding resolution must be explicit.
- `design-handoff-honesty-fold` — the mockups' mobile fold deletes honesty content; deviations are
  documented, and the ban is mechanized as `css-fold.test.ts`.
- `measure-closed-quarters-only` — an open quarter is ~4x undercounted (3,672 vs 8,794 filers).
  Directly relevant to the institutional leaderboard's period selector.
- `verify-against-a-frozen-tree` — gate evidence is valid only for the tree state that produced it.
- `specify-before-rewriting` — 3+ rounds of blockers in one mechanism means write the spec first.
- `probe-dont-argue-from-silence` — test the mechanism in use; know what a signal actually proves.

## Repo Structure Conformance

| Planned addition | Conventional location | Plan's location | Conforms? | Notes |
|---|---|---|---|---|
| Congress ranking client island | `dashboard/src/scripts/*-client.ts` (`feed-client.ts`, `inst-index-client.ts`, `entity-client.ts`) | `dashboard/src/scripts/` | yes | Name should follow the `*-client.ts` suffix. |
| Congress column contract | `dashboard/src/lib/*.ts` (`inst-index.ts`, `holders-sort.ts`) | `dashboard/src/lib/` | yes | — |
| Registry loader + join validation | `src/populus/*.py` | unstated in plan | **unclear** | PLAN.md does not fix the loader's language/side. If the join is a build-time Python step it belongs in `src/populus/`; if it is an Astro build-time read it belongs in `dashboard/src/lib/`. **The plan should name it.** |
| Curated manager registry seed | `src/populus/*.yaml` — existing precedent: `aliases.yaml`, `securities.yaml`, `sic_taxonomy.yaml`, `committee_jurisdiction.yaml` | design doc says `data/manager_registry.yaml` "(or repo-conventional location)" | **no** | There is no top-level `data/` convention for seed YAML; the established location is `src/populus/`. Adding a top-level `data/` directory would be a new top-level directory without justification. **Flagging as Critical for the reviewer.** |
| Institutional adds aggregate producer | `src/populus/inst_agg.py` + `inst_agg.sql` | unstated (implied institutional aggregate side) | partial | Should extend the existing `inst_agg` pair rather than create a parallel module. |
| Bounded JSON endpoint | `dashboard/src/pages/institutional/data/**.ts` (existing `activity/[page].v1.json.ts`, `filers/[shard].v3.json.ts`) | `/institutional/data/adds/[period].v1.json` | yes | Matches existing endpoint-family naming and versioning. |
| New tests | `dashboard/test/*.test.ts` (unit), `dashboard/test/post/*` (post-build), Python `tests/` | `dashboard/test/` implied | yes | Note the repo's `<slice>-<topic>.test.ts` naming convention (`a5-table-css`, `c4-rankings`). |

**Additional structural hazard discovered while preparing this brief (not a plan defect —
a pre-existing repo condition the plan's reuse strategy depends on):**

`dashboard/src/lib/derive.ts` and `dashboard/src/lib/signals.ts` each contain a **literal NUL
byte (0x00)**, committed in `HEAD`. In `derive.ts` it is at line 1210, used deliberately as a
composite-key separator: `` const pairKey = `${row.cik}\x00${row.ticker}` ``. Behaviorally this is
fine — NUL is a legitimate separator choice because it cannot occur in the data. **But it makes
`file(1)` classify the source as `data` and makes plain `grep` treat it as binary**, so a
repo-wide `grep -rn` sweep silently reports *no matches* in these two files unless `-a` is passed.
`derive.ts` is precisely the module PLAN.md's R3 depends on for reuse, and this is how
`notableRecent` was nearly missed during the reuse scan for this brief. The reviewer should decide
whether replacing the literal byte with the equivalent `\u0000` escape (runtime-identical,
restores greppability) belongs in this change or in a separate one — and, more importantly,
whether any repo gate performs a grep-based sweep that is silently skipping these two files today.

## Failure-Mode Sweep

Carried from PLAN.md, against `~/.claude/skills/_shared/failure-modes.md`:

| Item | Status | Application |
|---|---|---|
| **F0** full-set sweep | ✓ | Sortable headers touch a *set* of tables → every table on both surfaces is enumerated and given a column contract. Tile removal touches a duplicated measure → both `buildTiles` and `methodologyM1Tiles` checked, plus the dead-selector sweep in both directions. |
| **F0** secrets | ✓ | Work touches no credentials; no env values in artifacts or output. |
| **F0** verify don't assume | ✓ | Every registry row confirmed against a primary SEC source; unconfirmable candidates dropped and recorded rather than carried on plausibility. |
| **F1** enumerate all routes | ✓ | Congress route set stated as changed / redirected / untouched: index, `/leaders/`, `/tickers/`, `/members/[bioguide]/`, `/tickers/[ticker]/`, and the data endpoints. |
| **F1** exact full gate set | ✓ | Declared gates named in Detected Stack and run unfiltered, not merely new tests. |
| **F1** units + NULL state per served field | ✓ | New derived columns state units and null rendering; a missing value never renders as `0` (repo convention is `—`). |
| **F1** re-baseline against live tree | ✓ | Brief re-verified plan assumptions against the live tree; surfaced `notableRecent` and the NUL-byte condition. |
| **F1** Simplicity Audit completeness | ✓ | Every new file/module enumerated above. |
| **F2** full-tree lint/type scope | ✓ | `astro check` covers the tree; new tests included. |
| **F2** behavioral test validity | ✓ | Each new boundary gets a test that fails if the feature is removed (disclosure omission rule, join-validation floor). |
| **F2** no dead CSS selectors | ✓ | Every new class verified against rendered output; every removed class verified to leave no orphaned rule — mechanized by the existing dead-CSS sweep in `css-fold.test.ts`. |
| **F2** shared validators reject degenerate input | ✓ | Registry loader must *reject* rows lacking provenance, not normalize them. |
| **F2** build in a worktree, not the live dir | ✓ | Applies at implementation time; this loop performs no build in the live checkout. |
| **F3** doc/number reconciliation | ✓ | No mockup figure may enter copy; registry counts stated as measured. |
| **F4** propagation sweep | ✓ | Any point fix must be grepped across the whole doc/codebase — **with the `-a` caveat above**. |
| **F5** validate content schema before interpretation | ✓ | `PLAN.md` validated as `plan-v1`; this brief validated as `review-brief-v1` before submission. |
| **F5** source repair invalidates gate evidence | ✓ | Recorded in PLAN.md's sweep. |
| F2 dynamic SQL / bandit nosec | N/A | No dynamic SQL introduced; the new aggregate extends existing parameterized producers. |
| F2 connection-pooler read-only | N/A | No pooled database; static build reads a local SQLite serving DB. |
| F3 ACL / RLS assertions | N/A | No auth, no row-level security; the site is public and read-only. |
| F2 bulk SQL backfill | N/A | No backfill; the aggregate is a build-time grouped read. |

## Diff Context

No diff exists — this is a pre-implementation plan review. The proposed interfaces:

### Congress momentum rollup (new client island)
**Files:** `dashboard/src/scripts/<name>-client.ts` (new), `dashboard/src/pages/congress/index.astro` (modified)
**What's changing:** SSR prerenders the existing twelve-month rollup as authoritative HTML; the
island recomputes for 7d/30d/90d from the already-fetched `/congress/data/feed.v1.json`
(~11.96 MB, column-array encoded, `DATASET_VERSION = 2`), calling the same pure functions.
**Key decisions:**
- Reuse the existing fetch rather than adding a second payload.
- SSR output is authoritative; the island must not repaint on load (matching `table-sort.ts`'s
  deliberate no-repaint-on-load stance), so a client/server disagreement stays visible.
- Equivalence is pinned by a characterization test at the shared twelve-month window only.

### Congress ranking comparators
**Files:** `dashboard/src/lib/<contract>.ts` (new), `dashboard/src/lib/ui.ts` (modified)
**Key decisions:**
- Comparators stay caller-owned (prior review decision; no shared comparator).
- Amount sort preserves the ranked/unrankable split (`amountSortKey`/`amountOrder` bucket
  unparseable amounts rather than zeroing them).
- Net-flow sort preserves `compareNet`'s six-state interval ordering, the `≈` incomparability
  marker from `netOverlaps`, and the separate wholly-undisclosed second table.

### Curated manager registry (new seed data)
**Files:** location contested — see Repo Structure Conformance.
**Shape:** `cik, display_name, person, type, verified {channel, date}`.
**Sample rows** (all verified 2026-08-21; channel A = EDGAR company browse filtered to 13F-HR,
B = `data.sec.gov` submissions API, C = EDGAR full-text search over 2026 13F-HR):

| Display | Person | Type | CIK | SEC-conformed name | Ch |
|---|---|---|---:|---|---|
| Berkshire Hathaway | Warren Buffett | notable | 1067983 | BERKSHIRE HATHAWAY INC | A |
| Oaktree Capital Management | Howard Marks | notable | 949509 | OAKTREE CAPITAL MANAGEMENT LP | A |
| Scion Asset Management | Michael Burry | notable | 1649339 | Scion Asset Management, LLC | A |
| Baupost Group | Seth Klarman | notable | 1061768 | BAUPOST GROUP LLC/MA | B |
| Moore Capital Management | Louis Bacon | notable | 1448574 | MOORE CAPITAL MANAGEMENT, LP | C |
| Caxton Associates | macro | notable | 2051323 | CAXTON ASSOCIATES LLP | C |
| BlackRock | index | asset_manager | 2012383 | BlackRock, Inc. | C |
| Citadel Advisors | Ken Griffin | hedge_fund | 1423053 | CITADEL ADVISORS LLC | A |
| Norges Bank | Norway GPFG | pension_swf | 1374170 | NORGES BANK | A |

Type taxonomy: `notable` (38), `hedge_fund` (22), `alt_manager` (8), `bank` (13),
`asset_manager` (17), `pension_swf` (16) = **112 rows**.

**Deliberate exclusions, recorded rather than silently omitted:** GIC Singapore and Qatar
Investment Authority (no 13F-HR filings found — likely confidential treatment); JANA Partners
(CIK 1159159, last 13F-HR 2023-08-14); Aquamarine Capital (no 2026 13F-HR hits); PIMCO
(equity 13F footprint immaterial vs. its bond book).

**Known-stale predecessor deliberately not seeded:** BlackRock Finance, Inc. (CIK 1364742),
whose last 13F-HR was 2024-08-13.

### Institutional adds leaderboard
**Files:** `src/populus/inst_agg.{py,sql}` (extended), `dashboard/src/pages/institutional/data/adds/[period].v1.json.ts` (new)
**What's changing:** group `agg_qoq_deltas` rows with `change_kind ∈ {new, add}` by
`(issuer_key, period)` → distinct-manager count, new-position count, Σ `delta_value_usd`, top adder.
**Key decisions:**
- Window is the **13F reporting period**, not a rolling day count, because quarterly filings
  cannot support a rolling window; the copy states this rather than implying absent freshness.
- Bounded like the existing activity shards (record + byte caps) with truncation stated at the
  exact boundary sort key.

## Review Checklist

- [ ] **`notableRecent` reuse (highest priority).** Given `derive.ts:868` already implements a
      rolling-N-day, lower-bound-ranked, filed-date-based congress window used at 7 and 90 days,
      should R2/R3's momentum section reuse it outright? If the new section ranks by a different
      basis (net flow rather than lower bound) or defaults to traded-date rather than filed-date,
      is that a defensible divergence or two contradictory "recent activity" rules on one site?
- [ ] **Is a twelve-month-only equivalence test sufficient for R3?** The characterization test
      pins client == server at the *shared* window. The 7d/30d/90d paths have no server
      counterpart and therefore no equivalence anchor. What pins their correctness?
- [ ] **Open-quarter undercount on the institutional leaderboard.** Project memory records an open
      quarter as ~4x undercounted (3,672 vs 8,794 filers). Should the period selector *exclude*
      the open quarter, or display it with an explicit incompleteness marker? PLAN.md R9 states
      the reporting-period window but does not address open-vs-closed.
- [ ] **Does removing the stat tiles actually lose nothing?** The four feed tiles overlap the
      methodology tiles, but `buildTiles()` throws rather than publishing a false 0% when
      parse-coverage data is absent. Does that fail-loud property have an equivalent on the
      methodology path, or does removing the strip also remove a canary?
- [ ] **Sort-vs-bucket safety (R6).** `initSortableTable` swaps `root.innerHTML` wholesale. The
      member ranking renders **two** tables (ranked + wholly-undisclosed). Can a header sort
      structurally reach across that boundary, and what test would fail if it did?
- [ ] **Compact-by-default vs. the fold gate (R7/R14).** Rendering a compact slice hides rows that
      currently render. Does `css-fold.test.ts`'s dual-channel sweep treat a *not-yet-expanded*
      row as content that left the accessibility tree, and is `aria-expanded` disclosure the
      sanctioned channel here?
- [ ] **Registry match-rate floor (R13).** Is a percentage floor the right failure signal given
      known legitimate churn, or should the build fail only on *named* rows disappearing?
- [ ] **Registry location (R12).** Confirm `src/populus/*.yaml` over a new top-level `data/`.
- [ ] **112 rows: right size?** Is a curated set this large maintainable given the decay problem,
      or is a smaller high-signal set (say 40) more honest about what can be kept current?
- [ ] **Payload cost.** Is recomputing rollups over the full ~12 MB dataset client-side acceptable
      on mobile, and should the plan state a measured budget rather than assuming?

## Open Questions

1. **Is client-side recomputation the right mechanism at all**, or should the build prerender the
   four ranges as separate small JSON payloads — trading build output and page weight for
   determinism and a server-anchored equivalence guarantee at every range rather than just one?
2. **Should manager type be a filter chip at all in this run**, given it covers 112 of ~8,700
   filers? An alternative is shipping *only* a "Notable" curated view with no type taxonomy until
   broad classification exists, which cannot mislead about coverage.
3. **Is the biggest-add column honest per-manager?** It derives from `agg_qoq_deltas` for the
   selected period; for a manager whose filing is an amendment or is partially confidential, what
   does that column show, and does it need a qualifier?
4. **Redirect mechanics on Cloudflare Pages static output.** R1 says old sub-tab URLs redirect to
   in-page anchors. Should these be `_redirects` entries or prerendered meta-refresh stubs, and
   does either lose the anchor fragment? PLAN.md does not specify the mechanism.
5. **Does the NUL-byte condition warrant its own change** before work that leans heavily on
   `derive.ts` reuse, given it silently defeats grep-based sweeps?

## Constraints & Context

- **Static site, no request-time server.** Every control is a client island over prerendered or
  fetched data. This is the binding constraint on R2/R3.
- **Honesty rails are mechanized, not advisory.** `css-fold.test.ts` is a deterministic CSS parser
  enforcing that no honesty-bearing selector (40-entry allowlist: `.cell-filed`, `.lag`, `.flag`,
  `.terminus`, `.caveat-line`, `.visually-hidden`, …) carries `display:none`,
  `visibility:hidden`, or `content-visibility:hidden` in any `@media` block intersecting
  `[0, 720px]`; it sweeps three breakpoints in source order. `visually-hidden` is on the allowlist
  **deliberately** — it is the channel the fold is permitted to use. `banned-scan.test.ts` and
  `activity.ts`'s `BANNED_WORDING` reject prohibited phrasings in rendered HTML;
  `holdings.ts`'s `unqualifiedAllClaims` rejects unqualified "all …" claims.
- **Design tokens exist in three copies** (`:root`, `[data-theme="dark"]`, and a
  `prefers-color-scheme: dark` fallback for first paint) — any token change must be made in all
  three, and the stylesheet header records a deliberate WCAG contrast deviation not to be retuned
  without a design-side change.
- **Build cost is real:** 3,884 prerendered congress ticker pages; `dashboard/dist/congress`
  ~138 MB; a self-imposed file budget currently breached on an inherited overrun.
- **Backwards-compat:** old sub-tab URLs must not 404.
- **Deployment:** out of scope for this loop. The plan performs no commit, push, or deploy; the
  owner commits by hand.
- **Most likely tests to break:** `m1-layout.test.ts`, `pages-render.test.ts`,
  `c4-rankings.test.ts`, `a5-table-css.test.ts`, `a1-feed-sort.test.ts`, `css-fold.test.ts`.

## Previous Review Feedback

None — this is round 1 of 3.

## Severity rubric

- **Critical:** correctness, data-loss, security, or deployment blockers
- **Major:** architectural risk, likely production bug, weak testability
- **Minor:** maintainability or clarity improvements

Each high-severity item must include impact, evidence location, and concrete fix direction.
