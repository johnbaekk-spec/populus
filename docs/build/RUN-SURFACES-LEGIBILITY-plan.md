# RUN SURFACES-LEGIBILITY — plan-v1

Owner-approved design rationale: `docs/design/SURFACES-LEGIBILITY-PLAN.md`.
Owner-approved visual preview: `docs/design/handoff/Surfaces Legibility.dc.html`.

## Goal and Success Criteria

**Goal.** Make the reader-facing surfaces legible without thinning any table — four at the outset, five after
round 11 added `/institutional/tickers/[t]/holders/` (see Scope). Desktop tables keep every
column; the explanatory prose that currently sits above, beside, below and inside them moves into a single
hover-note primitive anchored on the thing it explains, or into the methodology page behind a deep link. Two
reader-visible bugs in the momentum range control are fixed. The narrow viewport is where the table itself
simplifies.

**Success criteria.**

1. No ranking or entity table loses a column, a row, a flag, a marker, or a provenance link.
2. Every string removed from a page surface is reachable in the same build through the note primitive, the
   methodology page, or a control label — and each removal names which.
3. `7d` on the momentum control either renders rows or states in words why it cannot, and a control pressed
   before the dataset arrives states that it is applying rather than silently asserting a window it has not
   yet painted. (The selection itself already applies — see R13; this criterion is about the control's honesty,
   not about a dropped click.)
4. No surface **this run touches** renders a bare `sid:sec:prov:…`, `cusip6:…`, `entity:…` or `name:…` token as
   visible text. The one documented exception is the filer page's position-changes table, whose raw
   `position_key` column is deferred with R21 and is explicitly out of scope here — the `test:post` assertion
   therefore carries a named allowlist entry for that table rather than a blanket pass, so the exception is
   visible in the gate instead of hidden by it.
5. `npm run gates` (astro check, `npm test`, bounded build, `test:post`, geometry, holders-browser) is green on
   a frozen tree, with every assertion this run invalidates retargeted or retired in the same commit as the
   change that invalidated it — never widened to pass.
6. The M2-CONTRACT §5 institutional data note still ships, clause-for-clause, on every built institutional
   page.

## Requirements

