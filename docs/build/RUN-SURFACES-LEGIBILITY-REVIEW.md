# Review Brief: SURFACES-LEGIBILITY — hover notes, deleted duplicate prose, two momentum bugs

**Plan:** `docs/build/RUN-SURFACES-LEGIBILITY-plan.md` (validated `plan-v1` **under bash** — see the header
note — 35 requirements: `R1`–`R20`, `R22`–`R29`, plus `R8b`, `R8c`, `R8d`, `R26b`)
**Planned files:** `docs/build/RUN-SURFACES-LEGIBILITY.planned-files.json` (45 paths, `planned-files/v1`).

**This brief is revised after review round 12 (cycles 1–4).** Three owner scope decisions now govern it: `R8` kept in full (`LD10`); `R7` expanded to all five footnote blocks with `/institutional/tickers/[t]/holders/` as a **fifth surface**; and — after review found the same leak three times — **notes are opt-in per call site (`R2b`)**, so a shared renderer called without a scope emits byte-identical output to `origin/main` and `/tickers/*`, `/watchlist/` and `/e/` are unaffected. Two owner scope decisions since round 10: `R8` kept in full (`LD10`), and `R7` expanded to all five footnote blocks with `/institutional/tickers/[t]/holders/` brought into scope as a **fifth surface** — `HoldingsTable.astro:247` appends the holdings footnote block unconditionally to both the filer and holders pages, so converting one without the other would have shipped dangling `#holdings-footnotes` links on a page this run did not own. It reflects requirements `R1`–`R20`, `R22`–`R29` plus `R8b`,
`R8c`, `R8d`, and locked decisions `LD1`–`LD4`, `LD6`–`LD8`. `R21`, `R30`, `R31`, `LD5` and `LD9` — the filer
identity map — were **cut by owner decision on 2026-08-24** after three rounds each closed one face of the
same defect and exposed the next. Their ids are retired and not reused. See
`docs/build/RUN-FILER-IDENTITY-notes.md`.

Manifest history: 39 → 43 (round 11's assertion-consumer sweep) → 48 (round 2's renderer-signature consumers
and newly-scoped source files) → 42 (the R21 deferral) → 43 (`manager-directory.ts`, which `R18` needed
independently of `R8` and which every prior revision omitted) → 44 (`RUN-FILER-IDENTITY-notes.md`, which the
plan claimed carried the deferred-tooltip contract while that file said nothing about it).

**Two corrections that matter to a reviewer of this brief.** First, `R8` grew from a claimed "five `title=`
sites" to a measured **32**, partitioned as **5 deleted / 10 converted / 17 unchanged** (`R8b`, `R8c`). Those counts moved **four times** under review — 6/9/17, 6/10/16, 5/8/19, now 5/10/17 — because the author's
enumerations repeatedly disagreed with the author's totals, and because five successive rounds found a named
key that was null on its rendering branch, non-singular, or a field that does not exist (`AddsRow` has
`issuer_key`, not `position_key`). **Weight the arithmetic and the field names lower than the reasoning**, and
note that the plan now carries a duplicate-variant uniqueness gate precisely so a wrong key fails a test
rather than shipping. That expansion began as the author's judgement; it was put to the owner with the full error record on
2026-08-24 and **ratified** — all fifteen changes kept (`LD10`). Narrowing it remains the reversible
direction, and `LD10` states the exact reversal. Second, every "plan-v1 validates" claim made before cycle 2 round 2 was **unreliable**:
`_wf_validate_plan_traceability` iterates `for id in $ids` over a newline-separated string, which bash
word-splits and zsh does not, so under zsh the loop runs once with a multi-line grep pattern that matches
everything and the traceability check silently passes. Validation is now run under `bash -c`, and the plan
passes there.
**Design source:** `docs/design/SURFACES-LEGIBILITY-PLAN.md` (owner-approved 2026-08-23)
**Visual preview:** `docs/design/handoff/Surfaces Legibility.dc.html` (owner-approved 2026-08-23; unlike every
other `*.dc.html` in that directory, its numbers are **measured**, not placeholder — see Memory Touch-Points)
**Baseline:** `origin/main` @ `b4787ff` — local `main` @ `20e2577` is **behind** and lacks the code under
review. No commit, push or branch switch is performed by this loop.
**Review round:** 1 of 3
**Scope:** implementation has **not** started. This is a plan review only.

