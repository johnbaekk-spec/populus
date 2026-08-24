# RUN SURFACES-LEGIBILITY — dev-notes-v1 (T0–T15, plus code-review F1–F6)

## Detected Stack

- TypeScript + Astro (`dashboard/`), npm, `node --test` over `dashboard/test/*.test.ts`.
- Type check: `astro check`. Python side untouched this run.
- Worktree `<repo>/.claude/worktrees/surfaces-legibility`, branch `surfaces-legibility`, cut from
  `origin/main` @ `b4787ff`. Local `main` never touched (it is divergent: 1 ahead, 1 behind).

## Requirement and Task Completion

**Every task is complete: T0, T0.a and T1–T15.** T6/R10 was blocked twice — once on its own premise, once
under the owner's `<noscript>` direction — and is now **implemented** by fixing its root cause, which the
owner directed after the second revert. See Plan Deviations.

Requirements delivered: `R1`, `R2`, `R2b`, `R3`, `R4`, `R5`, `R6`, `R7`, `R7b`, `R7c`, `R8`, `R8b`, `R8c`,
`R8d`, `R8e`, `R9`, `R11`, `R12`, `R13`, `R14`, `R15`, `R16`, `R17`, `R18`, `R23`, `R25`, `R26`, `R26b`,
`R28`, `R29`, and `LD4`, `LD6`, `LD8`, `LD10`. Added in the second half: `R19`, `R20`, `R22`, `R24`.
**`R10` is delivered** — see Plan Deviations. `R21`, `R30`, `R31`, `LD5`, `LD9` left the run by owner
decision, their ids are retired and not reused, and the work is carried in
`docs/build/RUN-FILER-IDENTITY-notes.md`.

## Changed Files

**42 files under `dashboard/src` and `dashboard/test`**, plus the run's own docs. The planned-files manifest
is now **exactly equal** to that source/test set — zero missing, zero surplus — which took three corrections
to reach; the last removed eight paths the plan predicted and implementation never needed. New: `src/scripts/notes.ts`, `test/sl-notes.test.ts`, `test/sl-surfaces.test.ts`,
`test/sl-member.test.ts` (T10), `test/sl-filer.test.ts` (T11), `test/sl-propagation.test.ts` (T13),
`test/sl-docs.test.ts` (T14).

## Reuse / Duplication Check

`note()` lands beside `esc`/`fmtInt` in `format.ts` and uses the same escaping. `colWhyHtml()` is the single
opt-in helper every header renderer routes through, so the no-scope fallback cannot drift per call site.
`.flag-provenance`'s existing `<details>` + `::details-content` print idiom is reused by LD8's collapsed box
rather than inventing a second disclosure pattern. `RANKING_FOOTNOTES` moved to `congress-columns.ts` (re-
exported from `ui.ts`, no import path changed) to break a module cycle. No third-party tooltip or popper
dependency was added: `popovertarget` plus ~40 lines of placement is smaller than any of them.

## Simplicity Audit

Added: one module (`notes.ts`), one primitive (`note()`), three helpers (`slug`, `noteId`, `colWhyHtml`), one
optional `NoteCtx` parameter threaded through note-capable renderers, one optional `onSettled` callback on
`initFeed`, and six CSS classes. `footnotesId` — threaded through five functions solely to aim the `≈` marker
— is **deleted** with the footnote blocks it served. No new exported type. No published payload shape changed.

## Tech Debt Introduced

1. **17 surviving sole-channel `title=` sites (`R8c`).** Their renderers hold no stable non-null identity, so
   keying them is a signature refactor across eight shared helpers. Gated at exactly 17 by file and line.
2. **`compactDisclosure` now ships visible markup on five surfaces (`R10`).** Its bound is server-rendered
   text rather than a script-revealed control, which is strictly more honest but does mean the control's
   resting appearance changed on `/congress/` and `/institutional/`. Owner-directed. Removal condition: none —
   this is the intended shape; recorded so the visual change is not mistaken for drift.
3. **Scripted popover placement.** ~25 lines that CSS anchor positioning will make redundant.
4. **A dynamic note body (`R11`/`R12`).** One note's content is live state; every other note is static.
5. **`/watchlist/` and `/e/` render notes without `initNotes()`.** Owner-decided: they get a CSS default
   resting place rather than being pulled into scope. They gain a channel; they do not get hover or anchoring.

