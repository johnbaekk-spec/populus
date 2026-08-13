# RUN M2-12 — Bound the filer "Position changes" surface

> **Transport:** `interactive-disk`. Schema `plan-v1`. Branch `feat/bound-filer-changes`
> off `origin/main` @ `9152284` (worktree `.claude/worktrees/inst-changes-bound`).
> **Status: APPROVED — OD-1 resolved by the owner 2026-08-12 (cap + paginate, named honestly).**

## Goal and Success Criteria

Make every pre-rendered institutional filer page fit Cloudflare Pages' 25 MiB per-file
limit **while keeping the quarter selector working on every filer**, replacing the
hand-edited artifact that is currently the only thing that has ever fitted.

Success:

- A clean build from this branch produces **zero** files over 25 MiB, with the R19 gate
  (`dashboard/test/post/file-budget.test.ts`) passing rather than hand-fitted around.
- Every filer page — including `1423053` and `1446194` — still renders `data-period-chips`
  **and** a working period switch.
- Wherever rows are withheld, the page **says so, with the true total**, in the existing
  `terminusRow` grammar. No surface silently shows fewer rows than it claims.
- The published site is reproducible from source: `main` + this branch rebuilds the
  deployable tree with no manual post-build editing.

## Requirements

- **R1** — No file in `dashboard/dist` exceeds `MAX_SHARD_BYTES` (25 MiB) for the current
  published build, measured, not projected.
- **R2** — The per-period aggregate embed (`filer-period-data`) is bounded by a declared
  byte budget rather than by the filer's position count.
- **R3** — The SSR "Position changes" table is bounded by a declared row budget rather
  than rendering every delta row.
- **R4** — When either bound truncates, the rendered surface names the truncation, its
  author, and the **true total** via `terminusRow({author:"populus"})`.
- **R5** — Stat tiles and any count shown beside the changes table report the **true**
  delta count, never the post-cap length.
- **R6** — The bound is applied to rows **already sorted** by the table's own ordering, so
  a cap keeps the largest changes rather than an arbitrary slice.
- **R7** — Top-1,500 pre-rendered filers and tail filers served through the shard family
  render through the **same** bounded inputs (R22 parity); one function, two callers.
- **R8** — The client period switch continues to re-render through the same renderer the
  SSR used, and a capped period renders its honest state rather than a silent no-op.
- **R9** — No new per-`(filer, period)` output files; total file count stays under
  `GLOBAL_FILE_CAP` (18,000).
- **R10** — The Public Filings rebrand already on `main` rides along unchanged.

## Scope

`dashboard/` rendering and payload assembly for the institutional filer surface, plus the
tests that pin it.

**Scope correction, made during implementation:** this plan first said the Python side was
untouched. That was wrong, and the byte-parity gate is what proved it. `FilerPayloadV1` is a
**cross-runtime contract** — `tests/fixtures/filer_payload_parity.v1.json` requires
`scripts/measure_inst_derive.py::build_filer_payload` (the T0 reference) and the TypeScript
assembler to reproduce the same canonical bytes, and `tests/test_inst_snapshot_script.py`
asserts it. Adding a payload field therefore obliges the Python reference to apply the same
ordering and the same cap. Scope widened to include `scripts/measure_inst_derive.py`, the
regenerated fixture, and a committed regeneration script. Published artifacts and the
publish/deploy workflows remain untouched.

## Non-goals

- Changing what the pipeline computes or publishes. `agg_qoq_deltas` is unchanged; this is
  purely how much of it a single HTML page carries.
- Fixing the holders page embed (`holders-period-data`). It is bounded in practice by
  `topn = 25` holders per issuer; it is **noted, not modified** (see Failure-Mode Sweep F0).
- Re-deploying. This branch ends at a green build; deployment goes through the normal
  publish path, not a manual `wrangler` push.
- Reproducing the reverted `ops:` hand-fit in any form.

## Constraints