**Focus areas the owner most wants challenged:**

(a) **DESIGN-BRIEF §7 compliance.** The brief says *"Do not soften, shrink, or bury the honesty elements to
'clean up' the UI — if a mockup looks cleaner because a caveat disappeared, it's wrong."* This plan moves a
large amount of honesty text off the page surface into hover notes, and at the owner's explicit direction moves
three *counts* (72 date-anomaly rows / 212 undated / 1,412 no-ticker) behind a hover. Is `LD4`'s mitigation —
a visible exclusion **count** suffix on the window statement, with the three numbers in the note — actually
sufficient, or is this the §7 violation the memory `design-handoff-honesty-fold` was written to prevent?

(b) **Is the note primitive's channel set genuinely equivalent to visible text?** Three channels (hover,
click-pin/focus, print) replace a fourth that the owner deleted (a per-table `<details>` block). Does the print
rule plus `aria-describedby` actually preserve reachability for a mouse user who never hovers, a screen-reader
user, and a no-JavaScript reader — and is `@supports not selector(:popover-open)` a real fallback or a
decorative one?

(c) **`R10`'s terminus split.** Five of **thirteen** `terminusRow` call sites are deleted because a
`compactDisclosure` beside them states the same count; **eight** are kept and are now named individually in
Current State. (Round 1 found plan-v1's inventory off by one — it said twelve and seven; corrected against
`git grep`.) Is that partition correct at every one of the thirteen sites, and does deleting `syncTerminusFor`
leave any table whose bound is now stated only by a control label that some code path can fail to update?

(d) **`R8`'s three-class `title=` partition.** Every earlier revision claimed "thirty-two `title=` sites"; the
measured total is **32**. They now partition as 5 Class A (the sibling **provably contains** the
attribute's text, so it is deleted and no note is added — asserted per site, after review found one site where
it did not), 10 Class B (sole channel, renderer holds a verified unique non-null identity, converted), and 17
Class C (sole channel, renderer holds **no** identity — deferred,
with the survivor count gated by file and line). Is the Class-A deletion right, given a prior review put those
siblings there precisely because a tooltip may never be the only channel? Is Class C a legitimate deferral or
a §7 violation wearing a gate? And is the partition arithmetic actually checked rather than asserted — it was
wrong four times in consecutive rounds.

(e) **Gate-assertion retargeting (`LD6`).** Thirteen existing test files assert on markup this run deletes.
Is retargeting them in the same commit the right call, and is any of them encoding a reviewed decision that
this plan is reversing without noticing — the failure mode in memory `reversing-a-reviewed-decision`?

---

## Detected Stack

- **Languages:** Python (`pyproject.toml` at `/`), TypeScript + Astro (`dashboard/package.json`,
  `dashboard/tsconfig.json`).
- **Python runner:** `uv run …` (`uv.lock` present).
- **Node runner:** `npm run <script>` (`dashboard/package-lock.json`; no pnpm or yarn lockfile).
- **Test framework:** `node --test` over `dashboard/test/*.test.ts` (`npm test`) and
  `dashboard/test/post/*.test.ts` (`npm run test:post`); Playwright for `test:geometry` and
  `test:holders-browser`; pytest for Python (`pyproject [tool.pytest.ini_options] testpaths = ["tests"]`).
- **Type check:** `astro check` (`npm run check`); `tsc --noEmit -p tsconfig.slice-tests.json`.
- **Standing gate set, exactly:** `dashboard/` → `npm run gates` = `npm run check && npm test && npm run
  build:bounded && npm run test:post && npm run geometry:install && npm run test:geometry && npm run
  test:holders-browser`. Repo root → `make test` (= `test-python` + `dashboard-gates`), `make security`
  (dep_guard / §19 paid-vendor denylist), `make check` (= `test` + `security`).
