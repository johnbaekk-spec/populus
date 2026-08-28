# Slice 6 record — dashboard render and style split

Branch `prof/slice-6` (from `origin/main` at `ce61b0d`, the PR #81 fixup merge
— all prior slices landed, so this is the first slice cut from main rather
than stacked). Requirements R7, R10, R11; tasks T6.1–T6.7 and D11.

## Blockers, and the FILER-IDENTITY rebaseline (recorded per instruction)

The plan lists Slice 6 as BLOCKED on RUN PUBLIC-SECURITY-HARDENING and RUN
FILER-IDENTITY. The security run has landed (its `ui.ts` and `Base.astro`
edits are in this slice's base and were absorbed by the T6.1 re-derivation
below). RUN FILER-IDENTITY has **notes only, no plan** —
`docs/build/RUN-FILER-IDENTITY-notes.md` — so, mirroring the I-2 deferral
logic the program already uses (a run with no approved plan rebaselines onto
the landed tree rather than holding a slice hostage), **the owner authorized
proceeding: FILER-IDENTITY will rebaseline onto the split.** Concretely: any
future FILER-IDENTITY change to render helpers lands in
`dashboard/src/lib/ui/institutional.ts` (holders/filer surfaces) or the other
domain modules, imported by consumers only through `ui/index.ts`, and its
plan must be written against this tree, not against the deleted `ui.ts`.

## T6.1 — re-derived export surface (reconciliation result)

Re-derived from the current `dashboard/src/lib/ui.ts` at base `ce61b0d`
(post security run and Slices 0–5): **exactly 61 exports — zero deltas
against the plan's regenerated ownership table.** The security run's edits
(inline-json serializer wiring at the inst-adds embed) and Slice 4's comment
rewrites added no symbol and removed none. Composition: 51 runtime values +
10 type-only exports (`BuildStamps`, `EntityTableOpts`, `TickerHeaderInfo`,
`S4ErrorKind`, `ModuleCardStats`, `RankingSectionOpts`, `RankingAlternatives`,
`AddsSortKey`, `AddsSectionOpts`, `MemberV2Deps`), including
`RANKING_FOOTNOTES` — the 61st symbol, a pure re-export from
`congress-columns.ts`. Consumer scan: 12 `.astro` pages, 2 client scripts
(`entity-client.ts` at its verified `dashboard/src/scripts/` path,
`congress-sections.ts`), and 19 dashboard test files.

The export count is asserted by `dashboard/test/ui-exports.test.ts`
(51 runtime names by runtime reflection, 10 type names by source scan,
`51 + 10 === 61` pinned).

**One reconciliation beyond the table, by the table's own logic:** the
private helper `netCellHtml` is called by BOTH `rankings.ts`
(`rankingRowHtml`) and `congress.ts` (`memberV2Sections`). Assigning it to
either domain would create a `congress ⇄ rankings` import cycle, so it moved
to `ui/shared.ts` as a shared-private beside `asOfNote` — exported for the
sibling modules, deliberately NOT re-exported by `ui/index.ts`. This is the
same shared-private pattern the plan itself prescribes for `asOfNote`.

## T6.2/T6.3 — the render split (commit 2)

`ui.ts` (2,876 lines) split mechanically — bodies are the exact current
text — into `dashboard/src/lib/ui/`:

- `shared.ts` — `BuildStamps`, `breadcrumb`; shared-private `asOfNote`,
  `netCellHtml`
- `congress.ts` — the 13 congress symbols per the table (+`EntityTableOpts`,
  `MemberV2Deps`); imports `RANKING_FOOTNOTES as RANKING_FOOTNOTES_LIST`
  from `../congress-columns.ts`, exactly as `ui.ts` did
- `rankings.ts`, `signals.ts`, `ticker.ts`, `institutional.ts`, `states.ts`,
  `home.ts` — per the table, private helpers moving with their domain
- `index.ts` — re-exports exactly the 61-symbol surface and **owns the
  `RANKING_FOOTNOTES` re-export line** from `../congress-columns.ts`, with
  its explanatory comment, per the plan's special case

Consumer-import resolution (the T6.3 question, answered by measurement):
this codebase imports with **explicit `.ts` extensions** in lib/test code and
extensionless specifiers in `.astro` pages; rather than relying on
directory-index resolution after deleting `ui.ts`, every consumer was
rewritten to the explicit `"…/lib/ui/index.ts"`. `astro check` (0 errors) and
the full suite verify the resolution. `ui.ts` is deleted; no second facade;
no consumer deep-imports a domain module (grep-verified, `entity-client.ts`
included).

Source-scanning tests that read `ui.ts` as a file (sl-surfaces SL-R9/R10/
R11/R13, sl-notes SL-R8d, r-codex F14, activity §5-heading) now scan the
**concatenated `ui/` directory** so their contracts remain whole-surface;
SL-R8d's "everywhere else" sweep now descends into `src/lib/` subdirectories.