- Cloudflare Pages free tier: 25 MiB/file, 20,000 files (`PROVIDER_FILE_LIMIT`), with the
  project self-capping at 18,000 (`GLOBAL_FILE_CAP`), per `src/populus/inst_budget.py`.
- `lib/holdings.ts` must stay browser-safe — no `node:sqlite` import may reach it.
- The published aggregate contract (`src/populus/inst_agg.sql`) is authority; the dashboard
  mirrors it and must not restate it.
- Honesty rules: no surface may claim a deliberate withholding that did not happen, and
  none may hide one that did.

## Current State

Measured this session against data build `20260812.1` (all three DBs sha256-verified
against `builds/20260812.1/manifest.json`):

- A clean build produces **9,671 files**; two exceed the cap —
  `institutional/filers/1423053/index.html` at **29,115,421 B** and
  `1446194/index.html` at **27,943,798 B**. `test/post/file-budget.test.ts` fails on
  exactly these.
- The problem is **structural and growing**, not a two-page anomaly:
  `1595888` sits at 25,233,370 B — only **+3.7%** under the cap — and 126 of 1,500 pages
  exceed 5 MiB. Every one grows by roughly a period's worth (~25%) when the next quarter
  lands, which puts `1595888` and others over.
- Cause A (embed): `src/pages/institutional/filers/[cik].astro` lines 58–69 build
  `periodData` from **every** period's `{conc, deltas}`. For `1423053`: `conc` is ~220 B
  per period, `deltas` are 5,927,721 / 5,486,508 / 5,541,070 / 5,600,554 B across the four
  non-empty periods — **20,868,411 B** total. Berkshire (`1067983`) totals 65,093 B.
- Cause B (SSR): `ui.ts changesTableHtml()` renders every delta row with no cap and no
  pager, so one period's HTML is ~6 MB for `1423053`.
- The live deployment `2f3830b6` ships a **hand-edited** artifact with `data-period-chips`
  and `filer-period-data` removed from exactly those two pages (1,498 pages carry the
  embed vs 1,500 from a clean build). Every `ops:` commit that pointed `publish.yml` at
  that hand-made directory was reverted on `main`, so **`main` cannot currently reproduce
  the live site**.
- Duplication found: `data.ts::filerAggregateInputs` already computes exactly the
  `concByPeriod` / `deltasByPeriod` pair that `[cik].astro` rebuilds inline — two
  implementations of one payload, which is why a fix applied to one would miss the other.

## Detected Stack

Astro 7.1.6 static output, TypeScript 6.0.3, Node pinned 24.16.0 (`dashboard/.node-version`),
`node:sqlite` for reads, `node --test` suites (`test/`, `test/post/`). Python side
`populus-mcp`, requires-python >=3.12 — not touched by this plan.

## Reuse Map

| Existing symbol / path | Decision | Why |
|---|---|---|
| `holdings.ts::capRows(rows, cap, byteCap)` → `{rows, total, bytes, boundBy}` | **Reuse as-is** | Already returns exactly the true-total + bound-reason pair R4/R5 need. Generic over `T`, so it takes `QoqDeltaRow[]` unchanged. |
| `holdings.ts::HOLDINGS_EMBED_BYTE_CAP` (2 MiB), `HOLDINGS_EMBED_ROW_CAP` (20,000), `HOLDINGS_PAGE_SIZE` (100) | **Reuse the values; rename generically if shared** | The sibling surface on the same page is already bounded by these. Inventing a second set of constants is how two surfaces on one page drift. |
| `ui.ts::terminusRow({author:"populus", html})` | **Reuse** | The established truncation grammar; `format.ts` already emits `data-terminus-author` and tests pin it. |
| `holdings.ts` pager helpers (`HOLDINGS_PAGE_SIZE` slicing, pager range/labels) | **Reuse** | R3's pager must look and behave like the holdings pager directly below it. |
| `data.ts::filerAggregateInputs` | **Extend, and make `[cik].astro` call it** | Removes the duplicate payload construction and delivers R7 parity by construction rather than by convention. |
| `HoldingsTable.astro` bounded-embed + client-pager pattern | **Follow as the reference implementation** | Same page, same problem, already solved; this plan makes the changes surface consistent with its sibling. |