## Memory Touch-Points

`invariant-boundary-test-update-design-change` drove LD8's same-commit assertion replacement.
`reversing-a-reviewed-decision` drove reading each red test before editing it. `doc-drift-sweep` drove the
whole-file count audits. `fail-loud-exact-guards` drove asserting explanation TEXT rather than wrappers.
`plan-review-is-not-code-review` is why this diff is being reviewed at all: thirteen plan rounds could not see
`compactDisclosure`'s two `hidden` branches.

## Failure-Mode Sweep

| Concern | Handled |
|---|---|
| Honesty text lost | Every removed string was traced to a replacement channel; `R10` was reverted precisely because it could not be. |
| Suppressed at a breakpoint | `.note-pop` is never `display:none` outside the fallback/seam blocks; asserted. |
| Gate weakened to pass | LD6 followed: assertions retargeted to the moved text, never widened. LD8's replacement is strictly stronger than what it retired. |
| Server/client divergence | Note ids are a pure function of `(scope, key)`; no counter, ordinal, timestamp or randomness anywhere. |
| Out-of-scope route changed | `R2b` opt-in; `colWhyHtml` proves the no-scope path byte-identical. Two `/tickers/*` footnote blocks deliberately untouched. |
| Dynamically rendered element inert | `initNotes()` binds by delegation on `document`; five roots `innerHTML`-replace after setup. |
| Duplicated singleton id | `slug()` guards the empty-key case that would have collided every `#` column. |

## Tests Run

**T15 — the repository's own commands, on a frozen tree.** `dashboard/src` and `dashboard/test` were hashed
immediately before the first command and immediately after the last; both hashes match, so the evidence is
about the tree as committed.

- `make security` → **PASS**. `dep_guard: OK — no denylisted vendor dependencies or imports`.
- `make test` → **RED, at `test:post` only**, and every failure is pre-existing. Its stages:
  - `uv sync --frozen` + `uv run pytest -q` → **3,667 passed, 11 skipped**. The Python side is untouched by
    this run and is run to prove no collateral damage.
  - `npm ci` + `npm run check` → **0 errors, 0 warnings, 1 hint** — `memberSignalsPanel`'s unused `ctx`,
    present on `origin/main` and deliberately left.
  - `npm test` → **644 pass, 0 fail** (571 at baseline; 608 at the T9 handoff; 614 after code-review cycle 1;
    639 after T15; 644 after R10 landed and the cycle-2/3 test gaps were closed).
  - `npm run build:bounded` → **3,496 pages built**.
  - `npm run test:post` → **59 pass, 6 fail**, which is exactly the pristine baseline's result. `make` stops
    here, so the two browser lanes below were run directly rather than through it.
- `npx playwright test` (geometry) → **39 passed, 6 failed, 2 skipped**. The 6 are the R6 scroll-cue specs,
  which fail identically on the pristine baseline worktree. The 2 skips are stated, not silent: `/institutional/`
  renders `s1ModuleAbsent` in a checkout with no institutional aggregate, so it has no note to measure.
- `npm run test:holders-browser` → **7 passed, 0 failed**.

**The 6 `test:post` failures, each attributed.** None is caused by this run:
`forced cut: canonical pages absent…` and `member happy path over real dist-cut bytes` read `dist-cut`
fixtures; `the measurement is not vacuous` and `the measured M1 footprint agrees with the constant` are the
file-budget gate reporting a stale constant (`M1_MEASURED_PAGES` says 12,901, the built tree holds 5,290);
`status contract: /e/ 200 …` fails with `ENOENT … dist/congress/members` because this checkout's data build
produces no member pages; and `no unqualified 'all' claim on the rendered holders surface` flags
`"$0 means nothing disclosed at all"`, which is **byte-identical at `holders-sort.ts:133` on `origin/main`**
in a file this run never touched — verified present in the pristine baseline's own built fixture.