- **Linter:** none detected. Corrected — `origin/main` carries no ruff configuration in `pyproject.toml` and
  no ruff invocation in the `Makefile`, and there is no ESLint or Biome config in `dashboard/`. The security
  gate is `scripts/dep_guard.py`, which is a supply-chain denylist, not a linter.
- **Rendering idiom:** SSR string-composing render functions in `src/lib/*.ts`, re-used verbatim by client
  islands in `src/scripts/*.ts`. No component framework, no client UI kit, no CSS preprocessor — one
  hand-authored `src/styles/global.css`.
- **Build constraint:** `build:bounded` refuses to run under 32 GiB physical RAM and caps the heap at 24 GiB.

## Reuse / Duplication Check

Scanned `dashboard/src/**` (TS, Astro, CSS) and `docs/**` Markdown, excluding `node_modules`, `dist*`,
`.venv`, `data-cache`.

| Existing symbol / path | Decision | Why |
|---|---|---|
| `format.ts` `esc`, `fmtInt`, `fmtUsd`, `footnoteBlock`, `compactDisclosure`, `terminusRow` | reuse | `note()` lands beside them and uses the same escaping and formatting helpers. |
| `format.ts:1294` `statTiles` `title=` / `.visually-hidden` pair | reuse the sibling, delete the attribute | The sibling already publishes the same `t.title` as real DOM (`format.test.ts:764` guards it). Class A. Its note under `R19`/`R22` is a separate, additive change, and *that* is what gives `statTiles` a required `scope`. |
| `format.ts:249` `assetNameCell` `title=` / `.visually-hidden` pair | reuse the sibling, delete the attribute | **Renderer name corrected:** there is no `assetCellHtml`. The function is `assetNameCell(r: Pick<TxnRow, "asset" \| "assetType">)`, which receives no row id — the fact that killed the earlier plan to key a note on `txnId` here. It already publishes the full name in a `.visually-hidden` span, so Class A applies: delete the attribute, keep the sibling, change no signature. |
| `format.ts:368` flag label registry (`issuer_from_cusip6: "issuer from CUSIP-6"`) | reuse | `R17`'s chip vocabulary already exists; authoring a second wording for the same fact is the duplication this check exists to catch. |
| `global.css:2820` `.range-control` | reuse | `R16` and `R22` adopt the existing one-row control idiom rather than adding a second. |
| `.flag-provenance` `<details>` + its `::details-content` print rule (`global.css` `@media print`) | reuse | `R15`'s collapsed box and `R4`'s print rule follow a pattern already shipped and already gated. |
| `congress-columns.ts` `CongressColumn.why` | extend | The field exists and is type-required for unsortable columns. A parallel optional `note` field is added for sortable columns rather than overloading `why`, whose contract is "this column has no order". |
| `ui.ts` `rankingExclusions()` | reuse | `R11` keeps the clause strings; only their render target changes. |
| `ui.ts` `rankingCaveatHtml()` | retire | Its sole consumer is the deleted visible line. |
| `format.ts:1143` `syncTerminusFor` | retire | Loses all three callers under `R10`. |
| `table-sort.ts` `initSortableTable` | **edited — one early return (`R25`)** | Round 1 corrected the brief's false claim of a `.th-sort` click target: the listener is on the `<th>` itself (`table-sort.ts:86`) and checks no `event.target`. Round 2 then killed the proposed fix — `stopPropagation()` in a delegated `document` handler runs *after* the `<th>`'s listener, and capture-phase delegation would break `popovertarget` activation. The guard therefore sits inside the sort handler, which puts this file in scope for a one-line target check. A shared-comparator refactor was previously rejected by review and is not reopened. |
| `institutionalDataNoteHtml()` | extend | Container changes; the six clauses do not. |
| A third-party tooltip/popper dependency | **rejected** | The repo ships no client UI kit and Lighthouse is a stated design constraint. Native `popover` plus ~25 lines of placement is smaller than any dependency. |
| A generic "disclosure component" over notes + `.caveat-box` + `.flag-provenance` | **rejected** | Three different interaction contracts; the repo already keeps them separate, correctly. |