New implementation is limited to the pagination state for the changes table and the
capped-period honest state — everything else is composition of the above.

## Architecture

One bounded assembly point, two renderers, no new endpoints or files.

1. **Bound at assembly.** `filerAggregateInputs` becomes the single producer of the filer
   aggregate payload and applies the bound: for each period, sort deltas by the changes
   table's own ordering (value desc, then `position_key`), then `capRows`. It returns, per
   period, `{rows, total, boundBy}` instead of a bare array.
2. **`[cik].astro` consumes it** instead of rebuilding `periodData` inline, so the
   pre-rendered page and the shard-served tail filer are assembled by one function (R7).
3. **Render bounded.** `changesTableHtml` takes the bound metadata plus a page index,
   slices at `HOLDINGS_PAGE_SIZE`, and emits the pager. `filerPeriodSectionHtml` passes the
   **true total** to `filerTiles` (R5) and appends a `terminusRow` when `boundBy != null`
   naming the total and what is not shown (R4).
4. **Client parity.** `entity-client.ts::initFilerPeriods` keeps re-rendering through
   `filerPeriodSectionHtml`; a period whose rows were capped renders the same honest
   terminus the SSR would have (R8).

Budget arithmetic with the proposed bound: SSR changes table drops from ~6 MB to ~40 KB
(100 rows), and the embed is bounded at the chosen budget. Worst-case page becomes roughly
`chrome + bounded embed + 2 MiB holdings embed` — on the order of 5 MB against a 25 MiB
cap, with headroom that survives future quarters (R1).

## Locked Decisions

- **LD-1** — Reuse `capRows` rather than write a delta-specific truncator. It already
  carries `total` and `boundBy`, which are exactly what the honesty requirement needs.
- **LD-2** — Reuse the existing holdings constants rather than introduce new ones, so the
  two surfaces on one page cannot drift apart.
- **LD-3** — Cap **after** sorting (R6). Capping the unsorted rows would silently drop the
  largest position changes, which is the worst possible slice to lose.
- **LD-4** — No new output files (R9). Per-`(filer, period)` endpoints would add ~7,500
  files against a 9,671-file tree and an 18,000 cap.
- **LD-6** — OD-1 is CLOSED (owner, 2026-08-12): cap + paginate, named honestly. The embed is
bounded at the shared 2 MiB budget and the changes table paginates at the shared page size.
`1423053` shows roughly its largest 5,600 of 15,885 changes for a quarter, with a terminus
naming the true total and pointing at the published aggregate and the filing itself. The
completeness alternative (a byte-bounded shard family for changes) was considered and
declined for now; TD-M2-12-1 records it as the removal condition for this cap.
- **LD-5** — `[cik].astro` stops building its own payload; `filerAggregateInputs` is the
  one producer. This is required for R7 and removes a real duplication.

## Alternatives Considered

1. **Reproduce the hand-strip** (drop chips + embed on big filers). Rejected: it is the
   dishonest-silent-removal failure mode, and it is not reproducible from source — the
   exact defect that made the live site unrebuildable.
2. **Per-`(filer, period)` JSON endpoints, fetched on chip click.** Rejected under LD-4 on
   the file cap; also adds a network failure mode to a currently offline-complete page.
3. **One JSON file per filer, fetched on demand.** Rejected: `1423053`'s payload is
   ~20.9 MB, which merely moves the same unbounded blob to a different file that itself
   approaches the 25 MiB cap next quarter.
4. **Embed only the current period; navigate for others.** Rejected: per-period pages are
   alternative 2's file explosion in another form.
5. **Bound only the embed, leave the SSR table unpaginated.** Viable for R1 today
   (8.2 MB page) and the smallest diff — but leaves 126 pages over 5 MiB and a 15,000-row
   HTML table no reader uses. Recorded as the fallback if OD-1 resolves against capping.