| ID | Requirement |
|---|---|
| R1 | `/congress/` page head drops its `.caveat-line` paragraph, keeps a stamp line (`71,632 rows · filed since 2014 · as of <generatedAt>`), and gains four deep methodology links. |
| R2 | A single `note()` primitive in `src/lib/format.ts` renders an inline anchor button plus a panel, over four channels: pointer hover, click-pin (touch) and keyboard focus, print, and **no-JavaScript**. Panel text is real DOM, referenced by `aria-describedby`. The button carries `popovertarget` so show/hide works declaratively with scripting disabled; `initNotes()` is a progressive enhancement that adds placement, hover, Escape and outside-click. The panel id is **deterministic and caller-derived**: `note()` takes a required `scope` and a required `key`, and emits `id = "n-" + scope + "-" + slug(key)`. There is **no ordinal and no counter of any kind** — an ordinal would need a source the renderers do not have, and any counter shared across roots breaks parity on re-render. `key` is a stable token the caller already possesses; R26 fixes it for every converted renderer. `Math.random()` and timestamps are forbidden by Constraint 5. `initNotes()` binds by **event delegation on `document`**, not per-element, so notes created by a later `innerHTML` replacement are live without a rebind call. Activating a note inside a sortable `<th>` never sorts the table — see R25. |
| R2b | **Notes are opt-in per call site. A shared renderer with no scope emits byte-identical output to today.** This is the structural answer to a leak review found three times: this run's renderers are shared with routes it does not own. Measured — `statTiles` has **six** call sites (`format.ts:1287` def; `ui.ts:452`, `:675`, `:781`, `:858`, `:1163`; `holdings.ts:1608`), of which `:675` and `:781` are ticker pages and `:858` is the holders stat block; `memberBody`, `filerBody` and `feedItemHtml` additionally render through `entity-client.ts`, `watchlist-client.ts` and `feed-client.ts` onto `/e/` and `/watchlist/`. **Contract:** every note-capable renderer takes an **optional** `notes?: { scope: string }` parameter. When it is absent the renderer emits exactly what it emits on `origin/main` — no note markup, no id, no `aria-describedby` — and a byte-equality test against baseline proves it per renderer. Only the in-scope call sites pass a scope. Consequences, all deliberate: `statTiles`'s scope is **optional**, not required, so all six call sites keep type-checking and R26's earlier "required `scope`" is **withdrawn**; `/tickers/*`, `/watchlist/` and `/e/` render unchanged and need no `initNotes()`; and a future route that starts passing a scope must add its own initialization site, which R28 states as a standing rule rather than a list to re-audit. |
| R3 | The note panel renders in the top layer via the `popover` attribute with scripted placement, and never inside the clipping context of `.table-scroll`. A non-supporting engine falls back to an absolutely positioned panel under `@supports not selector(:popover-open)`, and that fallback opens on `:hover` and `:focus-within` in CSS alone, so the panel is reachable with scripting disabled on every engine. **The fallback has a forced-test seam (R27)** because the gate's only browser is Chromium, which supports `popover` and can therefore never enter the `@supports` block. |
| R4 | `@media print` lays every note panel out in normal flow beneath its anchor and hides the anchor button, so hover-only text still prints. Verified by rendering the page under Playwright's emulated print media and asserting each panel's text is laid out with a non-zero box — not by asserting the stylesheet contains the rule. |
| R5 | Every `<span class="col-why">` is replaced by a note on its own `<th>`, in all three header renderers (`rankingHeadHtml`, `addsHeadHtml`, the `INST_INDEX_HEADS` mapper). |
| R6 | The congress ranking sections' `.section-note` paragraph and `RANKING_FOOTNOTES` block are replaced by notes on the Net, Txns, Late and flow-column headers. |
| R7 | The footnote blocks are replaced by notes on the columns they qualify. **Measured inventory** (`git grep -nE 'footnoteBlock\((QOQ_FOOTNOTES\|HOLDINGS_FOOTNOTES\|ADDS_FOOTNOTES\|RANKING_FOOTNOTES)' origin/main -- dashboard/src`): **five** call sites, not three — `RANKING_FOOTNOTES` at `ui.ts:1806` and `:2276` (R6's), `ADDS_FOOTNOTES` at `ui.ts:1983`, `QOQ_FOOTNOTES` at `ui.ts:1239`, `HOLDINGS_FOOTNOTES` at `holdings.ts:1655`. Two corrections review forced: `QOQ_FOOTNOTES` renders inside **`filerBody()`** (`ui.ts:1188`), *not* in any header renderer, so it is not reached by converting the three header renderers; and `HOLDINGS_FOOTNOTES` — rendered by `holdingsFootnotesHtml()` and appended by `HoldingsTable.astro` — is the filer page's `§ †u ‡a ‡c` block this requirement always meant, and was named in **no** revision of this plan before round 10. Both are in scope, each mark becoming a note on its own column header. **CORRECTED AT IMPLEMENTATION, 2026-08-24 (T3).** The "five `footnoteBlock` calls" figure was wrong — the
sixth inventory error in this plan. The measuring grep only matched single-line calls of the form
`footnoteBlock(NAMED_CONSTANT`, and four sites pass an **inline literal array** across several lines. Measured
in the worktree with `grep -rnE 'footnoteBlock\(' src/lib`: **ten** call sites emitting **nine** distinct ids,
over **six** footnote sources (`RANKING_FOOTNOTES`, `ADDS_FOOTNOTES`, `QOQ_FOOTNOTES`, `HOLDINGS_FOOTNOTES`,
`ACTIVITY_FOOTNOTES` — which no revision of this plan named — plus four inline arrays).

**Two are out of scope and are NOT touched:** `ui.ts:583` (`ticker-inst-footnotes`, in `tickerInstSectionHtml`)
and `ui.ts:712` (`ticker-footnotes`, in `tickerUnifiedBody`) render on `/tickers/[t]/`, which Non-goals keeps
untouched. Deleting them would have stripped published explanations off a page this run does not own — the
exact leak R2b exists to prevent, reached through R7 instead of through a shared renderer. **R2b decides it
without a new owner ruling:** notes are opt-in, so those two callers pass no scope, keep their
`footnoteBlock`, and emit byte-identical output.

**Eight are converted:** `ui.ts:474` (`member-footnotes`), `:869` (`holders-footnotes`), `:1239`
(`filer-footnotes`), `:1806` and `:2276` (ranking), `:1983` (`inst-adds-footnotes`), `holdings.ts:1655`
(`holdings-footnotes`), `activity.ts:1024` (`activity-footnotes`). The gate asserts **eight** removed and
**two** retained by id, so the exemption is visible rather than assumed.

**Verified mark inventory** — 16 marks across the five originally-named blocks: `RANKING_FOOTNOTES` 3 (`§`, `≈`, `†`), `ADDS_FOOTNOTES` 3 (`‡`, `§`, `†`), `QOQ_FOOTNOTES` **6** (`†v`, `‡u`, `‡r`, `‡e`, `n/c`, `§`), `HOLDINGS_FOOTNOTES` **4** (`§`, `†u`, `‡a`, `‡c`). Every one is enumerated in the Verification Matrix; plan-v10 named only four of QOQ's six. |
**CORRECTED AT IMPLEMENTATION, 2026-08-24 (T3), the seventh and eighth inventory errors.**
(7) The `src/lib` grep misses **two** further `footnoteBlock` call sites that live in PAGES:
`pages/congress/index.astro` (`feed-footnote`) and `pages/institutional/index.astro`
(`inst-index-footnotes`). Neither is in R7's enumerated eight and neither is touched — no `.fn-ref`
points into either id, so both remain valid, self-contained blocks. The total across the repository
is therefore **twelve** call sites: 8 converted, 2 retained on `/tickers/*`, 2 retained on pages.
(8) `#member-footnotes`, `#holders-footnotes` and `#activity-footnotes` are conversions R7b never
gave descriptors for, though all three qualify literal key-less `<thead>`s. Supplied at
implementation and recorded here: **member top-tickers**, `ui.ts`, scope `member-top` — the single
§ clause on `flow-range` (and a second note on the quarterly-flow panel's own `derived ·§` marker,
scope `member-flow`, key `derived`, reading the SAME constant so the two cannot drift).
**Ranked holders**, `ui.ts` `holdersTableHtml`, scope `holders-ranked` — keys are `HOLDER_COLUMNS`'
own sort keys, falling back to the label for the two unsortable columns; § lands on `src`, and this
also renders `HOLDER_COLUMNS.why`, which the type declared REQUIRED and the header had never
rendered at all. The holders `†` clause is about the ticker→issuer mapping, not about any column, so
it anchors on the lede's own marker (scope `holders-lede`, key `issuer-mapping`). **Activity feed**,
`activity.ts`, scope `inst-activity` — `issuer-position`, `filer`, `change`, `delta-value`,
`quarter-ended`, `filed`, `lag`, `flags`; § → `change`, ‡ → `delta-value`, † → `filed`.
**Holders full table** (`holdersFullTableHtml`), scope `holders`, descriptors read from the header
as R7b requires: `filer`, `value`, `securities`, `quarter-filed-lag`, `src`.
Also corrected: `RANKING_FOOTNOTES` moved from `ui.ts` to `congress-columns.ts` (re-exported), because
the column set that now carries its text is declared there and reading it back across the import
would be a module cycle; and `footnotesId` — threaded through `netCellHtml`, `rankingRowHtml`,
`rankingRowsHtml`, `rankingRootHtml` and `congress-sections.ts` solely to aim the ≈ marker at a
section's own block — is **deleted**, since both blocks are gone and the marker now carries no href.

| R7b | **Four key-less table variants get explicit column descriptors, fixed here.** Their `<thead>` rows are literal `<th scope="col">Label</th>` with no sort or data key, so R26's "use the column's own key" has nothing to read; the plan therefore **supplies** the descriptors, which satisfies R26 rather than violating it (R26 forbids a *renderer* inventing a key at render time, not the plan fixing one). Review found the earlier revision naming three variants and attaching the holders descriptors to the wrong function — `holdings.ts:1423` is inside **`positionDiffHtml`**, while `holdersFullTableHtml` begins at `:1457` with a different header at `:1536`. Corrected, in column order: **QOQ / position-changes**, `ui.ts:1096`, scope `filer-changes` — `position-grain`, `change`, `delta-value`, `delta-shares`, `prev-value`, `curr-value`, `prev-shares`, `curr-shares`, `flags`. **Filer holdings**, `holdings.ts:1325`, scope `filer-holdings` — `issuer`, `value`, `shares-unit`, `quarter-filed-lag`, `flags`, `src`. **Position diff**, `holdings.ts:1423` (`positionDiffHtml`), scope `position-diff` — `issuer`, `prior-value`, `curr-value`, `delta-value`, `prior-shares`, `curr-shares`, `change`, `why-not-quantified`; its two period-labelled columns use **fixed** slugs, never the interpolated period, so ids survive a period switch. **Holders**, `holdings.ts:1536` (`holdersFullTableHtml`), scope `holders` — descriptors read from that header at implementation and recorded in the commit, since it is a five-column variant this plan has not enumerated and no revision should enumerate it from memory. |
| R7c | **Mark-to-column mapping follows the emitter, not the label.** Corrected after review: the earlier mapping was written from column names rather than from where each marker is actually rendered. Verified emitters — `†u` is emitted by **`valueCell`** (`holdings.ts:1093`), so it maps to `value`, not `shares-unit`; `‡a` is emitted by **`diffChip`** (`:1340`) and referenced by `positionDiffHtml` (`:1441`), so it maps to `change` on the **position-diff** table, not `flags` on filer-holdings; `§` reaches these tables through **`srcLinkDerived`** (`format.ts:848`), so it maps to `src`. QOQ marks map within `filer-changes`: `†v` → `change`, `‡u` → `delta-shares`, `‡r` → `position-grain`, `‡e` → `change`, `n/c` → `change`, `§` → `src` where that variant renders one and `delta-value` otherwise. **Orphan rule, needed because one exists:** `‡c` is declared in `HOLDINGS_FOOTNOTES` (`holdings.ts:1084`) but **no `.fn-ref` emits it anywhere** — it is a footnote with no marker. Its text moves to the table's `issuer` column note, and the Verification Matrix asserts its presence there, so a declared explanation is not silently dropped just because nothing pointed at it. Where two marks land on one column its note carries both in source-block order. T3 records the final emitter-to-column table in its commit message. |
| R8 | The `title=` explanation channel is retired from the five surfaces, in **two classes**, because the sites are not alike. **Class A — the `title=` is fully contained by an existing real-DOM channel: delete the attribute, add no note.** **Five** sites qualify, each verified individually rather than by pattern: `format.ts:265` (`assetNameCell` — the sibling is a strict *superset*, carrying the same name and type plus "asset as filed, no ticker disclosed"), `format.ts:966`, `ui.ts:254`, `ui.ts:279` (`owner-note` — sibling is `(${ownerLong})`, the same string), and `format.ts:1294` (`statTiles` — sibling is the same `t.title`). A prior review put those siblings there deliberately — `format.test.ts:764` asserts one with the message *"tooltip is never the only channel"* — so converting them to notes would re-litigate a reviewed decision and add a third channel for text that already has two. Deleting a contained attribute honours it. **The containment is asserted per site**, not assumed: a Class-A deletion whose sibling does not contain the attribute's full text fails the gate. **Class B — the `title=` is the sole channel: convert to a note.** These carry no sibling, so removing the attribute without a note would delete the explanation outright. |
| R8b | **Measured inventory, correcting every prior revision.** Each earlier revision said "five `title=` sites". The measured total is **32**, across seven files — `format.ts` 8, `holdings.ts` 10, `inst-index.ts` 4, `inst-adds-render.ts` 3, `ui.ts` 3, `activity.ts` 2, `manager-directory.ts` 2. R8's DoD and its grep would have failed against the real tree in all three earlier rounds. The 32 partition **exactly** into **5** Class A (deleted, R8), **10** Class B (converted, R8/R26) and **17** Class C (unchanged, R8c). The partition is asserted as an exact count, not as an inequality. |
| R8c | **Class C — unchanged, because the renderer cannot supply a unique non-null identity without a signature change.** R26 forbids a renderer inventing a key, so this is the disqualifying test, applied per site. **Seventeen** sites qualify. Identity-free helpers that receive no row: `format.ts:827` (`srcLinkInner(doc: string)`), `:893`, `:901` (`lagHtml(r: Pick<TxnRow, "lag" \| "late">)` — the `Pick` excludes `txnId`), `ui.ts:227` (`flowCellHtml(s: SumRanges)`), `manager-directory.ts:127`, `:137` (`biggestChangeCellHtml(result)`), and all ten `holdings.ts` sites (`provenanceCellHtml(p, stated)` ×3, `valueCell(value, undisclosedNote)`, `sharesCell(shares, unit)`, `filerLinkHtml()`, `positionCell(row)`, `positionDiffHtml(diff, page)`, `holdersFullTableHtml(opts)` ×2). Plus `format.ts:884` (`memberCellHtml`), added in review for a specific measured reason: the site sits in the branch reached **only when `r.bioguide` is falsy** (`:876` returns early when it is set), so the natural key is null exactly where it is needed and every unjoined row would collide. The two `activity.ts` sites were briefly deferred here and then moved back to Class B: `lagCell` already receives the whole declared composite, so it fails the disqualifying test and Class C would have been the wrong home for it. Since Class C sites are untouched, **no string is lost**: they keep exactly the channels they have today. |
| R8e | **`activity.ts:722` is Class B, not Class A, and this was nearly a §7 violation.** Its `title=` reads *"filed date not resolvable from this build's filing dictionary"* — the **cause** — while its `.visually-hidden` sibling reads *"reporting lag not resolvable"* — only the **effect**. Deleting the attribute as a Class-A duplicate would have removed the filing-dictionary explanation with no replacement channel, violating success criterion 2 while the exact inventory gate passed green. It is therefore **converted**: the cause moves into its note (keyed per R26) and the effect sibling is **preserved byte-identical**, so both strings survive and neither channel is lost. This is why R8's Class-A containment is asserted per site rather than inferred from the presence of a sibling — the sibling's existence proved nothing here. |
| R9 | `· build <id>` is removed from every `.panel-head` `.panel-note`. The window statement stays. The `" · build "` split in `applyRollup` is removed with it. |
| R10 | **BLOCKED AT IMPLEMENTATION, 2026-08-24 (T6). NOT IMPLEMENTED — escalated to the owner.** The requirement reads: of the **13** production `terminusRow` call sites, the five that sit beside a `compactDisclosure` stating the same count are deleted; the **eight** with no adjacent expand control are kept; `syncTerminusFor` loses all callers and is deleted; `terminusRow` itself stays. Two measurements taken before implementing it contradict its premise, and the second is disqualifying.

**(a) Only ONE of the five is a duplicate of a count.** Measured in the worktree: `ui.ts` ranking-main also carries "a Public Filings render bound, not a data bound" and a link to `/congress/data/feed.v1.json`; `ui.ts` adds also carries the link to that quarter-and-mode's published JSON; `institutional/index.astro` also states that every filer has its own page; `activity.ts` also carries the shard base path, the shard count, and the record/byte limits each shard is closed at — a **publication** bound, which is a different fact from the render bound and is stated nowhere else in a scripting-on view. Only the wholly-undisclosed bucket's terminus (`ui.ts`) is nothing but its count. Deleting the other four loses published text, which Constraint 1 (DESIGN-BRIEF §7, verbatim) and success criterion 2 forbid.

**(b) DISQUALIFYING — the adjacent control states nothing at all without JavaScript.** `compactDisclosure` emits the `hidden` attribute in **both** of its return branches (`format.ts`); `initDomDisclosures` (`inst-index-client.ts`) and each island's `syncDisclosure` are what call `removeAttribute("hidden")`. So in the no-JavaScript view the count is **not duplicated** — it is stated exactly **once**, by the terminus row. Deleting the terminus therefore removes the reader's only statement of what is being held back, on every one of the five surfaces. That is not a de-duplication; it is the omission the terminus exists to prevent, and it is the same §7 violation the plan's own Alternatives table uses to reject "delete all 13".

**Attempted and reverted.** A version that deleted all five and moved each remainder onto the control as a note was written and backed out, precisely because of (b): the note inherits the control's `hidden`, so the relocation would have hidden the honesty text from the no-JS reader too. Reverting was cheaper than shipping it.

**Pinned, not just described.** `dashboard/test/sl-surfaces.test.ts` carries `SL-R10 BLOCKER`, which asserts (b) directly — the control ships hidden, the terminus does not, and both islands reveal the control by script. A later attempt fails immediately rather than rediscovering this after the deletion lands.

**What the owner must decide** (any one unblocks it): render `compactDisclosure` visible without scripting and keep only the count in it, then delete the five termini; or delete only the wholly-undisclosed bucket's terminus, which is the one true duplicate, and keep four; or accept a `<noscript>` statement of each bound beside the control. `syncTerminusFor` cannot be deleted under any of these until its three callers' termini are, so it stays for now. |
| R11 | The visible exclusion `.caveat-line` and its `#<sectionId>-caveat` root are deleted. `rankingExclusions()` is kept and its clauses compose the window note's body. The window statement carries a visible **excluded-row total** suffix as the note's anchor — the summed magnitude (`· 1,696 rows excluded ⓘ`), not a count of categories — so the size of what the reader cannot see is on the page at every width. The three per-category counts and their definitions live in the note body. |
| R12 | The window note's body is rewritten by the client whenever the range or basis changes, atomically with the rows and the window text. |
| R13 | A range or basis click made before the feed dataset arrives **already applies** — `range`/`basis` are module-scoped state and `receiveRows` calls `recomputeMomentumIfChanged()`. No queue is added. The defect is that `setSeg` paints the button pressed immediately while the table still shows SSR data, so the control asserts a window it has not painted. R13 adds only an honest **pending indicator** on the section (a stated "applying …" state) that clears in `receiveRows`, and changes no state mechanism. |
| R14 | A ranking root whose rollup has zero rankable rows renders a stated empty-window block naming the lag, the count on the other basis, and the count at the next wider range, with controls that switch to them. **Terminal case:** when the range is already the widest (`12m`) there is no wider range, so the block names only the other-basis count; when the other basis is *also* zero at that range the block states that the corpus holds no rankable rows in this window on either basis and offers no switch — it never renders a control that would change nothing. |
| R15 | `institutionalDataNoteHtml()` becomes a collapsed `<details class="caveat-box">`, preserving the element id, all six `data-note-clause` ids, all six `.caveat-line` classes and the print behaviour. Because a collapsed box hides all six clauses at every width, the honesty load moves to the `<summary>`, which must carry the **load-bearing claim in visible text** — that a 13F is a quarterly, long-only, delayed snapshot and not current holdings — plus a deep methodology link; a summary reading only `Details` or the bare heading fails the requirement. `@media print` forces the box `open`. See LD1 and LD8: this **reverses a reviewed invariant**, so the guard that asserted it is replaced, not evaded. |
| R16 | The institutional adds section's two sibling `.mgr-chips` groups become one `.control-row` with visible `Quarter` and `Count` labels. `data-adds-period` and `data-adds-mode` are unchanged. |
| R17 | Raw issuer/position keys stop being visible text. `entity` renders no chip; `cusip6`, `name` and provisional `sid:sec:prov:` render a readable chip whose note carries the raw key, which also persists in a `data-` attribute. |
| R18 | The manager-directory `.caveat-line` about curated typing coverage becomes a note on the Type column, carrying its `N of M` count. |
| R19 | The member page's identity `.entity-lede` paragraph becomes a note on the stamp line and a note on the `Side · Owner` column; its five `memberStatTiles` explanations become notes. |
| R20 | The member page's per-row asset expansion, quarter-chart `.rb-caption`, net-flow `.card-foot` and per-row signal rule each become notes; the *Sector mix* and *Committees* absent panels and `NON_ALLEGATION_CAVEAT` stay visible verbatim. The signal rule is composed **per kind**, not per row (`signals.ts` builds one `rule` string per `computeS<n>`), so the note carrying it is on each row's **Kind cell** — not one note on the shared Kind header, which cannot carry several distinct rules at once. The note is keyed on **`Signal.id`** (`signals.ts:52`, the stable per-signal hash from `signalId(kind, identity)`), **never on the kind**: `memberSignalsPanel` renders up to ten rows and the same kind may appear on several, so a kind-keyed note emits duplicate panel ids and broken `aria-describedby` targets. Verified on two fixtures — a mixed-kind one asserting each rendered kind's exact rule string is reachable, and a **same-member duplicate-kind** one asserting every panel id on the page is unique. |
| R22 | The filer page's `.explainer` **keeps its `href="#inst-data-note"` pointer** and gains a deep methodology link; the canonical box is **not** moved into `filerBody`. The box already ships on this page twice over — `HoldingsTable.astro:246` for the pre-rendered route and `entity-client.ts:480` for the tail route — so rendering it inside `filerBody` would emit a duplicate `id="inst-data-note"`, and `pages-render.test.ts:306` explicitly guards against a second phrasing of the §5 note in the header (QA M2-8 M6 fixed exactly that two-same-titled-blocks defect). R15's collapse supplies the height saving without relocating ownership. Its six `filerTiles` explanations become notes; its period chips become one labelled `.control-row`. |
| R23 | The methodology page gains six stable anchors — `#coverage`, `#amount-ranges`, `#filing-lag`, `#owner-codes`, `#13f-scope`, `#13f-identity`. Five are populated from text already under the `m1`/`m2`/`m3m4` sections; **`#owner-codes` is not** — the page carries no SP/DC/JT text at all, so that anchor is populated by **moving the reviewed sentence from `ui.ts:450`** (the member-page `.entity-lede` that R19 converts), cited to that source, not by improvising new copy. T1 names the source span for each of the six. `#coverage` is currently linked and does not exist. |
| R24 | At **every** swept width — not only 375px — the note anchor is a ≥44px target, measured on a representative anchor per surface, and the panel opens without `display:none`, `visibility:hidden` or `content-visibility:hidden` on `.note-pop`. The fold guard's honesty allowlist is updated to match the markup that exists after this run, and `.note-pop` plus `.note-btn` are added to it. |
| R25 | `initSortableTable` (`table-sort.ts`) ignores clicks whose target lies inside a `.note-btn`: the handler opens `if (ev.target instanceof Element && ev.target.closest(".note-btn")) return;`. `table-sort.ts` is therefore **in scope** for this run. Round 2 established why the alternative fails: the sort listener is on the `<th>` and a delegated `document` handler runs *after* it in the bubble phase, so `stopPropagation()` there is too late; moving the delegated handler to the capture phase would stop the event before it reaches the button and break `popovertarget`'s native activation, which R2 depends on. Guarding inside the sort handler is the only placement correct in both phases, and it protects any future interactive control in a header, not just this one. |
| R8d | **The inventory gate is executable.** `git grep -c` prints *per-file* counts (`2,8,10,3,4,2,3`), not a total, and exits **1** printing nothing when there is no match — so a naive before/after check neither produces 32 nor prints 0, and would stop on a correct tree. The gate is therefore: `git grep -o 'title="' -- dashboard/src/lib | wc -l | tr -d ' '`, which prints an aggregate and yields `0` on no match because `wc -l` counts an empty stream, with `git grep`'s exit status deliberately not propagated (it is a no-match signal, not an error). Asserted **32 before, 17 after** (5 deleted + 10 converted = 15 removed) — not 0 after, because Class C survives by design — plus an exact file-and-line list of the 17 so a new `title=` cannot hide inside the allowance. |
| R26b | **Every note-bearing renderer's `scope` is fixed here, because a key alone does not make an id unique.** Verified: `rankingHeadHtml(cols, active, dir)` (`ui.ts:1552`) takes no scope and is called **twice inside one section** — `:1765` for the ranked table and `:1789` for the wholly-undisclosed bucket — with the same `cols`. Section scope plus column key would therefore emit duplicate panel ids whenever the undisclosed bucket renders, which it does in the measured baseline (one wholly-undisclosed member) and which Constraint 4 guarantees will keep its own table. `rankingHeadHtml` gains a required `scope` argument and its two callers pass **distinct** stable values — `rank-<sectionId>` and `undisc-<sectionId>`. The same rule applies to every renderer invoked more than once per page: `addsHeadHtml` and the `INST_INDEX_HEADS` mapper take a scope; `statTiles` already gains one under R26; per-row renderers derive scope from their table's own id. A page-wide uniqueness assertion runs over a fixture containing **both** ranking tables — the configuration a single-table test cannot see. |
| R26 | Every converted renderer supplies `note()`'s `key` from a token it already has, and no renderer invents one. Fixed here so implementation cannot choose — **ten** Class-B sites in total: **column headers** (R5, R6, R7) use the column's own sort/`data` key; **`statTiles`** (R19, R22 — *not* R8, which merely deletes its redundant `title=`) uses the tile's `label`, and its signature gains an **optional** `notes?: { scope }` per R2b — **not** a required one, which earlier revisions specified and which would have broken all six call sites including two on ticker pages this run does not own. Only `ui.ts:452` (member) and `ui.ts:1163` (filer) pass a scope; **the ten Class-B `title=` sites** (R8) are enumerated exhaustively below; **the window note** (R11) uses the section id; **identity chips** (R17) use the **full activity composite** `` `${cik}-${position_key}-${put_call}-${ssh_prnamt_type}` ``, never bare `position_key`, for the same reason as the activity lag notes — `activity.test.ts:172` holds same-CIK, same-`position_key` rows separated only by PUT/CALL, so a bare key emits duplicate panel ids and ambiguous `aria-describedby` targets; **Kind cells** (R20) use **`Signal.id`** — the stable per-signal hash declared at `signals.ts:52` and built by `signalId(kind, identity)` — **not** the signal kind, because `memberSignalsPanel` renders up to ten rows and the same kind may appear on several, which would emit duplicate panel ids; **filer tiles** (R22) use the tile label.

The **ten** Class-B sites (`R26` names all ten; earlier revisions said eight and nine). Each key below was read off the actual type on `origin/main`, not inferred from a sibling renderer — five successive review rounds found a key here that was null on the rendering branch, non-singular, or simply a field that does not exist, so every field named here is quoted from its declaration.

- `format.ts:952` (`txnRowHtml(r: TxnRow)`) — key `r.txnId` + `dagger`.
- `inst-adds-render.ts:20`, `:23`, `:28` (`addsRowHtml(r: AddsRow, pos: number)`) — key `` `${r.issuer_key}-${pos}` `` + `nodelta` / `partial` / `novalue`. **`AddsRow` has no `position_key`**; its declared fields (`inst-adds.ts`) are `issuer_key`, `issuer_key_source`, `issuer_name`, `manager_count`, `new_position_count`, `delta_value_usd`, `delta_value_is_partial`, `top_adder_cik`, `top_adder_name`. `pos` is included because one issuer may appear under more than one `issuer_key_source`.
- `inst-index.ts:197`, `:201`, `:205`, `:210` (`instIndexRowHtml(r: InstIndexRow)`) — key `r.cik` + `period` / `nullvalue` / `hhi` / `untyped`; one row per CIK per rendered table.
- `activity.ts:722`, `:725` (`lagCell(r: ActivityFeedRecord)`) — key `` `${r.cik}-${r.position_key}-${r.put_call}-${r.ssh_prnamt_type}` `` + `lagcause` / `laganomaly`. This is the repository's own declared row identity (`ActivitySortKey`, `activity.ts`; asserted at `activity.test.ts:131`), and **`lagCell` already receives every component** — so no signature changes here either, which is why these two are Class B and not Class C. `position_key` alone is insufficient: `activity.test.ts:172` holds same-CIK, same-`position_key` rows split only by PUT/CALL.

No renderer's signature changes and no caller is edited for any of the ten.

**Backstop, because this enumeration has been wrong five times.** A hand-written key list is not the contract; the contract is the property. Every Class-B renderer is tested against a fixture containing **duplicate-variant rows** — two rows sharing every identity component but one — and the assertion is page-wide panel-id uniqueness plus exact note reachability. A wrong key therefore fails a test rather than shipping, which is the only guarantee that does not depend on this table being right. `slug()` lowercases and replaces every run of non-`[a-z0-9]` with `-`, so a key is legal in an `id` without a lookup table. Within one scope the keys are unique by construction because each is already a per-row or per-column identity, or a per-row identity joined to a chip name where one row renders several notes. **No Class-A site appears in this table**, because a deleted attribute needs no id — which is what dissolved round 3's finding that `assetNameCell` receives no `txnId` to key on. |
| R27 | The `@supports not selector(:popover-open)` fallback is testable in the gate's own browser. Its declarations are authored **once**, in a shared block emitted into both the `@supports` rule and a `:root.force-note-fallback` rule, and a unit test asserts the two blocks' declaration lists are **byte-identical** — so the seam cannot drift from the fallback it stands for. A Playwright test then sets `force-note-fallback` on the root, disables scripting, and asserts the panel opens on hover and on focus and is readable. This is required because `geometry:install` installs **only** Chromium and both Playwright configs declare a single `chromium` project (`playwright.config.ts:18`, `playwright.holders.config.ts:17`), and Chromium has supported `popover` since v114 — without the seam the fallback could be entirely broken with the browser gate green. Adding a second engine to the gate was rejected: it doubles install time and CI surface for one CSS block. |
| R28 | `initNotes()` is invoked from the inline `<script>` entry of each of the **five** in-scope surfaces, named exactly: `pages/congress/index.astro:302` (beside `initCongressSections` / `initFeed`), `pages/institutional/index.astro:201` (beside `initInstIndex` / `initAddsControls` / `initDomDisclosures`), `pages/congress/members/[bioguide].astro`, `pages/institutional/filers/[cik].astro:102` (beside `initFilerPeriods`), and `pages/institutional/tickers/[t]/holders.astro:96` (beside `initHoldersPeriods`) — five sites, one per surface. It is **not** added to `Base.astro`: that would load the module on every page in the site, including the six this run does not touch, for no benefit. Because binding is delegated, one call per page is sufficient and a second call is idempotent. **Standing rule (R2b):** a route that begins passing a note scope must add its own `initNotes()` site in the same commit — this is a rule, not a list to re-audit, so `/tickers/*`, `/watchlist/` and `/e/` need nothing today precisely because they pass no scope. A built-page test proves scripted hover and placement work on a real page rather than importing `initNotes()` directly — the assertion that plan-v2 could have passed while no page ever called it. The **holders** page is tested specifically **before and after a period replacement**, because `initHoldersPeriods` repaints its root and a note created by that repaint must still open. |
| R29 | R13's pending indicator clears on **every** settled outcome, not only success. `feed-client.ts:106` states that `onRows` fires exactly once and only after a successful decode, and its `.catch` branch (`:219`) calls `renderLoadFailure()` alone — so an indicator cleared only in `receiveRows` would read "applying …" forever after a failed download, which is a false statement about a view that will never be painted. `initFeed` gains an `onSettled` callback fired on both the success and failure paths; `congress-sections.ts` clears the pending state there, and on failure the momentum section states that the selection could not be applied because the dataset did not load. `feed-client.ts` is therefore **in scope**. Tested on both paths. |

## Scope

Four surfaces and their shared renderers:

- `/congress/` — the one-page momentum + feed + member-ranking surface.
- `/institutional/` — the adds leaderboard, activity feed and manager directory.
- `/congress/members/[bioguide]/` — the individual member page.
- `/institutional/filers/[cik]/` — the individual filer page.
- `/institutional/tickers/[t]/holders/` — **added round 11, by owner decision.** Not originally in scope, but
  `HoldingsTable.astro:247` appends `holdingsFootnotesHtml()` **unconditionally** and that component is
  rendered by both `filers/[cik].astro` and `tickers/[t]/holders.astro`. Deleting the block for the filer page
  would therefore strip it from the holders page too, leaving that page's live `§` and `†u` links pointing at
  a `#holdings-footnotes` id that no longer exists. The owner chose to bring the surface in and convert it
  properly rather than special-case the component. It gains notes, a scope, an `initNotes()` site and tests —
  it is a full member of this run, not a bystander.

Shared render code in `dashboard/src/lib/` and the two client islands that re-render into their roots. The
methodology page gains anchors only. **No data-shape change of any kind**, and no published payload change —
both left this plan with R21.

## Non-goals

- No column is added or removed from any table.
- No Python change, and no producer change. With R21 deferred this is now literally true rather than
  approximately true: nothing in this run touches `src/populus/`, `scripts/`, `tests/`, or any generated
  fixture. Round 3 established that R21 would have broken it — `tests/fixtures/filer_payload_parity.v1.json`
  is byte-asserted from both runtimes — which is one of the reasons R21 was cut rather than patched.
- **No published JSON shape changes.** `FilerPayloadV1`, its strict `PAYLOAD_KEYS` allowlist and its fragment
  transport are untouched. This was false in plan-v1, true-with-an-exception in plan-v2, and is unconditional
  again now that the identity map has left the run.
- The filer page's position-changes table keeps rendering its raw `position_key`. That is a real,
  reader-hostile defect and it is **not fixed here** — see the deferral notice above and
  `docs/build/RUN-FILER-IDENTITY-notes.md`.
- The `7d` range button is not removed, and no range is re-defaulted to a different basis.
- The M2-CONTRACT §5 clause text is not edited, reworded or shortened.
- No commit, push, branch switch or deploy. This plan proposes verification; it does not claim it has run.
- `/`, `/signals/`, `/watchlist/`, `/macro/`, `/financials/` are untouched except where they consume a shared
  renderer changed here, which the Verification Matrix covers.
- `/tickers/*` is **no longer** wholly out of scope: `/institutional/tickers/[t]/holders/` is now a named
  surface (see Scope). Every other `/tickers/*` route remains untouched, and the Verification Matrix asserts
  that only the holders route changed.

**Deferred to a separate run — R21, R30, R31, LD5, LD9.** The filer page's position-changes table renders a
raw 32-character `position_key` on every row, and resolving it to an issuer name was `R21` of this run. It is
**cut from this plan** by owner decision on 2026-08-24, after three review rounds each closed one face of the
same defect and exposed the next: the map covered too few periods, then it was built in a function the
pre-rendered route never calls, then that route was found to have no access at all to the uncapped serving
rows the map needs — and, finally, that the payload shape it must change is byte-compared against a
Python-generated fixture (`tests/fixtures/filer_payload_parity.v1.json`, regenerated by
`scripts/regen_filer_payload_parity_fixture.py` and asserted by `tests/test_inst_snapshot_script.py`), which
this plan's own non-goal forbade touching. That is a cross-runtime contract change, not a presentation fix,
and it was never scoped as one.

Everything the three rounds established about it is preserved in `docs/build/RUN-FILER-IDENTITY-notes.md` so
the successor run starts from measured facts rather than repeating the discovery. The requirement ids `R21`,
`R30` and `R31` and the decisions `LD5` and `LD9` are **retired from this plan and not reused**; the gaps in
the numbering are deliberate, so a reference to `R21` in any commit, comment or test can only mean the
deferred work. `R22` is unaffected and stays: it never depended on the identity map.

## Constraints

1. **DESIGN-BRIEF §7, verbatim:** *"Do not soften, shrink, or bury the honesty elements to 'clean up' the UI —
   if a mockup looks cleaner because a caveat disappeared, it's wrong."* R6, R7, R10, R11 and R19 move honesty
   text off the page surface, so each must name its replacement channel. See Locked Decisions LD3 and LD4.
2. **M2-CONTRACT §5 / R16 of ALPHA-SURFACES-V2:** the institutional data note is non-removable and is asserted
   clause-by-clause across every built institutional page. A **second, stricter** invariant also guards it:
   `css-fold.test.ts:1157` asserts `droppedAt(note, width)` is empty at every breakpoint, with the message
   *"the §5 data_note loses content … it may never fold."* R15's collapse reverses that invariant's intent, and
   — verified — evades its letter, because `droppedAt` matches project CSS *rules* against class names while a
   collapsed `<details>` is hidden by the user agent's own default. The guard would stay green while all six
   clauses were hidden at every width. LD8 governs how the invariant is replaced rather than quietly outlived.
3. `INSTITUTIONAL_DATA_NOTE_CLAUSES` is pinned to the Python constant `populus.normalize_inst.INST_DATA_NOTE`.
   Clause text is out of bounds; only its container may change.
4. The congress ranking bucket invariant: the wholly-undisclosed bucket keeps its own table and its own render
   root, unreachable by any sort.
5. Server and client must render identical bytes for a given row set; the parity tests are the contract. This
   binds R2's note ids: any non-deterministic id (a module-level counter shared across roots, a timestamp,
   `Math.random()`) makes an otherwise identical SSR and client render differ and breaks parity.