**No duplicate implementation is introduced.** The one genuinely new mechanism is the note primitive, which
*replaces* fifteen existing `title=` channels (5 deleted as contained duplicates, 10 converted) and one `.col-why` channel rather than joining them.

## Simplicity Audit

**Minimum coherent design:** one render function, one client binder, one CSS block, one print rule. Every
converted site becomes a call to `note()`.

**Complete enumeration of additions.** Files: `dashboard/src/scripts/notes.ts` (~60 lines),
`dashboard/test/sl-notes.test.ts`, `dashboard/test/sl-surfaces.test.ts`. Exported functions: `note()`
(`format.ts`), `initNotes()` (`notes.ts`). Private helpers in `notes.ts`: `place`, `show`, `hide`,
`closePinned` — four, none reused elsewhere. Types: one optional `note?: string` on `CongressColumn`; one required
`scope` on `statTiles` (`R26`); one required `scope` on `rankingHeadHtml`, `addsHeadHtml` and the
`INST_INDEX_HEADS` mapper (`R26b`); one optional `onSettled` on `initFeed`'s options (`R29`) — no new exported
type, and **no payload parameter of any kind**: the `changesTableHtml` identity map left with `R21`. CSS
classes: `.note`, `.note-btn`, `.note-pop`, `.np-h`, `.window-empty`, `.force-note-fallback` — six. Retired: `syncTerminusFor`,
`rankingCaveatHtml`, fifteen `title=` channels (5 deleted, 10 converted; 17 deliberately unchanged per `R8c`), one `.col-why` channel.

**Rejected abstractions:** a generic disclosure component; a shared comparator/column-registry refactor while
touching three header renderers; a tooltip dependency; a generic "exclusions renderer" spanning the window note
and the filer truncation notice (different claims, different lifetimes).

**Net line-count direction:** negative in `ui.ts` and `global.css` (three footnote blocks, one section
paragraph, one caveat line and one CSS block removed); positive by one small module.

## Tech Debt Introduced

1. **A dynamic note body (`R11`/`R12`).** Owner: the congress surface. Impact: one note's content is live
   state, weaker than the static definitions every other note carries — a future contributor could reasonably
   assume all notes are static and skip the client rewrite. Removal condition: reverting `LD4` returns the
   counts to the page and makes every note static.
2. **Scripted popover placement (`R3`).** Owner: `src/scripts/notes.ts`. Impact: ~25 lines of placement math
   that CSS anchor positioning will make redundant. Removal condition: when `anchor-name` / `position-anchor`
   is available across supported engines, delete the placement function and keep the `popover` attribute.
3. **Seventeen surviving `title=` sites (`R8c`).** Owner: `holdings.ts`, `manager-directory.ts`, and three
   identity-free helpers in `format.ts`/`ui.ts`. Impact: the run's premise is that a tooltip is not a published
   channel, and seventeen tooltips survive it. They are deferred because their renderers hold no stable
   identity to key a note on, so converting them is a signature refactor across eight shared helpers and every
   caller. Bounded, not hidden: the inventory gate asserts exactly 17 by file and line, so the allowance cannot
   grow silently. Removal condition: a follow-up that threads a note context through those helpers, naturally
   bundled with the deferred filer-identity work.
4. **A reversed honesty invariant (`R15`/`LD8`).** Owner: `css-fold.test.ts` and the institutional surfaces.
   Impact: the §5 caveat's six clauses are hidden by default at every width, and the guard forbidding that has
   been replaced. The replacement is stronger, but the shipped property is weaker — one summary sentence by
   default instead of six clauses. Removal condition: the owner reversing `LD8`; the clause markup is
   unchanged either way.