## Planned Files

- `dashboard/src/lib/data.ts` — `filerAggregateInputs` applies the bound; return type carries `total` / `boundBy`.
- `dashboard/src/lib/holdings.ts` — export the shared cap/page constants under names not tied to one surface; no behavior change to `capRows`.
- `dashboard/src/lib/ui.ts` — `changesTableHtml` pagination + terminus; `filerPeriodSectionHtml` and `filerBody` signatures carry bound metadata; `filerTiles` receives the true total.
- `dashboard/src/lib/filer-payload.ts` — payload type carries the bound metadata through the shard path.
- `dashboard/src/pages/institutional/filers/[cik].astro` — consume `filerAggregateInputs`; delete the inline `periodData` construction.
- `dashboard/src/scripts/entity-client.ts` — client re-render honors the bound and renders the pager.
- `dashboard/test/inst-changes-bound.test.ts` — new: the bound, the honest terminus, the true-total tile, sort-before-cap.
- `dashboard/test/ui.test.ts` — update the changes-table expectations to the paginated shape.
- `dashboard/test/post/file-budget.test.ts` — assert a **margin** under the cap, not merely non-violation.
- `scripts/measure_inst_derive.py` — the T0 reference mirrors the same ordering, the same cap, and the new payload field (cross-runtime byte parity).
- `scripts/regen_filer_payload_parity_fixture.py` — new: regenerates the parity fixture's derived values from the T0 reference so no digest is ever hand-typed.
- `tests/fixtures/filer_payload_parity.v1.json` — regenerated (serialization, sha256, byte length, fragment summary).
- `dashboard/test/filer-payload.test.ts` — the harness applies the bound the way `data.ts` does before calling the assembler.

## Implementation Tasks

- **T1** (R2, R6, R7, LD-1, LD-3, LD-5) — Apply sort-then-`capRows` inside
  `filerAggregateInputs`; widen its return type to per-period `{rows, total, boundBy}`.
- **T2** (R7, LD-5) — Rewrite `[cik].astro` to consume `filerAggregateInputs`; remove the
  duplicate inline `periodData`.
- **T3** (R3) — Paginate `changesTableHtml` at the shared page size; emit the pager markup
  the holdings surface already uses.
- **T4** (R4, R5) — `filerPeriodSectionHtml`: pass the true total to `filerTiles`; append
  the `terminusRow` when `boundBy != null`.
- **T5** (R7, R8) — Thread the bound metadata through `filer-payload.ts` and
  `entity-client.ts` so tail filers and client re-renders match the SSR.
- **T6** (R10) — Confirm the rebrand strings/logo on this branch are untouched by the diff.
- **T7** (R1, R9) — Full build against `20260812.1` with the workflow's env; measure file
  count and max file size.

## Testing Strategy

Unit (`node --test`, `test/`): the bound applies after sorting (T1/R6); a capped period
emits `terminusRow` with `data-terminus-author="populus"` and the true total (R4); the stat
tile shows the true count, not the capped length (R5); an uncapped filer's output is
unchanged from today (regression guard for the 1,498 normal filers).

Post-build (`test/post/`): the existing R19 gate must pass **on a real tree** with a stated
margin (R1); the R22 parity gate must still pass (R7); file count under `GLOBAL_FILE_CAP`
(R9).

Behavioral validity (F2): each new test must fail if the bound is removed — verified by
reverting the cap locally and confirming red, per `[[mutation-tests-pin-properties]]`.

## Verification Matrix

| Req | Verified by | Evidence |
|---|---|---|
| R1 | T7 + `file-budget.test.ts` | measured max file size + margin on a real `dist/` |
| R2 | `inst-changes-bound.test.ts` | embed bytes bounded for a synthetic 15k-row filer |
| R3 | `ui.test.ts` | rendered row count == page size, pager present |
| R4 | `inst-changes-bound.test.ts` | terminus present, author + true total asserted |
| R5 | `inst-changes-bound.test.ts` | tile count == true total while rows are capped |
| R6 | `inst-changes-bound.test.ts` | largest-value rows survive the cap |
| R7 | `file-budget.test.ts` R22 block | top and tail assemble identically |
| R8 | `entity-orchestration.test.ts` | client switch renders capped state, not a no-op |
| R9 | T7 | file count measured under 18,000 |
| R10 | T6 | diff review; rebrand tests still green |