6. `congress-sections.ts` must not call `fetch`, `classifyDataset`, `txnFromArray` or `paperFromArray` —
   `test/r17-single-fetch.test.ts` greps the file.
7. Local `main` is behind `origin/main`; work starts from `origin/main`.
8. Gates run against a frozen tree: hash `dashboard/src` and `dashboard/test` before and after each gate run.
9. **Requirement-ID namespace collision.** This run's `R5`, `R10`, `R12`, `R16`, `R17` and `R19` are
   distinct from the identically-numbered requirements of earlier runs, several of which are named in existing
   filenames and code comments (`r5-feed-table.test.ts`, `r10-renderer-regression.test.ts`,
   `r12-congress-behaviour.test.ts`, `r16-window.test.ts`, `r17-single-fetch.test.ts`,
   `r19-collapsed-honesty.test.ts`, and `R6`/`R18` in `ui.ts`'s ranking comments). Every reference this run
   writes into source, tests or comments is therefore prefixed `SL-` (e.g. `SL-R11`), and this run's two new
   test files are `sl-notes.test.ts` and `sl-surfaces.test.ts` — never `r<n>-…`, which would read as a
   different run's requirement.

## Current State

Observed 2026-08-23 against `origin/main` @ `b4787ff` and the live build `20260823.1`:

- `dashboard/src/pages/congress/index.astro:129` renders the `.caveat-line` paragraph whose last link is
  `/methodology/#coverage`. `dashboard/src/pages/methodology/index.astro` has ids `m1`, `defaults`, `m2`,
  `m3m4`, `publication`, `privacy` — **no `coverage`**. The link resolves to the top of the page.
- `dashboard/src/lib/ui.ts:1548` (`rankingHeadHtml`) emits `<span class="col-why">` for unsortable columns; its
  own comment states a tooltip "is not a channel this site treats as published". **Thirty-two sites
  nonetheless use a bare `title=`** — measured, `git grep -o 'title="' -- dashboard/src/lib | wc -l`:
  `format.ts` 8, `holdings.ts` 10, `inst-index.ts` 4, `inst-adds-render.ts` 3, `ui.ts` 3, `activity.ts` 2,
  `manager-directory.ts` 2. Every revision of this plan before round 7 claimed **five**, naming
  `format.ts:1294` (`statTiles`), `format.ts:265`, `inst-adds-render.ts:20` and `:23`, `inst-index.ts:201`.
  Two of those five were themselves wrong: the renderer at `format.ts:249` is **`assetNameCell`**, not
  `assetCellHtml` (which does not exist anywhere in the tree), and `inst-index.ts` holds four such sites,
  not one. R8b carries the corrected inventory; R8 / R8c carry the 5 / 10 / 17 disposition.
- `congress-sections.ts:286` — `recomputeMomentum()` opens `if (!allRows) return;`. `feed.v1.json` is 22 MB.
  **A pre-arrival click is NOT dropped**, contrary to plan-v1's framing: `range` and `basis` are module-scoped
  `let`s (`:81`, `:82`) that the click handlers assign (`:243`, `:250`) before calling `recomputeMomentum()`,
  and `receiveRows()` (`:297`) ends by calling `recomputeMomentumIfChanged()` (`:343`), which recomputes when
  either differs from the SSR default (`:349`). What *is* wrong is that `setSeg()` (`:235`) paints the button
  pressed at click time, so between the click and the feed's arrival the control asserts a window the table has
  not painted. That is the defect R13 addresses.
- Measured from `/congress/data/feed.v1.json` (71,632 txn rows): `7d` on the **traded** basis matches
  **0** rows; 30d 123; 90d 947; 12m 6,248. On the **filed** basis: 7d 58 rows across 28 tickers; 30d 585;
  90d 2,338; 12m 7,626. `rankingRootHtml([])` returns an empty string, so the `tbody` paints empty with no
  statement.
- Live exclusion counts on `/congress/`: 72 date-anomaly rows, 212 rows with no trade date, 1,412 in-window
  rows with no ticker — **1,696 excluded rows in total**, the figure R11's visible suffix carries. The total is
  recomputed with the clauses whenever the range or basis changes (R12); it is never hard-coded. Held back: 981 ranked tickers, 118 ranked members. Wholly-undisclosed members: 1.
- `terminusRow` has **13** production call sites, not 12 (`git grep -n "terminusRow(" origin/main -- dashboard/src`
  returns 14 lines; `format.ts:1109` is the definition). They are: `ui.ts:579`, `:936`, `:1104`, `:1168`,
  `:1773`, `:1792`, `:1966`, `:2377` (**eight** in `ui.ts`); `activity.ts:802`, `:989`; `holdings.ts:1287`,
  `:1514`; `institutional/index.astro:168`. Five are adjacent to a `compactDisclosure` that states the same
  count: `ui.ts:1773`/`:1781`, `ui.ts:1792`/`:1797`, `ui.ts:1966`/`:1978`, `activity.ts:989`/`:1013`,
  `institutional/index.astro:168`/`:176`. The **eight** standalone sites R10 keeps are therefore `ui.ts:579`,
  `:936`, `:1104`, `:1168`, `:2377`, `activity.ts:802`, `holdings.ts:1287`, `holdings.ts:1514`.
- `syncTerminusFor` (`format.ts:1143`) has exactly three callers: `congress-sections.ts:226`,
  `inst-index-client.ts:110`, `:241` — all three belong to tables whose terminus R10 deletes.
- `addsSectionHtml` (`ui.ts`) emits two sibling `<div class="mgr-chips">`, which stack. `.range-control`
  (`global.css:2820`) is the existing one-row idiom.
- `table-sort.ts:86` attaches the sort listener to the **`<th>` itself** (`th.addEventListener("click", …)`),
  with no check on `event.target`. Plan-v1's Reuse Map claimed the click target is the `.th-sort` button; that
  is false. Any click bubbling out of a `<th>` — including a note button placed there by R5 — sorts the table.
- Roots whose content is replaced wholesale by `innerHTML` after initial page setup, and which therefore
  produce notes no one-time binder would have seen: `table-sort.ts:78` (`root.innerHTML = render(state)` on
  every sort), `entity-client.ts:861` (txn rows on pagination), `:939` (the whole filer period section on a
  period change), `:1087` (holders table), `:1172`. This is why R2 specifies delegation rather than a rebind
  hook: a rebind hook has to be called from five places and will be missed from the sixth.
- `addsRowHtml` (`inst-adds-render.ts:32`) renders `<span class="mono-note"> cusip6:464287</span>`;
  `activity.ts:740` and `:744` render `position_key` (`sid:sec:prov:<32 hex>`) beside the issuer name.
  `format.ts:368` already carries the readable label `issuer_from_cusip6: "issuer from CUSIP-6"`.
- Member page `S001229`, live: 12 filings, 636 transactions, `$69M–$345M` trailing-12m flow, `+37d` median
  lag, 2 late, 77 rows with no ticker. `ui.ts:450` prints a three-line SP/DC/JT paragraph.
  `assetNameCell` (`format.ts:249` — plan-v1 through plan-v6 called it `assetCellHtml`, which does not exist)
  prints a full sentence per row across all 636 rows. `signals.ts:310` composes the rule
  string, which renders on every signal row.
- Filer page `CIK 0002012383`, live: the position-changes table's identity column is a bare 32-character hash
  on every one of 5,532 rows (`sid:sec:prov:00076fbdb7a2ddaf78c0e89001ecf4f7 · exit · −$631M`). The holdings
  table on the same page prints `MICROSOFT CORP · COM · CUSIP 594918104`. Cause: `QoqDeltaRow` is selected
  from `agg_qoq_deltas` (`inst.ts:171`), which has no `issuer_name` column; `serving_filer_rows` carries
  `(security_id, cusip, issuer_name, position_key)` (`src/populus/inst_serving.py:679`) keyed by the same
  `position_key`.
- `HoldingsTable.astro:246` and `entity-client.ts:480` each append `institutionalDataNoteHtml()` — the
  pre-rendered and tail filer routes respectively. `pages-render.test.ts:306` asserts `filerBody` does **not**
  contain a second phrasing of the §5 note and **does** contain `href="#inst-data-note"`. R22 is constrained
  accordingly.
- `dashboard/test/format.test.ts:763` asserts `title="full breakdown"` — a direct consumer of a channel R8
  removes — and `:764` asserts a `visually-hidden` sibling carries the same text ("tooltip is never the only
  channel"). `pages-render.test.ts:306` consumes `filerBody`'s `.explainer`. Neither file appeared in
  plan-v1's manifest. Tiles: `$5.7T`, 50,651 positions, 0 null-value, 38.6% top-N share, 117 HHI bps, 5,532 QoQ
  moves; 45,466 of 50,651 rows not embedded; 5,185 positions paged 100 at a time over 52 pages.
- Assertions that read the markup this run changes: `c4-rankings.test.ts:183`,
  `r-codex-regressions.test.ts:178`, `r5-feed-table.test.ts:140` and `:159`,
  `r19-collapsed-honesty.test.ts:112`, `:114`, `:165`, `css-fold.test.ts:267`, `:292`, `:598`, `:668`, `:878`,
  `:1166`, `activity.test.ts:679-683`, `post/fixture-preview.test.ts:70`, `:188-198`,
  `post/universal-caveat.test.ts`, `a5-table-css.test.ts`, `test/geometry/layout.spec.ts`.

## Detected Stack

- **Languages:** Python (`pyproject.toml` at `/`), TypeScript + Astro (`dashboard/package.json`,
  `dashboard/tsconfig.json`).
- **Python runner:** `uv run …` (`uv.lock` present).
- **Node runner:** `npm run <script>` (`dashboard/package-lock.json`; no pnpm/yarn lockfile).
- **Test framework:** `node --test` over `dashboard/test/*.test.ts` (`npm test`) and
  `dashboard/test/post/*.test.ts` (`npm run test:post`); Playwright for `test:geometry` and
  `test:holders-browser`; pytest for Python (`pyproject [tool.pytest.ini_options] testpaths = ["tests"]`).
- **Type check:** `astro check` (`npm run check`), plus `tsc --noEmit -p tsconfig.slice-tests.json`.
- **Canonical commands:** `make test` (= `test-python` + `dashboard-gates`), `make security`, `make check`;
  inside `dashboard/`: `npm run gates`.
- **Linter:** none detected. Corrected in round 3 — plan-v2 claimed ruff for Python, but `origin/main` carries
  no ruff configuration in `pyproject.toml` and no ruff invocation in the `Makefile`. There is no ESLint or
  Biome config in `dashboard/` either. The security gate is `scripts/dep_guard.py`, not a linter.
- **Rendering idiom:** SSR string-composing render functions in `src/lib/*.ts`, re-used verbatim by client
  islands in `src/scripts/*.ts`; no component framework, no client UI kit.
- **CSS:** one hand-authored `src/styles/global.css`; no preprocessor, no utility framework.

## Reuse Map

| Existing symbol / path | Decision | Why |
|---|---|---|
| `format.ts` `esc`, `fmtInt`, `fmtUsd`, `footnoteBlock`, `compactDisclosure`, `terminusRow` | reuse | The note primitive lands beside them and uses the same escaping and formatting helpers. |
| `format.ts:1294` `statTiles` `title=` / `.visually-hidden` pair | reuse the sibling, delete the attribute | The `.visually-hidden` span already publishes `StatTile.title` as real DOM (`format.test.ts:764` guards it). R8 Class A removes only the duplicate attribute; the tile's own note under R19/R22 is a separate, additive change. |
| `format.ts:249` `assetNameCell` `title=` / `.visually-hidden` pair | reuse the sibling, delete the attribute | **Renderer name corrected:** there is no `assetCellHtml`; the function is `assetNameCell(r: Pick<TxnRow, "asset" \| "assetType">)`, with four callers (`format.ts:956`, `ui.ts:248`, `:2016`, `:2140`) and test consumers `b7-contract.test.ts` and `m1-layout.test.ts`. It already emits the full name in a `.visually-hidden` span beside the truncated visible one, precisely because a prior review forbade tooltip-only identity. Class A: delete the attribute, keep the sibling, add no note — so its signature is unchanged and no caller is edited. |
| `format.ts:368` flag label registry (`issuer_from_cusip6`) | reuse | R17's chip vocabulary exists; do not author a second wording for the same fact. |
| `global.css:2820` `.range-control` | reuse | R16 and R22 adopt this one-row control idiom rather than adding a second. |
| `.flag-provenance` `<details>` + its `::details-content` print rule (`global.css:2632` block) | reuse | R15's collapsed box and R4's print rule follow a pattern already shipped and already gated. |
| `congress-columns.ts` `CongressColumn.why` | extend | The field already exists and is required by type for unsortable columns; notes read it. A parallel `note` field is added for sortable columns rather than overloading `why`. |
| `ui.ts` `rankingExclusions()` | reuse | R11 keeps the clause strings and changes only where they render. |
| `ui.ts` `rankingCaveatHtml()` | retire | Its only consumer is the deleted visible line; the note body composes the same clauses. |
| `format.ts:1143` `syncTerminusFor` | retire | Loses all three callers under R10. |
| `table-sort.ts` `initSortableTable` | **edited — one early return (R25)** | The listener is on the `<th>` (`table-sort.ts:86`), not on `.th-sort`, and it inspects no `event.target`, so a note button inside a `<th>` sorts on click. Round 2 rejected the caller-side `stopPropagation()` fix: delegated in the bubble phase it runs *after* the `<th>`'s listener, and in the capture phase it stops the event before the button receives it, breaking `popovertarget`. The guard therefore goes inside `initSortableTable` itself, which puts this file in scope. A shared-comparator refactor is not reopened. |
| `feed-client.ts` `initFeed` options | extend | R29 adds one optional `onSettled` callback beside the existing `onRows`. `onRows` fires on successful decode only (`feed-client.ts:106`), so it cannot clear a pending state on the failure path. |
| `institutionalDataNoteHtml()` | extend in place, ownership unchanged | Container changes, clauses do not. Its two render sites (`HoldingsTable.astro:246`, `entity-client.ts:480`) both stay: R22 does **not** relocate the box into `filerBody`, which would emit a duplicate `id="inst-data-note"` on the filer page and trip `pages-render.test.ts:306`. |
| A third-party tooltip/popper library | rejected | The repo ships no client UI kit and Lighthouse is a stated constraint; native `popover` plus ~40 lines of placement is smaller than any dependency. |

## Architecture

**One primitive, one text, four channels.** `note(text, opts)` returns
`<span class="note"><button class="note-btn" popovertarget="<id>" aria-describedby="<id>" …>i</button><span class="note-pop" popover id="<id>" …>…</span></span>`.
The anchor is a real `<button>` so it is focusable and tappable; the panel is a real element so it is DOM, is
referenced by `aria-describedby`, and can be laid out by the print stylesheet.

**The base behaviour is declarative, and the script is an enhancement.** `popovertarget` is the HTML-standard
association that makes a button show, hide or toggle a popover with **no JavaScript at all**. That is the
primary open path. `initNotes()` in a new `src/scripts/notes.ts` adds what the declarative path cannot do —
placement math, hover-open, Escape, outside-click, re-placement on scroll — and its absence degrades the note
to click-to-open, never to unreachable. On an engine without `popover`, the `@supports not
selector(:popover-open)` fallback opens the panel on `:hover` and `:focus-within` in CSS alone. There is no
configuration in which the text is unreachable with scripting disabled, and the tests assert that directly
rather than asserting a stylesheet contains a rule.

**Binding is delegated, not per-element.** `initNotes()` attaches one listener set to `document` and matches
`.note-btn` by `closest()`. Five roots replace their contents with `innerHTML` after page setup — `table-sort`'s
`paint()` on every sort, and `entity-client.ts:861`/`:939`/`:1087`/`:1172` on pagination and period changes — so
a per-element binder would leave notes inert after the first common interaction, and a rebind hook would have to
be called from all five and would be missed from the sixth. Delegation makes the lifecycle question disappear
instead of answering it five times.

**Ids are derived from caller keys, never generated.** `note()` takes a required `scope` (the surface or
section key) and a required `key` (a stable token the caller already holds), and emits
`id = "n-" + scope + "-" + slug(key)`. **There is no ordinal, no counter, and no shared render state of any
kind** — the id is a pure function of its two arguments, so re-rendering the same rows into the same root emits
the same bytes (Constraint 5) and distinct scopes cannot collide page-wide. `Math.random()`, timestamps and
any module-level counter are forbidden by the same constraint. R26 fixes the `key` for every call site, and
R8c defers precisely those sites whose renderer holds no stable identity to key on, rather than letting an
implementer invent one.

**Notes inside sortable headers do not sort — and the guard is in the sort handler, not the note.**
`initSortableTable` listens on the `<th>` (`table-sort.ts:86`) and checks no target. Round 2 killed the
obvious fix: a delegated `document` listener runs **after** the `<th>`'s listener in the bubble phase, so
`stopPropagation()` there cannot un-sort a table that has already sorted; and moving that delegation to the
**capture** phase would stop the event before it reached the button, breaking `popovertarget`'s activation
behaviour, which is R2's whole no-JavaScript path. Both delegated placements are wrong for opposite reasons.
The guard therefore goes where the ordering is unambiguous — inside the sort handler itself (R25) — which puts
`table-sort.ts` in scope for a one-line early return. A test clicks a header note and asserts the sort key and
direction are unchanged, and a second asserts the note still opens.

**Why the top layer.** Measured in the preview: a panel positioned `absolute` inside
`.table-scroll { overflow-x: auto }` is clipped by the scroll container and the last column's note is
unreachable. `popover` puts the panel in the top layer, outside that clip. Placement is scripted because CSS
anchor positioning is not universally available; `@supports not selector(:popover-open)` keeps the absolute
path for engines without `popover`, where the clip is the lesser failure than no panel at all.

**Editorial rule, and where it bends.** A *definition* hovers: what a column means, how a number is computed,
why a column cannot be sorted, what a marker asserts. A *live control state* stays on the page: the expand
button's count, the unrankable separator's count. R11 moves the three *category* counts into a hover at the owner's
direction while keeping their **sum** on the page — a documented bend, mitigated by LD4.

**The window note is dynamic.** Because R11 puts live counts inside a note, that note is the one whose body
changes with a control. `applyRollup` already rewrites `#<sectionId>-window`; it gains one call to rewrite the
note body in the same function, so the two cannot drift. A test asserts it, because a stale count inside a
hover is worse than one on the page: nobody sees it go wrong.

**Deletions are de-duplications, not removals.** R10 deletes only the terminus rows whose count is already
stated by an adjacent expand button. R11's clauses survive in the note body plus a visible count suffix. R7's
footnote text survives on the columns it qualified.

## Locked Decisions

- **LD1 — the 13F box is collapsed, never deleted.** The owner asked for its removal. It is the M2-CONTRACT §5
  structural caveat, pinned to a Python constant and asserted clause-by-clause on every built institutional
  page by `post/fixture-preview.test.ts` and `css-fold.test.ts`. Deleting it would break a published contract
  and redden three gates. R15 collapses it instead: identical DOM, identical clause ids, ~400px of page
  reduced to ~40px. Decided; not reopened by this run. **What LD1 did not say, and LD8 now does:** collapsing
  is not a cosmetic container change. It hides all six clauses by default at every width, which is the exact
  state the second guard forbids. LD8 governs the consequence.
- **LD2 — `7d` stays offered.** An empty window is a true and interesting fact about the corpus (the statutory
  filing lag). R14 states it instead of hiding the control.
- **LD3 — §7 compliance for R6, R7, R10, R19, R20.** These move *definitions* off the page surface. Judged
  §7-compliant because the text is not softened or shrunk, is reachable by hover, focus, tap and print, and
  the honesty *markers* (`§`, `≈`, `†`, chips, flags) all remain visible on the page as the anchors of that
  text. R10 removes no count at all — only a second printing of one.
- **LD4 — §7 tension for R11, accepted with a strengthened mitigation, and reversible.** Moving the exclusion
  counts (72 / 212 / 1,412) into a hover is the one change that puts a *count of what the reader cannot see*
  behind an interaction. The owner directed it. Round-1 review objected that a `· 3 exclusions ⓘ` suffix
  surfaces the number of *categories* while burying the number of *rows*, which is the honesty-bearing figure —
  a fair reading of §7, and the owner accepted it. **Mitigation, revised and decided 2026-08-24:** the window
  statement carries the **summed magnitude**, not a category count —
  `12 months to 2026-08-23 by trade date · 1,696 rows excluded ⓘ`. The size of what the reader cannot see is
  therefore on the page at every width, at the same cost in characters, and is the note's anchor; the three
  per-category counts and their definitions live in the note body. The total is recomputed with the clauses on
  every range or basis change (R12), so it can never disagree with them.
  **Residual, stated and now much smaller:** a reader who never hovers sees how many rows are excluded but not
  the split between date anomalies, missing trade dates and missing tickers.
  **Reversal:** re-render `rankingCaveatHtml(rankingExclusions(...))` into a visible `.caveat-line`; one
  function call, no data change.
- **LD6 — gate assertions are retargeted, never widened, and never in a later commit.** Every assertion this
  run invalidates is edited **in the same commit** as the change that invalidated it, with a comment naming
  this plan and the requirement. A regex is never loosened to make a stale assertion pass. Round 1 caught
  plan-v1 contradicting this in its own Rollout, which sequenced a single "retarget the assertions" task after
  twelve implementation tasks — twelve knowingly-red commits, each briefly missing the guard its change
  reversed. Corrected: **every implementation task carries its own assertion edits as substeps**, T13 is no
  longer a landing phase but a final propagation *audit*, and the Rollout section states the rule per task.
- **LD7 — the preview's provenance is recorded.** `docs/design/handoff/Surfaces Legibility.dc.html` carries
  live measured numbers, unlike every other `*.dc.html` in that directory. It states this in a banner and
  labels its one illustrative frame. Dev reads numbers from the artifacts named in Current State, never from a
  mockup.
- **LD10 — R8's 32-site scope is owner-ratified, not author-assumed.** Decided 2026-08-24. The scope grew
  from a claimed five `title=` sites to a measured 32 on the author's initiative, and that expansion produced
  findings in six of seven review rounds — a nonexistent field name (`AddsRow.position_key`), a key that is
  null on the branch where its note renders (`memberCellHtml`), a non-singular key (`lagCell`), a
  misclassified duplicate (`activity.ts:722`), and three separate miscounts. The owner was given the full
  record and the option to cut back to the five zero-risk deletions, and **chose to keep all fifteen changes**
  (5 Class-A deletions plus 10 Class-B conversions), on the reasoning that ten explanations currently
  unreadable on a phone are worth the residual risk now that the duplicate-variant uniqueness test makes a
  wrong key fail a test rather than ship.
  **What this decision rests on, stated so it can be revisited:** the backstop in R26 — every Class-B renderer
  is tested against a fixture holding two rows that differ in exactly one identity component, asserting
  page-wide panel-id uniqueness. That test, not this plan's key table, is the contract. If implementation finds
  the table wrong again, the correct response is to fix the key and keep the test, **not** to widen the test.
  **Reversal:** drop the ten Class-B conversions, keep the five Class-A deletions, and move the ten into the
  successor run recorded in `docs/build/RUN-FILER-IDENTITY-notes.md`. One requirement edit, no data change.

- **LD8 — the never-fold invariant is REPLACED, on the owner's explicit ruling, not evaded.** Decided
  2026-08-24, after round-1 finding F2. Two facts drove it. First, `css-fold.test.ts:1157` asserts the §5 note
  "may never fold" — a reviewed invariant written against an always-open box. Second, and worse: that guard
  would **not have caught** the reversal. `droppedAt` matches project CSS rules against class names, while a
  collapsed `<details>` is hidden by the user agent's own default — so R15 would have shipped with the guard
  green and all six clauses hidden at every width. A guard that passes while its property is false is the one
  thing this repo's memory `invariant-boundary-test-update-design-change` forbids leaving in place.
  **Ruling:** take the height, and pay for it in the open.
  1. The `<summary>` carries the load-bearing claim as **visible text at every width** — a 13F is a quarterly,
     long-only, delayed snapshot, not current holdings — not a bare heading and not the word `Details`. This is
     the honesty channel that replaces the always-open body.
  2. `@media print` forces the box `open`, so the paper channel is unchanged.
  3. The old assertion is **deleted and replaced in the same commit**, with a comment naming this plan and LD8,
     by a behavioural contract: every one of the six clauses is present in the DOM and reachable by toggling
     the box; the summary's required substring is asserted verbatim; the print block forces `open`; and
     `droppedAt` still runs over the *summary* markup, which may never fold. The replacement is strictly
     stronger than the assertion it retires — it tests reachability, which the old one never did.
  4. `HONESTY_SELECTORS` gains the summary's class so the fold sweep protects the new channel.
  This is a reversal of a reviewed decision and is recorded as such. Reversal: drop the `<details>` wrapper and
  restore the prior assertion; the clause markup is unchanged either way.
## Alternatives Considered

| Alternative | Rejected because |
|---|---|
| Keep `.col-why` visible and only add hovers elsewhere | The `<th>` sub-labels are the largest single source of header height and the owner named them explicitly. Keeping both channels doubles the text. |
| Use `title=` attributes for all notes | Cannot be opened on touch, cannot be styled, inconsistently announced. `.col-why`'s own comment already rejects it, and this run removes **fifteen of the thirty-two** places it is used — 5 deleted as contained duplicates, 10 converted to notes — leaving 17 declared under R8c. |
| CSS-only hover (no JS) | The panel must escape `.table-scroll`'s clip, which needs the top layer, which needs `showPopover()`. The CSS-only path is kept as the `@supports` fallback, not the primary. |
| A `<details>` block per table instead of per-anchor notes | This is what the owner asked to remove (R7 in the design doc). It also puts the text far from the column it explains. |
| Delete all 13 terminus rows | Eight have no adjacent expand control, so their count is stated nowhere else. That would be a §7 violation, not a de-duplication. |
| Remove the `7d` button | Hides a real property of the corpus. LD2. |
| Default short ranges to the `filed` basis | Silently changes what a control means. R14 tells the reader instead and offers the switch. |
| Patch R21 a fourth time instead of deferring it | Rounds 1–3 went 18 → 9 → 8 blockers, and the R21 cluster regenerated in every one — period coverage, then data ownership, then cross-runtime payload parity. Each fix was correct and each exposed the next layer. Deferring it lets thirty converged requirements ship instead of waiting on one that is really a data-architecture question. Owner decision, 2026-08-24. |
| Keep the `· 3 exclusions ⓘ` suffix from plan-v1 | Surfaces the count of *categories* while burying the count of *rows*, which is the honesty-bearing figure. The summed total costs the same characters and answers §7. LD4. |
| Collapse the 13F box and leave `css-fold.test.ts:1157` in place | Verified: the assertion would stay green while all six clauses were hidden at every width, because `droppedAt` reads project CSS rules and a `<details>` collapse is a user-agent default. Shipping behind a guard that cannot see the change is worse than shipping without one. LD8. |
| `<details open>` — collapsible but open on load | Preserves the invariant literally and reclaims no height on load, which was the entire point of the change. Rejected by the owner in favour of LD8's summary-carries-the-claim contract. |
| Move the §5 box into `filerBody` (plan-v1's R22) | Emits a duplicate `id="inst-data-note"` on the filer page — both `HoldingsTable.astro:246` and `entity-client.ts:480` already render it — and reintroduces the two-same-titled-blocks defect QA M2-8 M6 fixed and `pages-render.test.ts:306` guards. |
| Rebind `initNotes()` after each `innerHTML` replacement | Five call sites today and no mechanism preventing a sixth. Delegation on `document` removes the lifecycle question rather than answering it repeatedly. |
| Move the sort listener to `.th-sort` to avoid the note collision | Re-opens a comparator refactor review already rejected, and restructures a working module to fix a caller's problem. R25's early return is one line in the same file and changes no binding. |
| `stopPropagation()` in a delegated `document` note handler (plan-v2) | Wrong in both phases. Bubble-phase delegation runs *after* the `<th>`'s own listener, so the table has already sorted; capture-phase delegation stops the event before the button receives it, breaking `popovertarget` activation and with it R2's no-JavaScript channel. Round 2 found this; R25 replaces it. |
| Per-element `stopPropagation()` bound on each `.note-btn` | Correct on ordering, but reintroduces exactly the per-element lifecycle problem delegation was adopted to remove — notes created by a later `innerHTML` replacement would sort. |

## Planned Files

New:

- `dashboard/src/scripts/notes.ts`
- `dashboard/test/sl-notes.test.ts`
- `dashboard/test/sl-surfaces.test.ts`

Modified — shared renderers:

- `dashboard/src/lib/format.ts`
- `dashboard/src/lib/ui.ts`
- `dashboard/src/lib/congress-columns.ts`
- `dashboard/src/lib/inst-adds-render.ts`
- `dashboard/src/lib/inst-index.ts`
- `dashboard/src/lib/manager-directory.ts`
- `dashboard/src/lib/activity.ts`
- `dashboard/src/lib/holdings.ts`
- `dashboard/src/lib/signals.ts`
- `dashboard/src/styles/global.css`

Modified — pages and islands:

- `dashboard/src/pages/congress/index.astro`
- `dashboard/src/pages/congress/members/[bioguide].astro`
- `dashboard/src/pages/institutional/index.astro`
- `dashboard/src/pages/institutional/filers/[cik].astro`
- `dashboard/src/pages/institutional/tickers/[t]/holders.astro`
- `dashboard/src/pages/methodology/index.astro`
- `dashboard/src/components/HoldingsTable.astro`
- `dashboard/src/scripts/congress-sections.ts`
- `dashboard/src/scripts/inst-index-client.ts`
- `dashboard/src/scripts/entity-client.ts`
- `dashboard/src/scripts/table-sort.ts`
- `dashboard/src/scripts/feed-client.ts`

Modified — assertions retargeted under LD6:

The list below is the output of an assertion-consumer sweep, not a recollection. The sweep greps
dashboard/test on origin/main for the markup tokens this run changes — col-why, title=, terminusRow,
syncTerminusFor, caveat-line, section-note, rankingCaveatHtml, panel-note, explainer, mgr-chips,
position_key, inst-data-note, note-clause — and every hit was read to confirm it asserts markup this run
changes rather than merely mentioning a word. T13 re-runs it as a propagation audit; a hit not on this list is
a scope error, not a licence to edit. Four files were added to this list after round 1, marked below; each
line carries only its path so the manifest extraction stays exact.

- `dashboard/test/c4-rankings.test.ts`
- `dashboard/test/r-codex-regressions.test.ts`
- `dashboard/test/r5-feed-table.test.ts`
- `dashboard/test/r19-collapsed-honesty.test.ts`
- `dashboard/test/css-fold.test.ts`
- `dashboard/test/a5-table-css.test.ts`
- `dashboard/test/ui.test.ts`
- `dashboard/test/activity.test.ts`
- `dashboard/test/holdings.test.ts`
- `dashboard/test/inst-index-client.test.ts`
- `dashboard/test/client-wiring.test.ts`
- `dashboard/test/geometry/layout.spec.ts`
- `dashboard/test/post/fixture-preview.test.ts`
- `dashboard/test/format.test.ts`
- `dashboard/test/pages-render.test.ts`
- `dashboard/test/m1-layout.test.ts`

Why the four added after round 1, and what each is for:

- format.test.ts — line 763 asserts a title attribute of "full breakdown", a direct consumer of the channel R8
  removes. Line 764 asserts the visually-hidden sibling carrying the same text, and that assertion is KEPT
  because it still protects the rule that a tooltip is never the only channel. Line 727 exercises terminusRow
  itself, which R10 keeps — verified unchanged, not edited.
- pages-render.test.ts — line 306 asserts filerBody's explainer content, including the pointer into the shared
  13F box that R22 now keeps, and the guard forbidding a second phrasing of the M2-CONTRACT section 5 note.
  Retargeted only for the added methodology deep link.
- m1-layout.test.ts — line 52 asserts the build id renders exactly once, in the footer. R9 strips the build id
  from panel notes and must leave the footer alone; this test proves it and is expected to need NO edit. It is
  listed so the claim is checked rather than assumed.

Two source files were added to scope after round 2 and are listed above: table-sort.ts (R25's target guard)
and feed-client.ts (R29's settled callback). A third, data.ts, left again with R21.

Round 2 also found the sweep's token list missed renderer-signature consumers: it grepped markup tokens but
not the function names whose signatures change. The sweep is widened accordingly and T13 re-runs the widened
form. The two files that finding surfaced — inst-changes-bound.test.ts and inst.test.ts, both direct callers
of changesTableHtml — are consumers of R21 only, so they leave this run with it and are recorded in the
carve-out notes instead.

Documentation:

- `docs/design/SURFACES-LEGIBILITY-PLAN.md`
- `docs/build/RUN-FILER-IDENTITY-notes.md`
- `docs/design/handoff/Surfaces Legibility.dc.html`
- `BACKLOG.md`

## Implementation Tasks

**T0 — baseline, including the instructions themselves.** **Fetch, never pull.** Measured 2026-08-24: local
`main` is `1 ahead, 1 behind` `origin/main` — genuinely divergent, with neither ref an ancestor of the other —
and the owner's checkout carries uncommitted work. `git pull` would therefore attempt a merge in a dirty
working tree before the run has created anything, which is both a failure mode and a write to a checkout this
run has no business modifying. Instead:

```
git -C "$REPO" fetch --prune origin
BASE=$(git -C "$REPO" rev-parse --verify origin/main)   # record this SHA; it is the baseline
git -C "$REPO" check-ignore -q .claude/worktrees/probe || exit 1
git -C "$REPO" worktree add "$REPO/.claude/worktrees/surfaces-legibility" -b surfaces-legibility "$BASE"
```

Local `main` is **not** updated, merged, rebased or checked out at any point in this run. Copy any gitignored
files the build needs (`.env`, `dashboard/.env.local`) into the worktree. Record `$BASE`. Hash `dashboard/src`
and `dashboard/test`.

**T0.a — carry the authoritative inputs in, and prove they arrived.** Verified: none of this run's **six**
authoritative inputs exists on `origin/main` (`git cat-file -e origin/main:<path>` fails for each), and none is
gitignored — they are untracked working-tree files. A worktree cut from `origin/main` therefore arrives with
**no plan, no manifest, no design rationale and no approved preview**, and three of them are also this run's
documentation *targets*. Either resolution is acceptable, and one must be chosen before any implementation
commit:

- **(a) Preferred — the owner lands the artifacts first.** The owner commits **all six** files listed below to `origin/main`,
  T0 re-cuts from the updated tip, and nothing needs copying. This is preferred because it also makes the
  documentation targets tracked, so T1–T13 edit files that exist.
- **(b) Fallback — copy and digest-verify.** Copy these exact paths into the worktree, record
  `shasum -a 256` for each in the main checkout **and** in the worktree, and confirm the two lists match
  byte-for-byte before the first edit. A mismatch or a missing file is a STOP, never a "close enough":
  `docs/build/RUN-SURFACES-LEGIBILITY-plan.md`,
  `docs/build/RUN-SURFACES-LEGIBILITY.planned-files.json`,
  `docs/build/RUN-SURFACES-LEGIBILITY-REVIEW.md`,
  `docs/design/SURFACES-LEGIBILITY-PLAN.md`,
  `docs/design/handoff/Surfaces Legibility.dc.html`,
  `docs/build/RUN-FILER-IDENTITY-notes.md`.
  Under (b) the three documentation targets under Planned Files are edited in the worktree and the owner
  reconciles them with the main checkout at commit time. *(covers: R1 R2 R3 R4 R5 R6 R7 R8 R9
R10 R11 R12 R13 R14 R15 R16 R17 R18 R19 R20 R22 R23 R24 — precondition for all)*

**Every task below lands its own assertion edits (LD6).** Each `T<n>` is one commit containing the
implementation *and* the edits to every assertion that implementation invalidates, each edit commented with
this plan and the requirement. No task leaves the tree red for a later task to fix. T13 audits propagation; it
is not where assertions land.

**T1 — methodology anchors, each with a named source.** Add the six ids. Five are populated by moving
sentences that already sit under `m1`/`m2`/`m3m4`; **`#owner-codes` is the exception** — verified, the page
carries no SP/DC/JT or owner-code text anywhere, so plan-v1's blanket "no new claims / already on the page"
was wrong for that anchor. Its text is the reviewed sentence **moved from `ui.ts:450`** — *"Filings under this
member include transactions by spouse (SP), dependent children (DC), and joint accounts (JT) — the STOCK Act
does not distinguish who directed a trade"* — which R19 is converting out of the member page's `.entity-lede`
in the same run, so the claim relocates rather than duplicating or appearing from nowhere. T1 records the
source span for each of the six ids in its commit message. No sentence is improvised: every anchor's body is
either moved text from the methodology page or moved text from a named source file. *(covers: R23; retargets
its own assertions per LD6)*

**T2 — the note primitive, opt-in by construction (R2b).** Every note-capable renderer gains an **optional**
`notes?: { scope }`; the no-scope path is implemented first and locked with a byte-equality test against
`origin/main` before any caller opts in, so the leak cannot be introduced and then discovered.
 `note(text, opts)` in `format.ts`; the button carries `popovertarget` and
`aria-describedby`.
`note()` takes a required `scope` and a required `key` and emits `id = "n-" + scope + "-" + slug(key)` — the
R2/R26 formula, with **no ordinal and no counter of any kind**. `initNotes()` in `src/scripts/notes.ts` binds
**once, by delegation on `document`** — placement, hover, Escape, outside-click, re-placement on scroll. The
sort collision is handled in `table-sort.ts`'s own handler (R25),
not here: a delegated handler is too late in the bubble phase and breaks `popovertarget` in the capture phase.
`initNotes()` is called from the four inline script entries named in R28. `note()`'s `key` comes from the
caller per R26; the implementation contains **no counter**, and a test greps for one. `.note`,
`.note-btn`, `.note-pop`, `:popover-open`, the `@supports not selector(:popover-open)` fallback (opening on
`:hover` and `:focus-within`) and the `@media print` block in `global.css`. The fallback declarations are authored once and emitted into
both the `@supports` rule and `:root.force-note-fallback` (R27), with a unit test asserting the two
declaration lists are byte-identical.

Tests, each asserting a behaviour rather than the presence of a rule: escaping; **byte-identical output when
the same rows are rendered twice into the same scope**, and page-wide id uniqueness across scopes;
`aria-describedby` pointing at the panel's own id; the button opening the panel **with scripting disabled**
via `popovertarget`; the panel's text laid out with a non-zero box under **emulated print media**; a click on a
note inside a sortable `<th>` leaving the sort key and direction unchanged; and a note rendered by a *later*
`innerHTML` replacement responding to the delegated binder; the forced-fallback seam opening on hover and focus
with scripting disabled; and a **built page** — not a direct import — exhibiting scripted hover and placement,
which is the assertion that fails if no page ever calls `initNotes()`.
*(covers: R2 R3 R4 R25 R26 R27 R28)*

**T3 — convert the header renderers, all five footnote blocks.** `rankingHeadHtml`, `addsHeadHtml` and the
`INST_INDEX_HEADS` mapper emit notes instead of `.col-why`. Add a `note` field to `CongressColumn` for sortable
columns and populate the ranking, adds and index column sets from `RANKING_FOOTNOTES` and `ADDS_FOOTNOTES`.

**The two filer blocks need their own renderers, which the three header renderers do not reach** (R7):

- `QOQ_FOOTNOTES` (`ui.ts:1239`) renders inside **`filerBody()`**, not a header renderer. Its marks move to
  notes on the position-changes table's own `<th>`s, scope `filer-changes`, key the column's sort/data key.
- `HOLDINGS_FOOTNOTES` (`holdings.ts:1655`) renders via **`holdingsFootnotesHtml()`**, appended
  **unconditionally** by `HoldingsTable.astro:247` — which serves **two** pages. Its four marks move to notes
  on both consuming tables' `<th>`s: the filer holdings table (`holdings.ts:1325`, scope `filer-holdings`) and
  the holders table (`holdings.ts:1423`, scope `holders`), using the descriptors R7b fixes. The holders page
  is in scope for exactly this reason (see Scope); it is not sufficient to convert the filer side and leave the
  holders page pointing at a deleted id.
- These are all **header** notes, so R8c does not touch them — the identity-free cell helpers in `holdings.ts`
  are a different set of sites, and remain Class C.

Delete the `.section-note` paragraph and **all five** `footnoteBlock` calls, from SSR and from the client
render paths, and **retarget every `.fn-ref` marker link** that pointed into `#ranking-footnotes`,
`#inst-adds-footnotes`, `#filer-footnotes` or `#holdings-footnotes` — a link into a deleted id is a broken
internal link, which R23's own `test:post` check forbids. Add R25's one-line target guard to
`initSortableTable` in the same commit as the first header note, so no commit ever ships a header note that
sorts. Give `rankingHeadHtml`, `addsHeadHtml` and the `INST_INDEX_HEADS` mapper their required `scope`
argument per R26b, and pass **distinct** scopes at `ui.ts:1765` (`rank-<sectionId>`) and `:1789`
(`undisc-<sectionId>`) — the same renderer, twice in one section, is the duplicate-id case.
*(covers: R5 R6 R7 R25 R26b)* Add R25's one-line target guard to
`initSortableTable` in the same commit as the first header note, so no commit ever ships a header note that
sorts. Give `rankingHeadHtml`, `addsHeadHtml` and the `INST_INDEX_HEADS` mapper their required `scope`
argument per R26b, and pass **distinct** scopes at `ui.ts:1765` (`rank-<sectionId>`) and `:1789`
(`undisc-<sectionId>`) — the same renderer, twice in one section, is the duplicate-id case.
*(covers: R5 R6 R7 R25 R26b)*

**T4 — retire the `title=` channel where it can be retired, and account for the rest.** Pass one, **Class A**:
delete the redundant attribute at the **five** sites whose `.visually-hidden` sibling
**provably contains** the attribute's full text — `format.ts:265`, `:966`, `:1294`, `ui.ts:254`, `:279` —
keeping every sibling intact, and asserting the containment per site rather than inferring it from the
presence of a sibling. **`activity.ts:722` is NOT in this list** (R8e): its attribute carries the
filing-dictionary *cause* while its sibling carries only the *effect*, so deleting it would remove a string
with no replacement channel. It is Class B, and its note must carry the cause while the sibling keeps the
effect — both strings survive.
`format.test.ts:763`'s `title=` assertion is retired in this commit; `:764`'s sibling assertion is **kept**,
because it still protects the rule that a tooltip is never the only channel. Pass two, **Class B**: convert the
ten sites whose renderer already holds a row identity, each keyed per R26's enumeration — no helper signature
changes and no callers are edited. **Class C** (17 sites) is untouched by design and recorded by file and line
per R8c.

Run the aggregate inventory gate (R8d) immediately before and after:
`git grep -o 'title="' -- dashboard/src/lib | wc -l | tr -d ' '` — **32 before, 17 after** — and record both
numbers plus the file-and-line list of the 17 in the commit message, so a later `title=` cannot hide inside
the Class-C allowance. *(covers: R8 R8b R8c R8d)*

**T5 — congress page head and build stamps.** Rewrite the head per R1; strip `· build <id>` from every
`.panel-note` and remove the `" · build "` split in `applyRollup`. *(covers: R1 R9)*

**T6 — delete the duplicated terminus rows and `syncTerminusFor`.** The five sites named in Current State;
delete `syncTerminusFor` and its three call sites; leave the **eight** standalone terminus rows — `ui.ts:579`,
`:936`, `:1104`, `:1168`, `:2377`, `activity.ts:802`, `holdings.ts:1287`, `holdings.ts:1514` — and
`terminusRow` itself in place. The gate asserts the exact 5-deleted / 8-retained partition against the
measured inventory of 13, not a remembered 12. *(covers: R10)*

**T7 — fold the exclusion counts into the window note.** Delete the visible `.caveat-line` and its root; keep
`rankingExclusions`; retire `rankingCaveatHtml`; add the visible **excluded-row total** suffix (the sum of the
clause counts, e.g. `· 1,696 rows excluded ⓘ` — never a count of categories, per LD4) and the note carrying
the three per-category counts; wire the client rewrite in `applyRollup` so the suffix total and the note body
are recomputed together and cannot disagree. *(covers: R11 R12)*

**T8 — the momentum control's honesty and its empty window.** R13 adds **no state**: `range`/`basis` already
persist and `receiveRows` already reapplies them (Current State). The change is a pending indicator on the
section, set alongside `setSeg()` and cleared once the feed **settles**, so a pressed button never asserts a
window the table has not painted. `initFeed` gains an `onSettled` callback fired on **both** its success and
failure paths (`feed-client.ts` is in scope): plan-v2 cleared the indicator only in `receiveRows`, which
`feed-client.ts:106` documents as firing on success alone, so a failed download would have left "applying …"
on screen permanently — a false statement about a view that will never be painted. On failure the section
states that the selection could not be applied because the dataset did not load. Tests are parameterized over
**both** a range click and a basis click, on **both** the success and failure paths, and assert the indicator
appears at click time and is gone once settled — not that a queue exists.

R14 adds the empty-window block, computing the other-basis and next-wider-range counts from the rows in hand,
**including the terminal branch**: at `12m` there is no wider range, so the block names only the other basis;
when that is also zero it states that no rankable rows exist in this window on either basis and renders no
switch. Zero-result fixtures cover every range on both bases, not only the `7d · traded` specimen.
*(covers: R13 R14 R29)*

**T9 — the institutional index, and the LD8 substitution.** Collapse `institutionalDataNoteHtml()` per R15
with a `<summary>` carrying the load-bearing claim in visible text and `@media print` forcing it `open`. **In
the same commit**, delete `css-fold.test.ts:1157`'s never-fold assertion and land its replacement — clause
presence in the DOM, reachability by toggling, the summary's required substring asserted verbatim, print
forcing `open`, and `droppedAt` still run over the summary markup — commented with this plan and LD8. Add the
summary's class to `HONESTY_SELECTORS`. The old assertion is never deleted without the replacement present in
the same diff. Merge the two chip groups into one `.control-row`; replace raw keys with identity chips in
`addsRowHtml` and the activity renderer; fold the curated-typing caveat into a Type-column note.
*(covers: R15 R16 R17 R18)*

**T10 — the member page.** Identity lede to notes — and, per T1, its owner-code sentence relocates to
`/methodology/#owner-codes` rather than existing in two places. Five tiles to notes; per-row asset expansion,
chart caption and net-flow card foot to notes. The **signal rule note goes on each row's Kind cell, keyed on
`Signal.id`** — the stable per-signal hash at `signals.ts:52`, never the kind, because a member may hold
several signals of the same kind and a kind-keyed id would collide. `signals.ts` composes one rule per kind
(`computeS1` … ) so a single header note cannot carry several distinct rules. Two fixtures: mixed-kind, which
asserts each rendered kind's exact rule string is reachable; and **same-member duplicate-kind**, which asserts
every panel id on the page is unique.
Verify the two absent panels and `NON_ALLEGATION_CAVEAT` are byte-identical to baseline. *(covers: R19 R20)*

**T11 — the filer page.** **The `.explainer` keeps its `href="#inst-data-note"` pointer** and gains the methodology deep link; the §5 box
is **not** moved into `filerBody`. Both existing render sites stay, and an exact-count assertion proves the
built filer page carries exactly one `id="inst-data-note"` and exactly one instance of each of the six clauses.
Six tiles to notes; period chips to one `.control-row`; confirm the truncation terminus and the pager survive.
The position-changes table's **raw `position_key` cells** are not touched — that identity work left with R21 — but its **headers do** gain notes under R7/R7b/R7c, scope `filer-changes`. Plan-v10 said the table was "not touched" without that distinction, which contradicted T3; the boundary is cells, not the table.
*(covers: R22)*

**T12 — mobile and the fold guard.** ≥44px anchors measured at **every** swept width on a representative
anchor per surface, not only at 375px; full-width panel under 720px; add `.note-pop` and `.note-btn` to the
honesty allowlist and update the fold sweep to the post-run markup, each edit commented with the requirement
that justifies it. The LD8 summary class is already in `HONESTY_SELECTORS` from T9; T12 confirms it rather
than re-adding it. *(covers: R24)*

**T13 — propagation audit, not a landing phase.** Per LD6 every assertion edit has already landed as a substep
of the task that invalidated it; T13 changes no assertion that a prior task should have changed. It re-runs the
assertion-consumer sweep from Planned Files against the working tree, and asserts three properties: every file
the sweep now hits is one this run already edited or deliberately verified-unchanged; no assertion was widened
rather than retargeted (each edited assertion carries a comment naming this plan and its requirement); and no
assertion this run retired lacks a strictly stronger replacement — specifically the LD8 substitution for
`css-fold.test.ts:1157`. A sweep hit outside the manifest is a STOP and an escalation to the owner, not an
in-flight scope extension. *(covers: audit of R5 R6 R7 R8 R10 R11 R15 R17 R24)*

**T14 — reconcile the authoritative documents with the decisions this run changed.** Round 2 found
`docs/design/SURFACES-LEGIBILITY-PLAN.md:129` still instructing *"one note on the Kind header"*, which revised
R20 contradicts — two authoritative instructions for the same renderer, in a file that is itself a planned
target. Because that file, the preview and `BACKLOG.md` are owner-approved sources, no earlier task may edit
them in passing. T14 owns them, runs **before implementation handoff, not after**, and reconciles each against
every locked decision this review changed: R20's per-Kind-cell note (LD-less, from round 1's F10); LD4's
summed-total suffix; LD8's summary-carries-the-claim contract; R22's kept pointer; R10's eight retained
terminus rows; R13's pending indicator; R8's three-class `title=` partition; **T0's fetch-only baseline rule**,
because the design rationale still instructs `git pull` at `docs/design/SURFACES-LEGIBILITY-PLAN.md:25` — the
exact operation T0 forbids on a divergent, dirty checkout, and an implementer following the owner-approved
source would do it; and the **removal** of every reference to the deferred identity work, which the design
rationale and the preview both still describe. Each edit cites the finding
that forced it. The preview's measured numbers are re-checked against Current State, and LD7's provenance
banner is updated if any changed. The completion check greps for **exact retired phrases**, never bare words:
`one note on the Kind header`, `3 exclusions`, `seven standalone terminus`, `seven with no adjacent`,
`union of the previous and current`. Round 3 caught the earlier form matching `BACKLOG.md:134`'s unrelated
"all seven cached" — a check that stops on a correct document, or pressures an implementer into editing
unrelated prose, is worse than no check. Each phrase is additionally asserted **positively** at its known
anchor (the design rationale's conversion table row for the Kind rule, the LD4 suffix example, R10's retained
count) so the gate proves the corrected wording is present, not merely that the old wording is absent.
*(covers: documentation propagation for R10 R13 R15 R20 R22)*

**T15 — gates on a frozen tree, using the repository's own commands.** Run the canonical, repository-owned
targets exactly as the Makefile defines them, from the worktree root:

```
make test        # = test-python (uv sync + uv run pytest -q) + dashboard-gates (cd dashboard && npm ci && npm run gates)
make security    # = uv run python scripts/dep_guard.py
```

`make check` (= `test security`) may substitute for both. **Not** a hand-expanded list of npm scripts:
plan-v1's expansion omitted `npm ci` and `geometry:install`, so it could have passed against stale
`node_modules` or a preinstalled browser while the DoD claimed the canonical `npm run gates` had run.
`npm run gates` is `check && test && build:bounded && test:post && geometry:install && test:geometry &&
test:holders-browser` — invoking it through `make` is the only way to get the `npm ci` that precedes it.
Hash `dashboard/src` and `dashboard/test` **immediately before the first command and immediately after the
last**, bracketing the complete invocation rather than each script, and confirm the pre- and post-run hashes
match. A hash mismatch invalidates the run's evidence regardless of the exit codes. *(covers: R1 R2 R3 R4 R5 R6 R7
R8 R9 R10 R11 R12 R13 R14 R15 R16 R17 R18 R19 R20 R22 R23 R24)*

## Testing Strategy

- **Unit (`npm test`, `node --test`).** The note primitive's markup, escaping, `aria-describedby` wiring, and
  **id determinism**: rendering the same rows twice into the same scope yields byte-identical output; ids are
  unique across every scope on a page; and `slug()` maps two distinct keys to two distinct ids over the key
  vocabulary R26 fixes. Each converted renderer is asserted to pass the key R26 names it, so a renderer cannot
  quietly fall back to a counter. Column sets carry a note for every footnote mark they used to
  reference. The window note's body composes exactly `rankingExclusions()`'s clauses **and its visible suffix
  equals their summed row total** — asserted together, so the two cannot drift. The empty-window block renders
  for a zero-rankable rollup at **every** range on **both** bases, including the `12m` terminal branch where no
  wider range exists and the doubly-empty branch where neither basis has rows and no switch is offered. The signal-rule note is tested on **two** fixtures: a mixed-kind one asserting each rendered kind's
  exact rule string, and a same-member **duplicate-kind** one asserting page-wide panel-id uniqueness — the
  case a kind-keyed id would fail and a mixed-kind-only test would never see.
- **DOM / client (`node --test` with the existing fake DOM).** A range click **and** a basis click made before
  `receiveRows` each show the pending indicator at click time and clear it afterwards, with the selection
  applied — the existing mechanism, asserted, not a new queue. A range change rewrites the window note's body
  **and its visible total** together, not only the window text. A sort still replaces exactly one `tbody`, and
  a click on a note *inside* a sortable `<th>` leaves the sort key and direction unchanged. `initNotes` binds
  by delegation and pins exactly one note at a time — and a note rendered into a root **after** `initNotes()`
  ran, by an `innerHTML` replacement, opens correctly: exercised for a sort repaint, entity pagination, an
  institutional period change, and a filer period change.
- **CSS invariants (`css-fold.test.ts`).** `.note-pop` is never `display:none` / `visibility:hidden` /
  `content-visibility:hidden` at any swept width; the honesty allowlist matches the markup that exists after
  this run and includes `.note-pop`, `.note-btn` and the LD8 summary class. **The LD8 substitution lands
  here:** the never-fold assertion at `:1157` is replaced — in T9's commit — by a contract that asserts all six
  clauses are in the DOM, that toggling the box reaches them, that the summary's required substring is present
  verbatim, and that `@media print` forces the box `open`. `droppedAt` continues to run over the summary
  markup, which may never fold. Noted deliberately: the retired assertion could **not** have caught the
  collapse it was supposed to guard, because it reads project CSS rules and a `<details>` collapse is a
  user-agent default — the replacement is therefore strictly stronger, not merely different.
- **Behavioural channel checks (Playwright).** Distinct from the CSS-presence checks above, because a rule in
  the stylesheet is not a rendered channel: with **JavaScript disabled**, activating a note button opens its
  panel and the text is readable; under **emulated print media** every panel's text has a non-zero layout box
  and the anchor button is hidden; on an engine without `popover`, the `@supports` fallback opens on hover and
  focus. These are the assertions that make R2/R3/R4 falsifiable rather than decorative.
- **Built-output (`npm run test:post`).** No built page contains a visible `sid:sec:prov:`, `cusip6:`,
  `entity:` or `name:` token outside a note panel or a `data-` attribute, **with exactly one named exemption**:
  the filer page's position-changes table, whose raw `position_key` column is deferred with R21. The exemption
  is expressed as a single named selector, not a relaxed pattern, and a companion assertion proves **no other**
  table or page claims it — so the deferral is visible in the gate rather than hidden by a widened regex. Every institutional page still
  carries `data-inst-data-note` and all six `data-note-clause` ids. No page prints `build <id>` in a
  `.panel-note`. Every `href="/methodology/#…"` in the built output resolves to an id that exists in the built
  methodology page — the check that would have caught `#coverage`. Each of the six new anchors additionally
  asserts its **required substantive text**, not merely that the id exists: an empty `#owner-codes` must fail.
  Exactly one `id="inst-data-note"` and exactly one instance of each of the six clauses per built page.
- **Geometry (Playwright).** Ranking header height after `.col-why` leaves the `<th>`; a note panel opens
  fully inside the viewport from the last column of a horizontally scrolled table; the anchor is ≥44px at
  **every swept width**, measured on a representative anchor per surface — plan-v1 checked 375px alone, which
  R24 requires at every width.
- **Python (`make test-python`, `make security`).** Unchanged code, run to prove no collateral damage.
- **Mutation spot-check.** On the mechanisms this run actually introduces — **the pending indicator** (invert
  its set-on-click), **the `onSettled` clear** (invert it on each of the success and failure paths
  independently), **the empty-window branch**, and **`note()`'s id derivation** (force two Class-B rows to
  share a key) — confirm each new test fails when its own mechanism is inverted; a surviving mutant means the
  test asserted an end state rather than the property. Plan-v1's targets are deliberately gone: "the queue"
  names a mechanism R13 now **forbids**, and "the join" left with the R21 deferral, so mutating either is
  either impossible or out of scope.

## Verification Matrix

| ID | Check | Evidence |
|---|---|---|
| R1 | Built `/congress/index.html` has no `.caveat-line` in the page head and carries the stamp line plus four `/methodology/#…` links | `test:post` assertion + rendered HTML |
| R2b | Each note-capable renderer, called **without** a scope, emits output byte-identical to `origin/main`; `statTiles`'s six call sites all type-check with only two passing a scope; no out-of-scope route emits `.note` markup | `npm test` + diff vs baseline |
| R2 | `note()` unit tests: markup shape, escaping, `aria-describedby`; ids **deterministic and caller-keyed** (same rows twice → identical bytes, no counter present in the implementation) and unique page-wide; the button opens the panel **with JS disabled** via `popovertarget`; a note click inside a sortable `<th>` leaves sort key and direction unchanged; a note created by a later `innerHTML` replacement opens (delegation) | `npm test` + Playwright (no-JS) |
| R3 | Panel opens fully in-viewport from the last column of a scrolled table; the `@supports` fallback **opens on hover and focus** with no script running, exercised in a browser rather than asserted as CSS text | Playwright geometry + `css-fold` |
| R4 | Under **emulated print media** every `.note-pop`'s text has a non-zero layout box and `.note-btn` is hidden — rendered, not inferred from the stylesheet | Playwright (print emulation) + `css-fold` |
| R5 | No built page contains `class="col-why"`; each formerly-unsortable `<th>` carries a note | `test:post` |
| R6 | Ranking tables carry notes for `§`, `≈`, `†`; no `.section-note` paragraph and no ranking `footnoteBlock` remain | `npm test` + `test:post` |
| R7 | All **five** `footnoteBlock` calls are absent from the tree. Every one of the **16** marks is asserted individually on the column R7c maps it to: ranking `§ ≈ †`; adds `‡ § †`; QOQ `†v ‡u ‡r ‡e n/c §`; holdings `§ †u ‡a ‡c`. **No `.fn-ref` link targets a deleted footnote id**, and no built page contains `#ranking-footnotes`, `#inst-adds-footnotes`, `#filer-footnotes` or `#holdings-footnotes` | `npm test` + `test:post` |
| R7b | Each of the three key-less tables emits notes whose ids use the fixed descriptors, in column order; the holders table's two period-labelled columns keep stable slugs across a period switch (asserted by rendering two periods and diffing the ids) | `npm test` |
| R7c | Every mark resolves to its mapped column; a column carrying two marks holds both explanations in source order; no mark is dropped on a table variant that lacks its column | `npm test` |
| R8 | The **five** Class-A attributes are gone and their `.visually-hidden` siblings are byte-identical to baseline, with containment asserted per site; each of the ten Class-B sites carries a note holding its former attribute text verbatim | `npm test` + diff |
| R8b | The 5 / 10 / 17 partition is asserted as an **exact** count summing to 32, not as an inequality | `npm test` |
| R8e | `activity.ts:722` keeps **both** strings: its note carries the filing-dictionary cause and its `.visually-hidden` sibling still carries the lag effect, asserted verbatim; the site appears in no Class-A deletion list | `npm test` + diff |
| R8c | Exactly 17 `title=` attributes remain — the Class-C list, matched by file and line, matching the file-and-line list by name; a `title=` at any other location fails | `npm test` |
| R8d | `git grep -o 'title=\"' -- dashboard/src/lib \| wc -l \| tr -d ' '` prints `32` at baseline and `17` after; the command yields a number rather than exiting 1 on no match | recorded gate output |
| R9 | No `.panel-note` in any built page contains `build ` | `test:post` |
| R10 | The inventory is **13**; exactly five call sites removed and the **eight** named standalone sites remain, asserted as an exact partition; `syncTerminusFor` is absent from the tree and has no callers | `npm test` + grep |
| R11 | No `#<sectionId>-caveat` element; the window statement shows the **summed excluded-row total**, and that total equals the sum of the note body's clause counts, asserted in one test so they cannot drift; note body equals `rankingExclusions()` output | `npm test` + `test:post` |
| R12 | A simulated range change rewrites the note body and the window text together | `npm test` (fake DOM) |
| R13 | Parameterized over a **range** click and a **basis** click: the pending indicator appears at click time and is cleared by `receiveRows`, and the selection is applied — asserting the existing mechanism, with no queue introduced | `npm test` (fake DOM) |
| R14 | A zero-rankable rollup renders the empty-window block naming the other-basis and wider-range counts, at **every** range on **both** bases; at `12m` the block omits the wider-range clause; when both bases are empty it states so and renders no switch | `npm test` |
| R15 | Every built institutional page carries `data-inst-data-note` and all six `data-note-clause` ids inside a `<details>`, **exactly once each**; the `<summary>` carries its required substantive claim verbatim; toggling reaches every clause; the box prints open; the LD8 replacement assertion is present and the retired never-fold assertion is absent | `test:post` + `css-fold` + `activity.test.ts` |
| R16 | The adds section renders one `.control-row` containing both groups; `data-adds-period` / `data-adds-mode` unchanged | `npm test` + `inst-index-client.test.ts` |
| R17 | No built page shows a raw key as visible text; each weak identity carries a chip and a note; the raw key is present in a `data-` attribute. The filer position-changes table is the single named exemption (deferred with R21), asserted by name, with a companion check that no other table claims it | `test:post` |
| R18 | The manager directory has no standalone typing `.caveat-line`; the Type column note carries the `N of M` count | `npm test` |
| R19 | The member page head has no `.entity-lede` caveat paragraph; the stamp line and Owner column carry notes; five tiles carry notes | `npm test` + `test:post` |
| R20 | Asset cells, chart caption and net-flow foot carry notes; on a **mixed-kind** fixture each row's Kind cell carries a note holding that kind's **exact** rule string from `signals.ts`, and on a **same-member duplicate-kind** fixture every panel id on the page is unique (the note is keyed on `Signal.id`, never on the kind); the two absent panels and `NON_ALLEGATION_CAVEAT` are byte-identical to baseline | `npm test` + diff |
| R22 | The filer page **keeps** its `.explainer` `href="#inst-data-note"` pointer and gains the methodology deep link; the built page carries **exactly one** `id="inst-data-note"` and one instance of each clause (no duplicate from a relocated box); `filerBody` still contains no second phrasing of the §5 note (`pages-render.test.ts:306`); six tile notes; one period `.control-row`; the truncation terminus and pager remain | `npm test` + `test:post` |
| R23 | Every `/methodology/#…` href in the built output resolves to an id present in the built methodology page, **and** each of the six new anchors contains its required substantive text — an empty or heading-only `#owner-codes` fails | `test:post` |
| R25 | A click on a note inside a sortable `<th>` leaves the sort key and direction unchanged **and** still opens the note; `table-sort.ts` contains the target guard and no other change | `npm test` (fake DOM) |
| R26b | A fixture rendering **both** ranking tables in one section emits no duplicate panel id; `rankingHeadHtml` requires a `scope` and its two callers pass distinct values | `npm test` |
| R26 | Every converted renderer passes the key R26 names it; the implementation contains no counter (asserted by grep); two distinct keys never collide after `slug()` over the fixed key vocabulary | `npm test` |
| R27 | The `@supports` block's declarations and `:root.force-note-fallback`'s are byte-identical; with the seam class set and scripting disabled, the panel opens on hover and on focus and its text is readable | `npm test` + Playwright |
| R28 | Each of the **five** surfaces calls `initNotes()` at its named site; a **built page** exhibits scripted hover and placement without the test importing `initNotes()`; the holders page's notes work **after** a period replacement; and no out-of-scope route (`/tickers/*` other than holders, `/watchlist/`, `/e/`) emits any `.note` markup | `test:post` + Playwright |
| R29 | The pending indicator clears on the feed's success path **and** on its failure path; on failure the section states the selection could not be applied | `npm test` (fake DOM), both paths |
| R24 | `.note-pop` is never suppressed at any swept width; the anchor is ≥44px at **every** swept width on a representative anchor per surface; the honesty allowlist matches the shipped markup and includes `.note-pop`, `.note-btn` and the LD8 summary class | `css-fold` + Playwright |

## Rollout / Rollback

**Rollout.** **Every task is one commit containing its implementation *and* the assertion edits that
implementation invalidates (LD6).** No commit in this sequence is knowingly red, and no reviewed guard is
reversed in one commit and replaced in a later one — round 1 correctly caught plan-v1's sequencing doing
exactly that. Order: docs-only and presentation-only changes first (T0 → T7), then the momentum work (T8),
then the per-page passes (T9 → T11), then mobile (T12), then **T14**, which reconciles the three owner-approved
documents before handoff — deliberately not last-after-gates, because a stale design rationale misinstructs
the implementer it is handed to. T11 is late because it is the last per-page pass; with R21 deferred, no task in this run touches a data path
or a published payload shape. **T13 is an audit, not a landing
phase:** it re-runs the assertion-consumer sweep and verifies that propagation is complete, that nothing was
widened rather than retargeted, and that the LD8 replacement is present — it should change no assertion, and a
sweep hit outside the manifest stops the run and escalates. T15 then runs `make test` and `make security` on
the frozen tree. Nothing deploys inside this run; the owner arms any publish separately, and the deploy gate's
own preconditions (attested `code_sha`, the promotion settle) are out of scope here.

**Rollback.** Every item is independently revertible, and three are worth naming: R11 reverts by re-rendering
`rankingCaveatHtml(rankingExclusions(...))` into a visible `.caveat-line` (LD4); R10 reverts by restoring the
five `terminusRow` calls and `syncTerminusFor`; R15 must **not** be reverted to a deleted box — the contract in Constraint 2
stands regardless.

## Simplicity Audit

**Minimum coherent design:** one render function, one client binder, one CSS block, one print rule. Every
converted site becomes a call to `note()`; nothing else gains a mechanism.

**Rejected abstractions.** A generic "disclosure component" spanning notes, `<details>` boxes and flag
disclosures — three different interaction contracts wearing one name; the repo already has `.flag-provenance`
and `.caveat-box` and they are correctly separate. A shared comparator or column-registry refactor while
touching three header renderers — out of scope and previously rejected by review for `initSortableTable`. A
tooltip dependency (Reuse Map). A generic "exclusions renderer" abstracting the window note and the filer
truncation notice — they are different claims with different lifetimes.

**Complete enumeration of what this run adds**, restated after the R2b opt-in contract and the fifth surface. Files:
`dashboard/src/scripts/notes.ts` (one module, ~60 lines), `dashboard/test/sl-notes.test.ts`,
`dashboard/test/sl-surfaces.test.ts` — the `sl-` prefix per Constraint 9. Exported functions: `note()` in
`format.ts`; `initNotes()` in `notes.ts`. Non-exported
helpers: `place`, `show`, `hide`, `closePinned` inside `notes.ts`, and `slug()` beside `note()` in `format.ts`
— five, all private, none reused elsewhere. Types: one optional `note?: string` field on `CongressColumn`; one
**optional** `notes?: { scope: string }` parameter on each note-capable shared renderer, `statTiles` included
(R2b — optional by design, so its six call sites and every out-of-scope route keep compiling and keep their
bytes); one required `scope` on `rankingHeadHtml`, `addsHeadHtml` and the `INST_INDEX_HEADS` mapper, which
have no out-of-scope consumers (R26b); one optional `onSettled` callback on `initFeed`'s options (R29) — no
new exported type, and **no change to any published payload shape**. CSS classes: `.note`, `.note-btn`,
`.note-pop`, `.np-h`, `.window-empty` for R14, and `.force-note-fallback` for R27's test seam — six. Edits to
files otherwise untouched: one early-return line in `table-sort.ts` (R25). Retired: `syncTerminusFor`,
`rankingCaveatHtml`, and **fifteen of the thirty-two `title=` channels** — 5 deleted as contained duplicates,
10 converted to notes, 17 retained and declared under R8c. No other file, component, function, type, class or
dependency is introduced, and no third-party package is added.

## Tech Debt Introduced

1. **A dynamic note body (R11/R12).** Owner: the congress surface. Impact: one note's content is live state,
   which is a weaker pattern than the static definitions every other note carries — a future contributor could
   reasonably assume all notes are static and skip the client rewrite. Removal condition: reverting LD4 puts
   the counts back on the page and makes every note static again.
2. **Scripted popover placement (R3).** Owner: `src/scripts/notes.ts`. Impact: ~25 lines of placement math
   that CSS anchor positioning will make redundant. Removal condition: when `anchor-name` /
   `position-anchor` is available across the supported engines, delete the placement function and keep the
   `popover` attribute.
3. **A reversed honesty invariant (R15/LD8).** Owner: `css-fold.test.ts` and the institutional surfaces.
   Impact: the §5 caveat's six clauses are hidden by default at every width, and the guard that forbade that
   has been replaced. The replacement is stronger, but the *property* the site ships is weaker than it was:
   the reader now gets one summary sentence by default instead of six clauses. Removal condition: the owner
   reversing LD8 — drop the `<details>` wrapper and restore the prior assertion; the clause markup is
   unchanged either way, so the reversal is a container edit and a test swap.
4. **Seventeen surviving sole-channel `title=` sites (R8c).** Owner: `holdings.ts` (10), `manager-directory.ts`
   (2), and the identity-free helpers `srcLinkInner`, `lagHtml` ×2 and `memberCellHtml`'s unjoined branch in
   `format.ts` (4) and `flowCellHtml` in `ui.ts` (1). Impact: this run's premise is that a tooltip is not a channel this site treats as published,
   and seventeen tooltips survive it — each one an explanation that is unreachable by touch, unstyled, and
   inconsistently announced. Accepted because their renderers hold no stable identity to key a note on, so
   converting them means adding a scope/key parameter to eight shared helpers and editing every caller: a
   signature refactor, not a presentation edit. Bounded rather than hidden: R8d's gate asserts exactly 17
   survivors by file and line, so the allowance cannot grow silently. Removal condition: a follow-up that
   threads a note context through those helpers, naturally bundled with the deferred filer-identity work in
   `docs/build/RUN-FILER-IDENTITY-notes.md`.
5. **Delegated note binding (R2).** Owner: `src/scripts/notes.ts`. Impact: one `document`-level listener set
   serves every note on the page, so a future root that stops propagation before `document` would silently
   break its notes. Chosen over a rebind hook because five roots replace their contents today with nothing
   preventing a sixth. Removal condition: none pending — this is the intended long-term shape; recorded so the
   coupling is known rather than discovered.

## Memory Touch-Points

| Memory | Effect on this plan |
|---|---|
| `design-handoff-honesty-fold` | Drove Constraint 1, LD3 and LD4: a mockup that looks cleaner because a caveat vanished is wrong, so every removal names its replacement channel and the one genuine §7 bend is recorded with its residual and its reversal. |
| `mockups-are-not-measurements` | Drove LD7 and the Current State section: every number here is cited to a live artifact, and the preview states that its numbers are measured while labelling its one illustrative frame. |
| `reversing-a-reviewed-decision` | Drove LD6 and T13: `.col-why` and the terminus encode reviewed decisions, so each assertion is retargeted with a comment naming the property it still protects — never edited to go green. |
| `verify-against-a-frozen-tree` | Drove T0 and T15: hash `dashboard/src` and `dashboard/test` before and after every gate run. |
| `reversing-a-reviewed-decision` | Drove R8's split into delete-the-duplicate and convert-to-a-note: `assetNameCell` and `statTiles` carry their text in a `.visually-hidden` sibling because a prior review ruled a tooltip may never be the only channel. Converting those to notes would have re-litigated that ruling; deleting the redundant `title=` honours it. |
| `plan-review-is-not-code-review` | Drove the Testing Strategy's mutation spot-check and the insistence on built-output assertions: plan rounds do not substitute for reading the emitted HTML. |
| `specify-before-rewriting` | Drove writing this artifact before touching the three header renderers, all of which have taken repeated review rounds. |
| `probe-dont-argue-from-silence` | Drove the measurement of the 7d window (0 rows) and the `popover` clipping test rather than reasoning about either. |
| `edit-by-anchor-not-by-slice` | Applies during implementation: replace a section by its own heading bounds, never by slicing between two anchors. |
| `orchestrate-worktree-isolation` | Drove T0's worktree at `<repo>/.claude/worktrees/surfaces-legibility` from `origin/main`. |
| `pages-25mib-filer-cap` | Drove the R21 deferral as much as any review finding: the identity map's byte cost on a page already truncating 45,466 of 50,651 rows was never a free presentation change, and three rounds of trying to bound it kept surfacing new transport questions. Carried into the carve-out notes. |
| `invariant-boundary-test-update-design-change` | Drove LD8 after round 1. R15 reverses a reviewed invariant; the assertion that encoded it is replaced with a stronger behavioural contract in the same commit, never left standing-but-blind. |
| `explicit-plan-contracts` | Drove R2's id rule and R26's key table: every note site's id derivation is fixed here rather than left to implementation-time judgement — the same principle that, applied to R21's payload, showed the contract was too large for this run. |
| `contract-interlocking-latent-bugs` | Drove F4/F5/F13's fixes: the note button interacts with `table-sort`'s `<th>` listener, with five `innerHTML` roots, and with the §5 box's two existing render sites — each a contract this run does not own but must not break. |
| `doc-drift-sweep` | Drove the round-2 pass over Current State, the Verification Matrix, Rollout and the DoD together: round 1 found the requirement text and its verification disagreeing in four places (R10's count, R13's mechanism, R20's channel, R22's ownership). |
| `fail-loud-exact-guards` | Drove the reading of `filer-payload.ts:490` that established R21 as a strict-contract change rather than an additive one — the finding that ultimately scoped it out. |
| `qa-fail-batch-remediation` | Drove this round's shape: all 18 blockers answered in one pass with a resolution map, then a single delta submission — never piecemeal. |

## Failure-Mode Sweep

| Catalog concern | Applies | Prevention / test |
|---|---|---|
| Silent scope reduction (a table shrinks without saying so) | yes | Success criterion 1; `test:post` counts columns; the eight standalone terminus rows are preserved by name (R10). |
| Honesty content suppressed at a breakpoint | yes | R24; `css-fold` forbids suppression of `.note-pop` and the allowlist is updated to the shipped markup. |
| A gate weakened to pass | yes | LD6; T13 retargets each assertion in the same commit, with a comment naming the requirement. |
| Server/client render divergence | yes | Existing parity tests kept unchanged; `applyRollup` rewrites text and note body together (R12); R2's note ids are deterministic and caller-keyed so SSR and client emit identical bytes. |
| Stale derived state after a control change | yes | R12 test; the note body is rewritten atomically with the rows and the window text. |
| Invented data presented as measured | yes | LD7; every figure cited to a live artifact in Current State; the preview labels its one illustrative frame. |
| Broken internal link shipped | yes | R23's `test:post` check resolves every `/methodology/#…` href against the built page — the check that would have caught `#coverage`. |
| A published contract dropped | yes | LD1; R15 preserves the id, the six clause ids, the classes and the print behaviour. |
| **A reviewed invariant reversed while its guard stays green** | **yes** | The sharpest risk in this run. `css-fold.test.ts:1157` asserts the §5 note "may never fold", and — verified — would **not** have caught R15's collapse, because `droppedAt` matches project CSS rules while a `<details>` collapse is a user-agent default. LD8 replaces the assertion with a behavioural contract in the same commit as the change, and T13 audits that no retired assertion lacks a stronger replacement. |
| **A test that cannot observe the property it names** | **yes** | Generalized from the above: every assertion this run *retires* is checked for whether it could have failed on the change that retired it, and the replacement asserts a rendered behaviour (reachability, layout box, exact text) rather than the presence of a CSS rule or an element. This is why R2/R3/R4 gained no-JS, print-media and delegation tests. |
| **A dynamically rendered element left inert** | **yes** | Five roots replace their contents by `innerHTML` after page setup. R2 binds by delegation, and the DOM tests exercise a note created by a sort repaint, entity pagination, an institutional period change and a filer period change. |
| **A guard placed where event order defeats it** | **yes** | Round 2's sharpest catch: `stopPropagation()` in a delegated `document` handler runs after the `<th>`'s own listener, and moving it to the capture phase breaks `popovertarget`. R25 puts the guard where ordering is unambiguous, and the test asserts both halves — the table does not sort **and** the note still opens — so a fix that silences one by breaking the other fails. |
| **A cleanup path that only runs on success** | **yes** | R29: `feed-client.ts:106` fires `onRows` on successful decode only, so any state cleared solely there survives a failed load forever. The pending indicator clears on a settled callback covering both paths, tested on both. |
| **A test seam the gate's only engine cannot reach** | **yes** | R27: the gate runs Chromium alone, which supports `popover`, so the `@supports not` fallback is unreachable by the browser tests. The seam is forced by a root class whose declarations are asserted byte-identical to the real fallback's, so the seam cannot drift from what it stands for. |
| **Two authoritative documents disagreeing** | **yes** | T14: the design rationale still said "one note on the Kind header" after R20 changed to per-Kind-cell. Documentation reconciliation is an owned task that runs before handoff, and its completion grep must return empty. |
| **A duplicated singleton id** | **yes** | R22 keeps the §5 box's two existing render sites rather than relocating it into `filerBody`; `test:post` asserts exactly one `id="inst-data-note"` and one instance of each clause per built page. |
| Payload / byte-budget regression | no | Nothing is added to any payload. The note markup this run emits is server-rendered HTML on pages already within budget, and the one payload change that would have mattered left with R21. |
| Half-written tree measured as green | yes | T0/T15 frozen-tree hashes. |
| Dead CSS selector (a rule matching no DOM) | yes | R5, R10 and R11 delete markup: `.col-why` and the ranking `.caveat-line` rules are removed from `global.css` in the same task, and `a5-table-css.test.ts` asserts every selector it names still matches emitted markup. |
| Stale comment after moving code | yes | `.col-why`'s comment in `global.css` and `rankingHeadHtml`'s "a tooltip is not a channel this site treats as published" comment both assert the opposite of what this run does; both are rewritten in T3/T12, not left contradicting the code. |
| A test that passes if the feature is removed | yes | Each new assertion is mutation-checked (Testing Strategy); the note tests assert panel *content and reachability*, not merely that a `.note` element exists. |
| Secret or credential exposure | no | No auth, no network calls, no environment reads are added. |
| Destructive or production write | no | No commit, push or deploy in this run; no producer or database write. |
| Migration / schema change | no | No schema is altered and no query is added or changed. |
| Cross-machine state | no | Single checkout, single build. |
| Public API change | no | True unconditionally now that R21 is deferred. Plan-v1 asserted this while R21 was in scope, which was **false** — round 1 established that `filer-payload.ts:490`'s `onlyKeys(raw, PAYLOAD_KEYS, "")` hard-fails on any undeclared key, making the identity map a versioned contract change. Round 3 then found it also breaks a cross-runtime byte-parity fixture. Both facts are recorded in the carve-out notes as scope the successor run must carry. |

## Definition of Done

1. **R1** — `/congress/` head shows the stamp line and four working deep links; no caveat paragraph.
2. **R2/R2b** — `note()` exists in `format.ts`, is unit-tested, and is the only explanation primitive on the
   five surfaces; every note-capable renderer called without a scope is byte-identical to baseline; its ids are deterministic and unique; it opens with scripting disabled; it does not sort a
   sortable header; and a note created by a later `innerHTML` replacement works.
3. **R3** — a note opens fully in-viewport from the last column of a horizontally scrolled table; the
   `@supports` fallback opens on hover and focus in a browser with no script running.
4. **R4** — under emulated print media every panel's text has a non-zero layout box and the anchor is hidden;
   asserted by rendering, with `css-fold` retained as the cheap stylesheet check.
5. **R5** — `class="col-why"` appears in no built page and in no source file.
6. **R6** — the ranking `.section-note` paragraph and its `footnoteBlock` are gone; `§`, `≈`, `†` are notes.
7. **R7/R7b/R7c** — all five `footnoteBlock` calls are gone from SSR and client paths; each of the 16 marks is
   a header note on the column R7c maps it to; the three key-less tables use the fixed descriptors and the
   holders table's ids are stable across a period switch; every former `.fn-ref` marker link is retargeted;
   and no built page references a deleted footnote id — including `/institutional/tickers/[t]/holders/`.
8. **R8/R8b/R8c/R8d/R8e** — `activity.ts:722` is absent from every deletion list and keeps both of its
   strings; the aggregate inventory gate prints 32 before and 17 after; the 5 / 10 / 17 partition
   sums to 32 exactly; the **five** Class-A `.visually-hidden` siblings are byte-identical to baseline, each with its containment proven rather than assumed; each of the
   ten Class-B sites carries a note holding its former attribute text verbatim; and the 17 Class-C survivors
   match their file-and-line list by name.
9. **R9** — no built `.panel-note` contains `build `; the footer still does.
10. **R10** — of 13 call sites, five removed and the eight named standalone sites kept, asserted as an exact
    partition; `syncTerminusFor` deleted with no dangling caller.
11. **R11** — no `-caveat` root; the window statement carries the visible **excluded-row total**, equal to the
    sum of the note body's clause counts; the note body equals `rankingExclusions()`.
12. **R12** — a range change rewrites the window note body, the visible excluded-row total and the window text
    together, proven by test.
13. **R13** — a pre-arrival range click **and** a pre-arrival basis click each show the pending indicator until
    `receiveRows` clears it, with the selection applied by the existing mechanism and no queue added.
14. **R14** — `7d · traded` renders the stated empty-window block with both alternative counts and working
    switches; `12m` renders it without a wider-range clause; a doubly-empty window states so and offers no
    switch.
15. **R15** — every built institutional page carries the collapsed box exactly once, with its id, six clause
    ids and print-open behaviour intact, and a `<summary>` carrying its required substantive claim; the LD8
    replacement assertion is in place and the retired never-fold assertion is gone.
16. **R16** — one `.control-row` holds both adds chip groups; the client still binds them.
17. **R17** — no raw identity key is visible text on any built page except the one named, deferred exemption
    (the filer position-changes table); each weak identity carries a chip and a note; the key survives in a
    `data-` attribute; and a companion assertion proves no other surface claims the exemption.
18. **R18** — the curated-typing caveat is a Type-column note carrying its `N of M`.
19. **R19** — the member head has no caveat paragraph; stamp line, Owner column and five tiles carry notes.
20. **R20** — asset cells, chart caption and net-flow foot carry notes; each row's Kind cell carries that
    kind's exact rule string, proven on a mixed-kind fixture, and is keyed on `Signal.id` so a duplicate-kind
    fixture emits no duplicate panel id; the absent panels and `NON_ALLEGATION_CAVEAT`
    are byte-identical to baseline.
21. **R22** — the filer page **keeps** its `.explainer` `#inst-data-note` pointer and gains the methodology
    deep link; exactly one `id="inst-data-note"` and one instance of each clause on the built page; six tile
    notes; one period control row; truncation notice and pager intact. Its position-changes table is
    unchanged and still renders the raw `position_key` — deferred with R21, deliberately, not overlooked.
22. **R23** — six anchors exist, each carrying its required substantive text with its source named in T1's
    commit, and every `/methodology/#…` href in the built output resolves.
23. **R24** — `.note-pop` is never suppressed at any swept width, the anchor is ≥44px at **every** swept width,
    and the fold allowlist matches the shipped markup including `.note-pop`, `.note-btn` and the LD8 summary
    class.
24. **Gates** — `make test` and `make security` (or `make check`) are green, run as the repository defines
    them so that `npm ci` and `geometry:install` are included, on a frozen tree whose hashes taken immediately
    before the first command and immediately after the last match, with the gate output recorded.
25. **R25** — the sort guard lives in `table-sort.ts` and a header note neither sorts the table nor fails to
    open.
26. **R26** — every note site passes the key this plan names it, and no counter, ordinal, timestamp or
    `Math.random()` exists anywhere in the implementation.
26b. **R26b** — every note-bearing renderer takes a `scope`; the ranked and undisclosed ranking headers pass
    distinct scopes; a both-tables fixture proves page-wide id uniqueness.
27. **R27** — the forced-fallback seam is declaration-identical to the `@supports` block and opens on hover
    and focus with scripting disabled.
28. **R28** — all **five** surfaces call `initNotes()` at their named sites; a built page proves scripted hover
    and placement without the test importing `initNotes()`; the holders page works after a period repaint; and
    no out-of-scope route emits `.note` markup.
29. **R29** — the pending indicator clears on the feed's failure path as well as its success path.
30. **T14** — the design rationale, the preview and `BACKLOG.md` agree with every locked decision this review
    changed, and a grep for the retired phrasings over all three returns empty.
31. **T0 inputs** — either **all six** authoritative inputs are on `origin/main` before implementation began,
    or their
    `shasum -a 256` digests were recorded in both the main checkout and the worktree and matched byte-for-byte
    (T0.a).
32. **LD6 propagation** — T13's audit found every sweep hit already handled by the task that invalidated it,
    no assertion widened rather than retargeted, and no retired assertion left without a stronger replacement.