5. **Delegated note binding (`R2`).** Owner: `src/scripts/notes.ts`. Impact: one `document`-level listener set
   serves every note, so a future root that stops propagation before `document` would silently break its
   notes. Chosen because five roots replace their contents today with nothing preventing a sixth. Removal
   condition: none pending — recorded so the coupling is known rather than discovered.

Five debts. Plan-v1 declared three; review established that the reversed honesty invariant and the delegated
binding coupling were real but undeclared, and the R21 deferral retired the payload-contract debt from this
run while `R8c` added the surviving-tooltip debt. Nothing is deferred without an owner, an impact and a
removal condition.

## Memory Touch-Points

| Memory | Effect |
|---|---|
| `design-handoff-honesty-fold` | Drove Constraint 1, `LD3`, `LD4` and focus area (a). Every removal must name its replacement channel; the one genuine §7 bend is recorded with residual and reversal. |
| `mockups-are-not-measurements` | Drove `LD7` and the Current State section: every figure is cited to a live artifact, and the preview states its numbers are measured while labelling its one illustrative frame. This is the first `*.dc.html` in the repo for which a grepped number is trustworthy, which is itself a hazard worth flagging to future readers. |
| `reversing-a-reviewed-decision` | Drove `LD6`, `T13` and focus area (e): `.col-why` and the terminus encode reviewed decisions, so each assertion is retargeted with a comment naming the property it still protects — never edited to go green. |
| `verify-against-a-frozen-tree` | Drove `T0`/`T14`: hash `dashboard/src` and `dashboard/test` before and after every gate run. |
| `plan-review-is-not-code-review` | Drove the mutation spot-check and the insistence on built-output (`test:post`) assertions. Explicitly: approval of **this** brief says nothing about the implementation, and a code round is budgeted separately. |
| `specify-before-rewriting` | Drove writing the plan before touching the three header renderers, each of which has taken repeated review rounds. |
| `probe-dont-argue-from-silence` | Drove measuring the 7d window (0 of 71,632 rows) and testing the popover clipping in a browser rather than reasoning about either. |
| `edit-by-anchor-not-by-slice` | Applies during implementation: replace a section by its own heading bounds. |
| `orchestrate-worktree-isolation` | Drove `T0`'s worktree at `<repo>/.claude/worktrees/surfaces-legibility` from `origin/main`. |
| `pages-25mib-filer-cap` | Drove the deferral itself: the identity map's byte cost on a page already truncating 45,466 of 50,651 rows was never free, and three rounds of bounding it kept surfacing new transport questions. Carried into the successor notes. |

## Repo Structure Conformance

| Planned addition | Conventional location | Plan's location | Conforms? | Notes |
|---|---|---|---|---|
| Note client binder | `dashboard/src/scripts/*.ts` — existing: `feed-client.ts`, `inst-index-client.ts`, `entity-client.ts`, `congress-sections.ts`, `table-sort.ts`, `watchlist-client.ts` | `dashboard/src/scripts/notes.ts` | yes | The `*-client.ts` suffix marks page islands that own a fetch; `table-sort.ts` is the precedent for shared plumbing that owns none. `notes.ts` is plumbing, so the bare name matches `table-sort.ts`, not `*-client.ts`. |
| `note()` render function | `dashboard/src/lib/format.ts` — the shared render primitive module | `format.ts` | yes | Sits beside `footnoteBlock`, `terminusRow`, `compactDisclosure`, `statTiles`. |
| New unit tests | `dashboard/test/*.test.ts`, convention `<slice>-<topic>.test.ts` (`a5-table-css`, `c4-rankings`, `r5-feed-table`) | `dashboard/test/sl-notes.test.ts`, `dashboard/test/sl-surfaces.test.ts` | yes | **Deliberately `sl-`, not `r<n>-`.** See Constraint 9: this run's `R5`/`R10`/`R12`/`R16`/`R17`/`R19`/`R21` collide numerically with earlier runs' requirements already baked into `r5-feed-table.test.ts`, `r10-renderer-regression.test.ts`, `r12-congress-behaviour.test.ts`, `r16-window.test.ts`, `r17-single-fetch.test.ts`, `r19-collapsed-honesty.test.ts` and `ui.ts`'s `R6`/`R18` comments. Every in-source reference this run writes is prefixed `SL-`. |
| Built-output assertions | `dashboard/test/post/*.test.ts` | extends existing `post/` files | yes | No new `post/` file; the new checks join `fixture-preview.test.ts` and the built-page sweeps. |
| CSS | one `dashboard/src/styles/global.css` | same | yes | No new stylesheet; no preprocessor introduced. |
| Methodology anchors | `dashboard/src/pages/methodology/index.astro` | same | yes | Ids only. |
| Run plan + brief | `docs/build/RUN-<NAME>-plan.md`, `docs/build/RUN-<NAME>-*.md` | `docs/build/RUN-SURFACES-LEGIBILITY-plan.md`, `-REVIEW.md`, `.planned-files.json` | yes | Matches `RUN-P3-3-plan.md`, `RUN-M2-11-plan.md`. **Note:** the root `PLAN.md` and `REVIEW.md` belong to ALPHA-SURFACES-V2 and `REVIEW.md` carries 322 uncommitted lines; this run deliberately does **not** write them. |
| Design rationale + preview | `docs/design/*.md`, `docs/design/handoff/*.dc.html` | same | yes | Matches `ALPHA-SURFACES-V2-PLAN.md` and the existing handoff mockups. |
| No new top-level directory | — | — | yes | Nothing is added outside `dashboard/`, `docs/`. |