## Rollout / Rollback

Rollout: merge to `main`, then publish through the normal `publish.yml` path so the tree
is built, inventoried, verified, and recorded — **not** a manual `wrangler pages deploy`,
which is what displaced a verified deployment earlier today.

Rollback: the branch is additive to rendering only; reverting the merge restores current
behavior. The live site is unaffected until a publish runs, and deployment `2f3830b6`
remains the recorded generation-1 deployment until a new one is recorded.

## Simplicity Audit

Minimum coherent design: **one** bound applied at **one** assembly point, reusing the
existing cap primitive, the existing constants, and the existing terminus grammar; plus
pagination for the changes table that reuses the holdings pager.

New symbols introduced: pagination state for the changes table, and the widened return
type of `filerAggregateInputs`. Nothing else.

Rejected abstractions: a delta-specific truncator (duplicates `capRows`); a generic
"bounded surface" abstraction over holdings and changes (two instances do not justify it);
a new endpoint family (LD-4); a second constants set (LD-2). Net effect on
`[cik].astro` is a **deletion** — the duplicated payload construction goes away.

## Tech Debt Introduced

**Three, declared.** After this change the two largest filers display a bounded subset of
their quarter-over-quarter changes, honestly named. The complete change set remains
derivable from the published aggregate and the filing itself, and the page links to both.
Owner: dashboard. Removal condition: if per-period change lists become a first-class
served surface, they should get their own byte-bounded shard family like holdings has,
at which point this cap is lifted. Tracked as **TD-M2-12-1**.

The holders embed (`holders-period-data`) is left unmodified — bounded in practice by
`topn = 25`, but it shares this shape and is not gated. Noted, not fixed: **TD-M2-12-2**.

**Growth, bounded but not eliminated.** The cap is per period, matching the holdings
surface's own discipline, so the embed grows by up to 2 MiB per new quarter. The largest
page measures 12,979,794 B — 49.5% of the cap — against 29,115,421 B before. That is
roughly six quarters of headroom, and the R19 gate fails the BUILD rather than the deploy
if it is ever approached. Removal condition is TD-M2-12-1's shard family. **TD-M2-12-3**.

## Memory Touch-Points

- `[[measure-the-mechanism]]` — decisive here: two hypotheses (ticker map, code drift) were
  wrong; diffing the shipped artifact against a clean build answered it in one step. The
  Current State section is measurement, not inference.
- `[[probe-dont-argue-from-silence]]` — the 25 MiB limit and the per-page sizes were
  measured against a real tree, not assumed from provider docs.
- `[[mutation-tests-pin-properties]]` — drives the behavioral-validity step in Testing
  Strategy: each bound test must fail when the bound is removed.
- `[[specify-before-rewriting]]` — this plan exists because the same mechanism had already
  produced one reverted release and one hand-edited artifact.
- `[[pages-25mib-filer-cap]]` — the session record of the hand-strip and its irreproducibility.
- `[[plan-v1-literal-rid-tokens]]` — every requirement above is a literal `R<n>` token; no ranges.
- `[[reversing-a-reviewed-decision]]` — the reverted `ops:` commits are treated as a
  decision to be replaced with a mechanism, and the replacement is pinned by a gate.

## Failure-Mode Sweep

- **F0 full-set sweep** — APPLIED, and it changed the plan: grepping every
  `type="application/json"` embed found three (`holdings-data`, `filer-period-data`,
  `holders-period-data`), and grepping `deltasFor` found `data.ts::filerAggregateInputs`
  feeding the **tail-filer shard path**. Fixing only `[cik].astro` would have left the
  shard path unbounded — R7 exists because of this sweep. `holders-period-data` assessed
  and excluded with a reason (TD-M2-12-2).