**Later than T15, and therefore not covered by the frozen-tree hashes above.** Three review cycles and the
R10 root-cause fix landed after T15 ran. Re-measured at `HEAD`: `npm run check` 0 errors; `npm test`
**644 pass / 0 fail**; `build:bounded` clean at 3,496 pages; `test/geometry/sl-notes.spec.ts` **13 pass /
0 fail**. The pre-existing sets are unchanged and were re-verified byte-identically against a pristine
`origin/main` worktree: `test:post` 59 / 6, full geometry 41 pass / 6 fail (baseline 29 / 6, same six R6
scroll-cue specs). T15's hashes are stated as covering T15, not as covering the branch tip — claiming
otherwise would be the "half-written tree measured as green" failure this plan's own sweep lists.

## Plan Deviations

1. **`R10` / T6 — blocked twice, then IMPLEMENTED via its root cause.** The requirement's premise ("an
   adjacent control states the same count") was false in three separate states: with scripting off; with
   scripting on before the 22 MB feed arrives; and when an island throws or returns early. A `<noscript>`
   attempt closed only the first and was reverted. The owner then directed fixing the cause: `compactDisclosure`
   now emits its bound as **visible server markup** (a `.compact-bound-count` span carrying no `hidden`), with
   only the toggle button awaiting a script, and the nothing-to-disclose shell still hidden. All three states
   are closed by construction — a script that never ran cannot retract markup it never reached. Only then were
   the five `terminusRow` sites and `syncTerminusFor` deleted (13 sites → 8, asserted as an exact per-file
   partition), with all four non-count clauses moved verbatim. 19 assertions across 6 files retargeted to the
   moved text. **Superseded detail, kept for the record:** `compactDisclosure` emits `hidden` in **both** return
   branches; only `congress-sections.ts` and `inst-index-client.ts` remove it. With scripting off the control
   states nothing, the count is not duplicated at all, and the terminus is the reader's only statement of what
   is held back — so deleting the five rows is the omission the terminus exists to prevent (Constraint 1,
   success criterion 2). Separately only **one** of the five is a pure count duplicate; the other four also
   carry the `feed.v1.json` link, the adds payload link, "every filer has its own page", and the activity
   feed's publication bound. Implemented, found, reverted; pinned as a failing-by-design test so a later
   attempt trips immediately. Three options recorded in the plan's `R10` row.
2. **Footnote blocks: 12, not 10.** The plan's grep was scoped to `src/lib` and missed two page-level sites
   (`feed-footnote`, `inst-index-footnotes`). Neither is in `R7`'s enumerated eight; neither is touched; no
   `.fn-ref` points into either.
3. **`R7b` named 4 key-less tables; 6 needed descriptors** (`member-top`, `holders-ranked`, `holders-lede`,
   `inst-activity` were unnamed). Supplied and recorded.
4. **`R7c` corrected:** `†u` does not apply to the position-diff table — it formats values with `num()`, not
   `valueCell`. Only `‡a` lands there. `‡c` is the orphan `R7c` predicted; it lands on `issuer`.
5. **`R2b` deviation, owner-ratified.** `txnRowHtml`'s `‡` dagger is converted although it also renders on
   `/watchlist/` and `/e/`. Nothing is lost there — a hover-only tooltip becomes real DOM that opens
   declaratively — and the owner chose a CSS default resting place over pulling a sixth page into scope.
6. **`initNotes()` was called by no page** after T2. Notes opened declaratively but had no placement. Fixed.
7. **`" · build "` split exists twice**, not once (`inst-index-client.ts:307` too). Both removed.
8. **`HOLDER_COLUMNS.why` was required by the type and never rendered.** It renders now, as a note.
9. **Behaviour changes worth naming:** `filerBody` with zero deltas no longer prints a six-clause footnote
   registry for a table that is not there; an untruncated activity feed now renders no terminus at all.
10. **`R10` / T6 — RE-ATTEMPTED UNDER THE OWNER'S DIRECTION, AND REVERTED AGAIN.** The owner directed the
    third option in the `R10` row: give each affected `compactDisclosure` a `<noscript>` statement of the same
    bound first, then delete. It was implemented in full — a `noscriptBound` primitive, an opt-in note on the
    control carrying each terminus's non-count remainder, `syncTerminusFor` and its three callers deleted, the
    five `terminusRow` sites removed, and all ten reddened assertions retargeted to the moved text across
    `c4-rankings`, `r19-collapsed-honesty`, `r-codex-regressions` and `r12-congress-behaviour`. `check` and
    `test` were green on it. It was reverted because implementing it surfaced **two more** states in which the
    adjacent control says nothing, and `<noscript>` closes only one of the three:
    **(c)** the control is not revealed at page load even with scripting, on three of the five surfaces — the
    two ranking controls wait for a 22 MB download (F25 deliberately does not sync at bind time) and the
    manager directory's waits for a render (`initSortableTable` deliberately does not paint at init);
    **(d)** `<noscript>` renders when scripting is *disabled*, which is not the same condition as a module
    that failed to load, threw, or returned early — a state this repository has shipped (F1).
    (b), (c) and (d) are now pinned as tests, two of them behavioural, plus a JavaScript-disabled Playwright
    proof. Three concrete options are recorded in the plan's `R10` row for the owner.