## Failure-Mode Sweep

| Catalog concern | Applies | Prevention / test |
|---|---|---|
| **F0** full-set sweep over a touched sibling set | yes | `.col-why` has **three** header renderers (`rankingHeadHtml`, `addsHeadHtml`, the `INST_INDEX_HEADS` mapper) — `R5` names all three. `terminusRow` has **twelve** call sites, all twelve enumerated in Current State with a per-site decision. `institutionalDataNoteHtml()` has **three** callers, all three named. `title=` has **five** sites, all five named. |
| **F0** secrets never surface | no | No auth, network call, or environment read is added or touched. |
| **F0** verify, don't assume | yes | The 7d emptiness, the popover clipping, the missing `#coverage` anchor and the `serving_filer_rows` column set are each measured against a live artifact or a browser, and cited. |
| **F1** enumerate all consumers | yes | See the F0 row: four sibling sets fully enumerated. |
| **F1** exact full standing gate set | yes | Detected Stack lists `npm run gates`'s seven steps verbatim plus `make test` / `make security` / `make check`. |
| **F1** re-baseline against the live tree | yes | Local `main` is 8 commits behind `origin/main`; `T0` fetches and cuts from the recorded `origin/main` SHA first, and every line/symbol reference in the plan was read from `origin/main`, not the local checkout. |
| **F1** simplicity audit complete | yes | Every file, exported function, private helper, type and CSS class enumerated above. |
| **F1** units / NULL state for served fields | yes | No new served field and no payload addition of any kind — the one that existed left with the deferral. |
| **F2** lint/type the full gate scope | yes | `astro check` plus `tsc -p tsconfig.slice-tests.json` cover the new module and the new tests. |
| **F2** every new boundary has a test that fails if the feature is removed | yes | Mutation spot-check on the pending indicator, the `onSettled` clear (both paths independently), the empty-window branch, and `note()`'s id derivation; the deferred join is no longer a target. Note tests assert panel content and reachability (including with scripting disabled and under print emulation), not element presence. Round 1 additionally forced the reverse check: every assertion this run *retires* is examined for whether it could have failed on the change that retired it — see `LD8`. |
| **F2** no dead CSS selectors | yes | `R5`/`R10`/`R11` delete markup, so the `.col-why` and ranking `.caveat-line` rules are removed in the same task; `a5-table-css.test.ts` asserts every selector it names still matches emitted markup. |
| **F2** fix stale comments after moving code | yes | `global.css`'s `.col-why` comment and `rankingHeadHtml`'s "a tooltip is not a channel this site treats as published" comment both assert the opposite of what this run does; both are rewritten, not left contradicting the code. |
| **F2** build in a worktree, not the live checkout | yes | `T0`, with the `check-ignore` precondition verified before creation. |
| **F3** reconcile every doc number against code, live and tests | yes | Every figure in the plan is cited to `feed.v1.json`, a live page, or a source line; the preview's provenance banner names its build and `code_sha`. |
| **F4** propagation sweep after any point fix | yes | `LD6` requires each assertion edit in the same commit as the change that invalidated it; `T13` is the sweep. |
| **F5** validate the phase content schema before interpretation | yes | `plan-v1` and `review-brief-v1` both validated before this brief was submitted; `planned-files/v1` extracted from the plan's own Planned Files section. |
| Destructive / production write | no | No commit, push, deploy, producer run, or database write. |
| Migration / schema change | no | No schema is altered and no query is added or changed. |
| Cross-machine state | no | Single checkout, single build. |
| Public API change | no | No published JSON shape changes at all. The one payload addition that existed left with the `R21` deferral, so this is unconditional rather than qualified. |