- **F0 verify-don't-assume** — every size figure here is measured from a built tree; DB
  inputs sha256-verified against the manifest.
- **F0 secrets** — not applicable; no credential, token, or env value appears in this
  change or its output.
- **F1 enumerate all consumers** — the three embeds and both filer paths (pre-rendered,
  shard) are enumerated above.
- **F1 gate list** — the full standing set for this change is `npm run check`,
  `npm test`, `npm run build:bounded`, `npm run test:post`.
- **F1 NULL/awaiting state** — `boundBy: null` means "nothing withheld" and must render
  **no** terminus; a terminus on an uncapped period would claim a withholding that did not
  happen.
- **F1 re-baseline** — this branch is cut from `origin/main` @ `9152284`, which already
  contains the rebrand merge (R10).
- **F1 simplicity audit completeness** — every new symbol enumerated above.
- **F2 behavioral test validity** — required explicitly in Testing Strategy.
- **F2 worktree** — work happens in `.claude/worktrees/inst-changes-bound`, never the live
  checkout; teardown is an owner action.
- **F2 stale comments after moves** — `[cik].astro` lines 58–59 comment describes the
  inline payload being deleted in T2 and must go with it.
- **F2 dead CSS selectors** — the new pager reuses the holdings pager's classes; verify the
  selectors match rendered DOM rather than assuming.
- **F3 doc drift** — `dashboard/README.md` decisions list and `methodology` copy must be
  checked for claims about the changes table showing everything.
- **F4 propagation sweep** — after the fix, re-grep the three embeds to confirm no fourth
  has appeared.
- **F5 transport** — `plan-v1`, validated before handoff.
- Not applicable: prod-write scope / auth (no writes), SQL injection and bulk-SQL
  (no new SQL), connection pooling, RLS/ACL, config rename.

## Definition of Done

- **DoD-1** (R1, R9) — a full build from this branch against `20260812.1` reports zero
  files over 25 MiB and a file count under 18,000, with the numbers stated.
- **DoD-2** (R2, R3, R6) — bound and pagination in place, applied after sorting.
- **DoD-3** (R4, R5) — capped surfaces name the truncation, its author, and the true total;
  uncapped surfaces render no terminus.
- **DoD-4** (R7, R8) — top and tail filers assemble through one function; the client switch
  renders the capped state.
- **DoD-5** (R10) — rebrand untouched.
- **DoD-6** — `npm run check`, `npm test`, `npm run build:bounded`, and `npm run test:post`
  green **against the recorded baseline exception below**, each new test verified to fail
  when its bound is removed.

### DoD-6 baseline exception (owner-approved 2026-08-12, Codex F7)

Codex F7 was correct that "no new failures" does not satisfy a DoD that says every gate is
green. It is not, and pretending otherwise by attribution alone would be the same
dishonesty this plan exists to remove from the rendered pages. The exception is therefore
explicit, enumerated, and bounded:

**Exempted, because they fail identically on `7ce271d` — the commit before any of this
work:** the three `tests/test_m2_11_qa_bundle.py` failures (B19), and the `test:post`
failures carried on `main` (B18). Attribution was established by MEASUREMENT, not
assertion: the full `test:post` suite run against the pre-change tree fails 19 and against
the post-change tree fails 18, with the set difference being exactly one entry — the R19
cap gate — moving from fail to pass.

**Not exempted, and now enforced:** every gate this change touches. `astro check` 0 errors,
279/279 dashboard unit tests, `uv run pytest` 3,412 passed, the three R19 gates (including
the new margin gate), and R22.

**The exception must shrink.** B18 and B19 carry the underlying defects, and
`.github/workflows/checks.yml` deselects the B19 trio *and asserts they still fail*, so the
allowlist cannot quietly become permanent cover: when they are fixed, CI goes red until the
entries are deleted.
- **DoD-7** — no manual post-build editing anywhere in the path; the tree is reproducible
  from source.