## T6.5 — rendered-output parity (commit 1, then commit 2)

`dashboard/test/lib/ui-parity-surfaces.ts` renders 27 representative
surfaces (member, congressional ticker, unified ticker in module-absent and
data states, holders, filer, changes, both ranking sections, adds, signals,
member-v2, states S1/S2/S4/S7, home pieces) from deterministic fixtures.
Captured on the UNSPLIT tree into `test/fixtures/ui-split-parity.json`
(commit 1, green pre-delete against `ui.ts`);
`test/ui-split-parity.test.ts` asserts byte equality post-split. The pages
the instruction names that do not render through `ui.ts` (methodology, 404 —
static Astro bodies) are covered by the untouched-page half: the split
changes no `.astro` body, and `test:post`'s corpus checks run over the built
tree. Full-page byte parity additionally rides on the production build gate
below.

## T6.4/T6.6 — the CSS split (commit 3)

The nine region boundaries were re-derived from the CURRENT section banners:
**every boundary line number in the plan's LOCKED table still holds** — the
Slice 4 banner renames ("entity, feed & table surfaces", "momentum,
leaderboard & activity surfaces", "mobile fold, entity & feed surfaces")
were text-only. Split at exactly those lines into
`src/styles/{foundation,layout,congress-feed,entities,institutional,states-search,content,media,late-additions}.css`,
imported by `Base.astro` in exact source order, `late-additions.css` last.
Nothing else imported `global.css` (grep-verified); it is deleted.

**Byte-parity acceptance (absolute obligation) — proven:**

```
$ cat foundation.css layout.css congress-feed.css entities.css \
      institutional.css states-search.css content.css media.css \
      late-additions.css | cmp - <pre-split global.css>   # exit 0
sha256 both sides:
50036e578c0cb037e8f8b734ba2eb47b6d6cc7db5a4c089c2f206f95f00fb731
```

T6.6: `test/lib/styles.ts` parses `Base.astro`'s import list and serves the
concatenation to every CSS contract (`css-fold`, `m1-layout`,
`a5-table-css`, `table-sort`, `sl-notes`, `r-codex`, `geometry/sl-notes`),
so the fold/token/dead-selector gates stay whole-tree and cannot desync from
the shipped cascade. A new `css-fold` assertion pins: nine files, Base.astro
as the order authority, no orphan sheet, `foundation` first,
`late-additions` last.

## T6.7 — deferred (recorded)

Consolidation of duplicate helpers/selectors is allowed only after the split
passes and in its own commit. **Deferred out of this slice** — nothing was
consolidated; the split is 100% mechanical. Candidates observed in passing
(the twin `txnCells*` bodies, the duplicated members-disclosing row template,
the late-additions fold-by-domain refold already listed under "Deferred
beyond this program") are left for a dedicated change with focused tests.

## Gates (owner tier, this host; POPULUS_BUILD_DIR=builds/20260812.1, POPULUS_DB=Populus-ops/populus.db)

| Gate | Result |
|---|---|
| `npm run check` | exit 0 — 0 errors, 0 warnings |
| `npm test` | exit 0 — 655/655 pass (651 baseline + 4 new: export parity ×2, render parity, css structure) |
| `npm run build:bounded` | exit 0 — 1,700 pages built |
| `npm run test:post` | exit 1 — 64/68 pass; the 4 failures (banned-wording $0, tree-count vacuity, M1-footprint drift, holders all-claim) are all inside the known 6-item pre-existing baseline; **no new failures** (the /e/ endpoint-cut and member-cut baseline items did not fail on this run) |
| `npm run geometry:install && npm run test:geometry` | install exit 0; suite exit 1 — 42 passed, 2 skipped, 6 failed. The 6 (R6 scroll-cue at all five widths + its layout-negative twin) all fail on `expect(scroller.count()).toBeGreaterThan(0)` at `/institutional/filers/1067983/`: the local data build 20260812.1 publishes NO `/institutional/filers/*` pages (`dist/institutional/` holds only `data/` and `index.html`). **Proven pre-existing by A/B**: the pre-split commit `b07a843` (monolithic ui.ts + global.css), rebuilt against the same build dir, fails the identical R6 tests. Environment/data-dependent, not split-caused. (First attempt also surfaced a stale `astro preview` on :4321 left by the retired surfaces-legibility worktree since Aug 24 — killed, per the config's own F7 no-reuse rule.) |
| `npm run test:holders-browser` | exit 0 — 7/7 passed |
| `uv run pytest -q` | 4068 passed, 146 skipped |
| `bash scripts/maintenance/check_links.sh` | exit 0 |

All counts above are from the run performed on this branch on 2026-08-28.