---

## Review Checklist

1. Is `LD4`'s mitigation sufficient for DESIGN-BRIEF §7, or should the exclusion counts stay visible against
   the owner's instruction? If the latter, say so as a blocker — the owner asked to be told.
2. Is any requirement's **verification** weaker than its claim? Specifically `R2` (channel equivalence),
   `R12` (dynamic note body), `R8c` (whether a gated 16-site tooltip allowance is honest or is §7 erosion with a
   counter attached).
3. `R10`: is the five-deleted / eight-retained terminus partition right at each of the thirteen sites, as now
   enumerated by name in Current State?
4. `R26`/`R26b`: note ids are `scope` + `slug(key)` with no counter. Are both halves actually pinned for every
   call site — including `rankingHeadHtml`, which renders twice in one section, and `memberSignalsPanel`,
   where the same signal kind can repeat on one member? Both were duplicate-id bugs found in review.
5. `R14`: are the "other basis" and "next wider range" counts computable from the rows the page already holds
   at the moment the empty state renders, or does that require a second pass the plan has not budgeted?
6. `R13`: round 1 established that a pre-arrival click is **not** dropped — `range`/`basis` persist and
   `receiveRows` reapplies them — so R13 was re-scoped from a queue to a pending indicator over the existing
   mechanism. Is the re-scoped requirement now an accurate description of the defect, and does the indicator
   close the window in which the pressed button asserts a state the table has not painted?
7. `R15`/`LD8`: round 1 established — and independent verification confirmed — that `droppedAt` would **not**
   catch the collapse at all, because it matches project CSS rules while a `<details>` collapse is a
   user-agent default; the guard would have stayed green with all six clauses hidden at every width. The owner
   ruled to take the height and replace the invariant: a `<summary>` carrying the load-bearing claim in
   visible text, print forcing `open`, and the old assertion deleted and replaced in the same commit by a
   behavioural contract. Is that replacement genuinely stronger than what it retires, and is the summary's
   required text sufficient as the always-visible honesty channel?
8. `R23`: five anchors are populated from text already on the methodology page, but round 1 established that
   `#owner-codes` cannot be — the page carries no SP/DC/JT text at all — so that anchor now moves the reviewed
   sentence from `ui.ts:450`, cited to its source, in the same run that R19 converts it out of the member
   page. Is the relocation claim-preserving, and is requiring each anchor's substantive text (not merely its
   id) the right gate?
9. Task ordering: round 1 found plan-v1's Rollout contradicting `LD6` by sequencing a single "retarget the
   assertions" task after twelve implementation tasks. Corrected — every task now lands its own assertion
   edits in its own commit, and `T13` is a propagation **audit** that should change nothing. Is that ordering
   now safe, and is the audit's stop-condition (a sweep hit outside the manifest escalates rather than
   extending scope in flight) the right one?