11. **`R20`'s "per-row asset expansion" is not converted.** `R8` Class A already settled `assetNameCell` — the
    `title=` deleted, the `.visually-hidden` full name kept as its sibling — and that sibling is not visible
    clutter, so nothing remains on the page surface to move. The later, more specific decision wins.
12. **`R7b` named four key-less table variants; `entityTxnTable` is a FIFTH.** Its `<thead>` is a literal with
    no sort or data key, so the `side-owner` descriptor is supplied by this run rather than invented at render
    time. Only that one column gets a note: inventing explanations for six columns that never had one would be
    new copy, not a relocation.
13. **`R22`'s two already-true clauses.** The `.explainer` already carried its `/methodology/#m2` deep link on
    `origin/main`, and the filer period chips already were one labelled control row (`.period-row`, with a
    visible `Period` label). R16's defect — two stacked, *unlabelled* `.mgr-chips` groups — belongs to the
    institutional adds section and this surface never had it; converting would change the chip grammar for no
    reader-facing gain. Both are asserted rather than assumed.
14. **The `R21` carve-out list was 2; measured, it is 9.** T13's sweep found nine test files whose only match
    is `position_key`. All nine assert the deferred field's data shape, none asserts markup this run changed,
    and a companion test fails if any carve-out file ever also matches a markup token — so the carve-out
    cannot quietly become a blind spot.
15. **Four test files were edited or created outside the manifest** — `sl-member`, `sl-filer`,
    `sl-propagation`, `sl-docs`, plus `lib/fake-dom.ts` and `holders-browser/holders.spec.ts` from the
    code-review round. All are now recorded in Planned Files with their reason. T13's audit caught the last of
    them before it was registered, which is the first evidence the audit does what it claims.

### Code review round (F1–F6) — the tests were rejected, and rewritten

An external review accepted the production fixes and rejected four of their tests as source greps. The
criticism was correct and it is measurable: the behavioural tests this run wrote found two real bugs, the
source-grep ones found none. All four now exercise behaviour.

- **F2** — `rankingAlternatives` counted raw rollup rows instead of rows that can enter the ranked table. The
  test used an empty array, where both counts are zero, so a revert stayed green. Replaced with ticker AND
  member fixtures whose alternative rollup is non-empty and entirely unrankable, plus a positive control.
  Verified: restoring `.rows.length` reddens it.
- **F3** — the settlement re-arm was asserted by grepping `feed-client.ts` for a string. Now drives the real
  `initFeed` over a stubbed failing fetch, presses the real "Try again" control, fails again, and asserts
  settlement on both attempts, with the REAL consumer (`initCongressSections`'s `feedSettled`) reading the real
  pending node. Verified: deleting either the re-arm or the `loadPromise = null` release reddens it.
- **F4** — the `@supports` fallback was exercised on hover only, though R3 names hover AND focus. Both now,
  from a closed start state. The holders period-swap note test lives in the holders lane, because the geometry
  lane's `dist` builds no holders route.
- **F5** — the duplicate-variant tests called `noteId()` directly, asserting that a hash is injective rather
  than that the RENDERER passes a unique key. `instIndexRowHtml` and `txnRowHtml` are now rendered with real
  duplicate-variant rows. The Class-C survivor gate asserts 17 sites by path and emitting function rather than
  by per-file count.

## Model Provenance

T0–T2 and the first half of T3 authored in-session. T3 (back half) through T9 authored by a delegated Opus 5
agent with a fresh context window. The `R2b` CSS default and this document authored in-session. Every commit
carries its reasoning; all gates re-run and green after each.
