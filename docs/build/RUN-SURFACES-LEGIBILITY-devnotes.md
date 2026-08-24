# RUN SURFACES-LEGIBILITY — dev-notes-v1 (T0–T9)

## Detected Stack

- TypeScript + Astro (`dashboard/`), npm, `node --test` over `dashboard/test/*.test.ts`.
- Type check: `astro check`. Python side untouched this run.
- Worktree `<repo>/.claude/worktrees/surfaces-legibility`, branch `surfaces-legibility`, cut from
  `origin/main` @ `b4787ff`. Local `main` never touched (it is divergent: 1 ahead, 1 behind).

## Requirement and Task Completion

T0, T0.a, T1, T2 complete. T3–T5, T7–T9 complete. **T6 BLOCKED and not implemented** (see Plan Deviations).
T10–T15 not started — this handoff stops at T9 by owner instruction.

Requirements delivered: `R1`, `R2`, `R2b`, `R3`, `R4`, `R5`, `R6`, `R7`, `R7b`, `R7c`, `R8`, `R8b`, `R8c`,
`R8d`, `R8e`, `R9`, `R11`, `R12`, `R13`, `R14`, `R15`, `R16`, `R17`, `R18`, `R23`, `R25`, `R26`, `R26b`,
`R28`, `R29`, and `LD4`, `LD6`, `LD8`, `LD10`. `R10` is blocked.

## Changed Files

33 files under `dashboard/src` and `dashboard/test`; 2,546 insertions, 297 deletions. New:
`src/scripts/notes.ts`, `test/sl-notes.test.ts`, `test/sl-surfaces.test.ts`.

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
2. **`R10` blocked, terminus duplication unresolved.** Five terminus rows still restate a count the adjacent
   control also carries *when scripting is on*. Deferred rather than removed — see Plan Deviations.
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

`npm run check` — 0 errors, 0 warnings, 1 pre-existing hint (`memberSignalsPanel`'s unused `ctx`, present on
`origin/main`). `npm test` — **608 pass, 0 fail** (571 at baseline). Not run, deferred to T15:
`build:bounded`, `test:post`, `test:geometry`, `test:holders-browser`.

## Plan Deviations

1. **`R10` / T6 — BLOCKED, reverted, escalated.** `compactDisclosure` emits `hidden` in **both** return
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

## Model Provenance

T0–T2 and the first half of T3 authored in-session. T3 (back half) through T9 authored by a delegated Opus 5
agent with a fresh context window. The `R2b` CSS default and this document authored in-session. Every commit
carries its reasoning; all gates re-run and green after each.