10. Anything in the **43** planned files that should not be touched, or any file that must be touched and is
    missing from the list? The list grew by four after round 1's consumer sweep (`format.test.ts`,
    `pages-render.test.ts`, `m1-layout.test.ts`; `filer-payload.test.ts` was added then removed again with the
    `R21` deferral).
11. `T0`: the plan, manifest, design rationale and approved preview are untracked working-tree files, absent
    from `origin/main`, so a worktree cut from it arrives without its own instructions. `T0.a` offers two
    resolutions — the owner lands them first, or they are copied and digest-verified. Is the fallback's proof
    (matching `shasum -a 256` in both trees, mismatch is a STOP) sufficient?
12. `T14`: gates now run as `make test` and `make security` exactly, rather than a hand-expanded npm list that
    omitted `npm ci` and `geometry:install`. Are the frozen-tree hashes correctly placed — bracketing the
    complete invocation rather than each script?

13. Requirements `R25`–`R29`, `R26b` and `R8b`–`R8d` were added across five review rounds to close
    residuals: the sort guard's placement (event order defeats both delegated options), caller-supplied
    note keys **and scopes** (two distinct duplicate-id bugs), a forced-fallback test seam (the gate runs
    Chromium only, which supports `popover`), the four explicit `initNotes()` call sites, a
    settled-callback so the pending indicator clears on feed failure, and the measured `title=` partition
    with an executable aggregate gate. Is each specified tightly enough to build from, and does any
    introduce a mechanism the Simplicity Audit does not enumerate?
14. `T14` now owns reconciling the design rationale, the preview and `BACKLOG.md` against every changed locked
    decision, and runs before implementation handoff rather than after gates. Is that placement right, and is
    the empty-grep completion check sufficient proof?

## Open Questions

1. **`R14`'s counts.** The plan asserts both alternative counts are computable from rows in hand. The momentum
   island holds the full decoded row set (`allRows`), so a second rollup at another basis or range is a pure
   recompute with no fetch — but it is a second `O(n)` pass over 71,632 rows on the interaction path. Is that
   acceptable, or should the empty state name the alternatives without their counts?
2. **Print-channel proof — RESOLVED after round 1, confirm the resolution.** Plan-v1 asserted `R4`'s print
   rule by CSS inspection only. Round 1 was right that a rule in a stylesheet is not a rendered channel.
   `R4` now requires rendering under Playwright's emulated print media and asserting each panel's text has a
   **non-zero layout box** with the anchor hidden; `css-fold` is retained only as the cheap secondary check.
   The same correction gave `R2`/`R3` a scripting-disabled test and a hover/focus test for the `@supports`
   fallback. Note also that the print channel is no longer the only non-interactive one: `popovertarget` makes
   the note openable with no JavaScript at all. Is that coverage now adequate?

## Constraints

1. **DESIGN-BRIEF §7 (verbatim):** *"Do not soften, shrink, or bury the honesty elements to 'clean up' the UI
   — if a mockup looks cleaner because a caveat disappeared, it's wrong."*
2. **M2-CONTRACT §5 / ALPHA-SURFACES-V2 R16:** the institutional data note is non-removable and asserted
   clause-by-clause on every built institutional page.
3. `INSTITUTIONAL_DATA_NOTE_CLAUSES` is pinned to `populus.normalize_inst.INST_DATA_NOTE`; clause text is out
   of bounds.
4. The congress wholly-undisclosed bucket keeps its own table and its own render root, unreachable by any sort.
5. Server and client must render identical bytes for a given row set.
6. `congress-sections.ts` must not call `fetch`, `classifyDataset`, `txnFromArray` or `paperFromArray` —
   `test/r17-single-fetch.test.ts` greps the file.
7. Work starts from `origin/main`; local `main` is behind.
8. Gates run against a frozen tree (hash before and after).
9. Requirement-ID namespace: every in-source reference from this run is prefixed `SL-`; new test files use the
   `sl-` prefix (Constraint 9 of the plan).
10. This loop is advisory and gated: no commit, no push, no branch switch. The owner commits by hand.
