# SURFACES-LEGIBILITY — plan

**Goal.** Make the four reader-facing surfaces read cleanly without thinning the tables. Desktop tables stay
full-fat; the prose that currently sits above, beside, below and *inside* them moves into hover notes anchored
on the thing it explains, or into the methodology page behind a deep link. The narrow viewport is where the
table itself simplifies.

**Surfaces in scope:** `/congress/` · `/institutional/` · `/congress/members/[bioguide]/` ·
`/institutional/filers/[cik]/`.

**Preview:** `docs/design/handoff/Surfaces Legibility.dc.html` — 54 live notes, every number read from the
live build (see §2), one labelled exception.

---

## 0 · Baseline and provenance

| | |
|---|---|
| Live build | `20260823.1`, `code_sha b4787ff845e8f9e8f6104078d5998ce852257516` |
| That commit | `b4787ff feat(surfaces): one-page congress and institutional overhaul (ALPHA-SURFACES-V2) (#55)` |
| `origin/main` | at `b4787ff` |
| **local `main`** | **at `20e2577` — behind, and does NOT contain the deployed surfaces** |

**Precondition.** The working checkout does not have the code this plan edits. **Fetch, never pull** —
corrected 2026-08-24 after plan review: local `main` and `origin/main` are *divergent* (`1 ahead, 1 behind`,
neither an ancestor of the other) and the checkout is dirty, so `git pull` would attempt a merge in the
owner's working tree. Run `git fetch --prune origin`, record `git rev-parse origin/main` as the baseline, and
cut the worktree from that SHA. Local `main` is never updated, merged, rebased or checked out. Per the
worktree rule that worktree is `<repo>/.claude/worktrees/surfaces-legibility`, branched from the recorded
`origin/main` SHA, never from local HEAD.

---

## 1 · The requests, mapped

| # | Request | Verdict | § |
|---|---|---|---|
| R1 | Remove the 3-line caveat block under the congress lede | Relocate to the columns + methodology | §4.1 |
| R2 | The 7d button "defaults to previous shown or doesn't show anything" | **Two real bugs, reproduced and measured** | §5 |
| R3 | Any description/information in a table becomes a hover box | One `note()` primitive, three channels | §3 |
| R4 | Remove `build 20260823.1` | Yes — already in the site footer | §4.4 |
| R5 | Delete the terminus row on the ranking tables | Yes — it duplicated the expand button | §4.5 |
| R6 | Delete the exclusion count line (72 / 212 / 1,412) | Yes — counts move into the window note | §4.6 |
| R7 | Delete the "Notes on this table" blocks | Yes — hover plus a print rule replaces them | §3.2 |
| R8 | Remove the "What a 13F is — and is not" box | **Collapse, not remove — it is a gated contract** | §6.1 |
| R9 | Period chips and mode chips in one row | Yes | §6.2 |
| R10 | Don't show `sid:sec:prov:…` / `cusip6:464287` | Readable identity chip; raw key on hover | §6.3 |
| R11 | Same update on the individual member page | Yes — and it carries the most prose of any surface | §7 |
| R12 | Same update on the individual filer page | Yes — and it contains the worst defect on the site | §8 |

---

## 2 · Measurements (2026-08-23, live build)

`/congress/data/feed.v1.json`, 71,632 txn rows, payload **22 MB**:

| Range | rows, **traded** basis | rows, **filed** basis | distinct tickers (traded) |
|---|---|---|---|
| 7d | **0** | 58 | **0** (28 on filed) |
| 30d | 123 | 585 | 64 |
| 90d | 947 | 2,338 | 260 |
| 12m | 6,248 | 7,626 | 996 |

Also live: 72 date-anomaly rows (furthest impossible trade date `3031-04-30`), 212 rows with no trade date,
1,412 in-window rows with no ticker, 981 further ranked tickers held back, 118 further ranked members held
back, 1 wholly-undisclosed member, 9,451 filers in the manager directory, a 2,000-row adds bound whose first
omitted issuer is `$20.9M across 50 managers`. Member `S001229`: 12 filings, 636 transactions, `$69M–$345M`
trailing-12m flow, `+37d` median lag, 2 late, 77 rows with no ticker. Filer `CIK 0002012383`: `$5.7T` reported
value, 50,651 positions, 0 null-value, 38.6% top-N share, 117 HHI bps, 5,532 QoQ moves, 45,466 rows not
embedded, 5,185 positions paged 100 at a time over 52 pages.

---

## 3 · The `note()` primitive

### 3.1 The editorial line

- **A definition hovers.** What a column means, how a number is computed, why a column cannot be sorted, what
  a marker asserts, what an asset string says. These never change when the reader moves a control.
- **A live control state stays on the page.** "Show all 991 tickers (981 more)"; "4 rows disclose no amount
  for this column". These are the label of a control or a row inside the table — the table describing its own
  current state, not prose about the data.
- **Owner decision, stated:** the *exclusion counts* (72 / 212 / 1,412) are counts, and by the rule above they
  would stay visible. The owner directed that they be removed from the page surface (R6). They move into the
  window note (§4.6). **Consequence, named:** a reader who never hovers never sees them. They remain in the
  DOM, in the print output, and in the published JSON.

### 3.2 Contract

`note(text, opts)` in `src/lib/format.ts`:

```html
<span class="note">
  <button class="note-btn" type="button" aria-expanded="false" aria-describedby="n-7">i</button>
  <span class="note-pop" popover role="tooltip" id="n-7"><span class="np-h">how net is computed</span>…</span>
</span>
```

Three channels, one source string:

1. **hover** (mouse) — `mouseenter` on `.note`
2. **click-pin** (touch) and **focus** (keyboard) — `aria-expanded` toggles; Escape and outside-click close
3. **print** — `@media print` lays every `.note-pop` out in flow beneath its anchor and hides the button

R7 removes the fourth channel (the per-table `<details>` block). The print rule is what keeps paper honest
once it is gone, and the `@supports` fallback (below) is what keeps CSS-only hover working without JS.

### 3.3 Two implementation findings, both measured

- **Top layer is mandatory.** An absolutely positioned panel inside `.table-scroll { overflow-x: auto }` is
  **clipped by the scroll container**; the last column's note was unreachable. The panel uses the `popover`
  attribute (top layer) with JS placement, plus an `@supports not selector(:popover-open)` fallback to the
  absolute path. Verified in the preview: **54/54** notes open fully inside the viewport.
- **`title=` is not the mechanism — and is already the status quo in five places.** `statTiles`
  (`format.ts:1294`), `assetCellHtml` (`format.ts:265`), `addsRowHtml` (2 sites) and `inst-index.ts:201`
  already put real explanation in a bare `title=`, which no touch device can open and which is unstyled.
  Converting them is a strict upgrade, not a regression.

### 3.4 What replaces what

| Today | Becomes |
|---|---|
| `<span class="col-why">` in every unsortable `<th>` | a note on that `<th>` |
| `<p class="section-note">Every flow number is an interval…</p>` | notes on the three flow headers |
| `footnoteBlock(RANKING_FOOTNOTES)` — the `§ ≈ †` stack | notes on Net / ≈ / Txns · Late |
| `footnoteBlock(ADDS_FOOTNOTES)` — `‡ § †` | notes on Δ value / Issuer / Top adder |
| `footnoteBlock(QOQ_FOOTNOTES)` + the filer's `§ †u ‡a ‡c` | notes on Position / Change / Δ value |
| `title=` on tiles, asset cells, partial sums, null adders | notes |
| `.mtile-sub` / `StatTile.title` on 11 tiles across two pages | notes |
| `.rb-caption` (the quarter chart's caption) | a note on the chart's panel note |
| `.card-foot` ("PTRs are flows, not holdings…") | a note on the net-flow panel note |
| `signalRowHtml`'s per-row rule string | a note on **each row's Kind cell**, keyed by kind (revised 2026-08-24 after plan review: `signals.ts` composes one rule **per kind**, so a mixed-kind table carries several distinct rules and a single shared header note cannot hold them all) |
| `.terminus` **where a `compactDisclosure` sits beside it** | **deleted** (§4.5) |
| `.terminus` **where nothing else states the bound** | **kept** (§8.4) |
| `rankingCaveatHtml`'s visible `.caveat-line` | folded into the window note (§4.6) |
| `.compact-disclosure`, `.unranked-sep` | unchanged, visible |

---

## 4 · `/congress/`

### 4.1 Page head (R1)
Drop the `.caveat-line` paragraph. Its content relocates: "statutory ranges, not exact values" → notes on
Gross purchases / Gross sales / Net; "filed up to 45 days after the trade" → notes on Dates and Late; "parse
coverage" → the link line. What stays is the stamp `71,632 rows · filed since 2014 · as of 2026-08-23 21:13
UTC`, then four **deep** methodology links.

> **Bug found in passing:** the current link is `/methodology/#coverage` and **no element on the methodology
> page has that id** — it lands at the top. See §9.

### 4.2 Ranking sections (R3)
Nine columns unchanged. Headers gain notes per §3.4. Range and Dates keep their one `.range-control` row, plus
a note explaining traded vs filed.

### 4.3 The unrankable bucket
Its heading keeps a note. The separate table and separate render root stay — an R6/R18 invariant, not styling.

### 4.4 Build id (R4)
Remove `· build <id>` from every `.panel-head` `.panel-note` (`congressRankingSection`, `addsSectionHtml`,
`filerPeriodSectionHtml`, the member page's table stamp). It renders once in `.footer-build` already. The
**window** statement stays — it changes with the control, so it belongs beside the control. Delete the
`" · build "` string-split in `applyRollup()` (`congress-sections.ts:276`) with it.

### 4.5 Delete the terminus rows (R5) — scoped precisely
`terminusRow` has **12 call sites**. Five sit directly beside a `compactDisclosure`, whose button already
states the same count — those five are the duplicates and are deleted:

| Site | Paired disclosure |
|---|---|
| `ui.ts:1773` (ranking, ranked root) | `ui.ts:1781` |
| `ui.ts:1792` (ranking, undisclosed bucket) | `ui.ts:1797` |
| `ui.ts:1966` (adds leaderboard) | `ui.ts:1978` |
| `activity.ts:989` (activity feed) | `activity.ts:1013` |
| `institutional/index.astro:168` (manager directory) | `:176` |

The other **seven** (`ui.ts:579`, `:936`, `:1104`, `:1168`, `:2377`, `holdings.ts:1287`, `:1514`) have no
expand button; there the terminus is the only statement of the bound and it **stays**. `terminusRow` therefore
survives in `format.ts` for them.

`syncTerminusFor` loses all three of its callers (`congress-sections.ts:226`, `inst-index-client.ts:110`,
`:241`) and is **deleted**. The disclosure button's own text is already recomputed on every render by
`syncDisclosure()`, so the live count survives.

### 4.6 Delete the exclusion line (R6)
Delete the visible `<div class="caveat-line" id="…-caveat">` and its render root. `rankingExclusions()` is
**kept** — its strings now compose the body of the note on the window statement. That note therefore carries
**live counts**, so:

- the client must rewrite the note body whenever it rewrites `#{sectionId}-window` (`applyRollup`, which
  already rewrites that element — one more line, same function);
- a test must assert that a range change updates the note body, not just the window text. A stale count inside
  a hover is worse than a stale count on the page, because nobody sees it go wrong.

### 4.7 Delete the per-table notes block (R7)
Never shipped; it exists only in the preview. Its job passes to the print rule in §3.2.

---

## 5 · The 7d bug (R2) — two defects

### 5.1 Defect A — a click before the data lands is silently dropped
`recomputeMomentum()` opens `if (!allRows) return;`. The payload is 22 MB. A click in the first seconds sets
`aria-pressed="true"` on 7d and changes nothing: the control claims a window it did not apply.

**Fix.** Record `pendingRange` / `pendingBasis`, render a pending line on the control, and apply the queued
selection in `receiveRows()`. `recomputeMomentumIfChanged()` already compares against the SSR defaults, so
this extends a path that exists rather than adding one.

### 5.2 Defect B — 7d on the traded basis is structurally empty, and says nothing
**0 of 71,632** rows have a trade date in the last 7 days. `rankingRootHtml([])` returns an empty string, so
the `<tbody>` paints empty with no sentence.

**Fix.** An empty-window state on the ranking root, stating the fact and offering the windows that have rows:

> **No trade dates fall in the last 7 days.** PTRs are filed up to 45 days after the trade, so a 7-day
> **trade-date** window is usually empty — that is the statutory lag, not an absence of data. **58 rows across
> 28 tickers** were **filed** in these same 7 days.
> `[ Switch to filed dates (58 rows) → ]` `[ Widen to 30d traded (123 rows) → ]`

Both counts come from the rows in hand, so the offer cannot promise rows that are not there. **7d stays
offered** — that the window is empty is a true fact about the corpus, and removing the button would hide it.

---

## 6 · `/institutional/`

### 6.1 The 13F box (R8) — collapse, do not delete
**This cannot be done as asked, for a mechanical reason.** The six clauses are the **M2-CONTRACT §5 / R16**
structural caveat:

- pinned clause-for-clause to `populus.normalize_inst.INST_DATA_NOTE` by `test/activity.test.ts:609`
- `test/post/fixture-preview.test.ts:188-198` asserts `data-inst-data-note` **and every
  `data-note-clause="<id>"`** on every built institutional page
- `test/css-fold.test.ts:1130-1168` asserts it loses no content at any breakpoint, clause by clause, and prints
- rendered on three surfaces: this page, `HoldingsTable.astro:246`, `entity-client.ts:480`

Deleting it reddens three gates and drops a published contract. Instead: **same six clauses, same ids, same
`.caveat-line` classes, same DOM**, wrapped in `<details class="caveat-box">` whose `<summary>` carries the
gist and the deep methodology link. ~400px becomes ~40px. `<details>` is already this repo's disclosure idiom
(`<details class="flag">`, `.flag-provenance`), and the print block forces it open the same way.

### 6.2 One control row (R9)
`addsSectionHtml` emits two sibling `<div class="mgr-chips">`, so they stack. Wrap both in one `.control-row`
with visible `Quarter` / `Count` labels, mirroring `.range-control`. The `data-adds-period` /
`data-adds-mode` attributes stay put, so `initAddsControls()` is unaffected.

### 6.3 No raw keys (R10)

| `issuer_key_source` | today | proposed |
|---|---|---|
| `entity` | `entity:…` printed | **no chip** — the strong case needs no caveat |
| `cusip6` | `cusip6:464287` | `cusip-6 only` chip; raw key in its note |
| `name` | `name:<norm>` | `name match only` chip; raw key in its note |
| provisional `sid:sec:prov:…` | 32-hex hash | `provisional id` chip; raw key in its note |

The raw key stays on the row as `data-issuer-key` / `data-position-key` and in the published JSON. Reuse the
existing label vocabulary in `format.ts:368` (`issuer_from_cusip6`) rather than inventing a second one. The
`§` footnote's identity-ladder text becomes the Issuer header's note.

### 6.4 The chips caveat
The `.caveat-line` above the manager directory ("Manager type and display name come from a curated registry
covering **N of M** filers…") folds into a note on the **Type** column. The `N of M` count travels with it —
same owner decision and same consequence as §3.1.

---

## 7 · `/congress/members/[bioguide]/` (R11)

The heaviest prose on the site. Beyond the shared work in §3.4:

- **7.1 The identity lede.** `ui.ts:450` prints a 3-line paragraph about SP/DC/JT ownership. It becomes a note
  on the stamp line **and** a note on the `Side · Owner` column, where it bites.
- **7.2 Five stat tiles.** `memberStatTiles` (`ui.ts:349`) already carries its explanations in
  `StatTile.title` — i.e. hover-only via a bare `title=`. They become notes: styled, tappable, printable.
- **7.3 The per-row asset expansion.** `assetCellHtml` (`format.ts:265`) prints a full sentence per row —
  *"… [CS] — asset type as filed: CS — asset as filed, no ticker disclosed"* — on **636 rows** for this
  member. It becomes one note per row, so the cell shows the truncated name and the full string is one hover
  away. Biggest single legibility win on the page.
- **7.4 The chart caption.** `.rb-caption` (`ui.ts:203`) — "gaps are gaps — no interpolation · y from $0 · no
  midpoints · 2 exchange/unparsed-side rows excluded · source: …" — becomes a note on the chart's panel note.
  The excluded count travels with it (§3.1).
- **7.5 The net-flow card foot.** `ui.ts:2130` — "PTRs are flows, not holdings … 77 rows disclose no ticker
  and are outside this table" — becomes a note on that panel.
- **7.6 The signal rule.** `signals.ts:310` composes the rule string and it renders on **every** signal row.
  One note on the `Kind` header replaces N copies; the "a signal describes a disclosure, never a current
  holding" caveat and the superseded count join it.
- **7.7 Kept verbatim.** The *Sector mix* and *Committees* absent panels. Each states an absence — "not in
  this build; it lands with the first build after the issuer-SIC ingest (B-5)" — and that sentence **is** the
  section's whole content. There is nothing to hover it behind. `NON_ALLEGATION_CAVEAT` likewise stays visible.

---

## 8 · `/institutional/filers/[cik]/` (R12)

### 8.1 The worst defect on the site
The position-changes table renders a bare 32-character hash as its entire identity column. Live, on BlackRock,
across 5,532 moves: `sid:sec:prov:00076fbdb7a2ddaf78c0e89001ecf4f7 · exit · −$631M`. Not one issuer name. The
holdings table further down **the same page** prints `MICROSOFT CORP · COM · CUSIP 594918104`.

### 8.2 Cause, and the fix
`changesTableHtml` takes `QoqDeltaRow`, selected from `agg_qoq_deltas`, which **has no `issuer_name` column**
(`inst.ts:171-186`). The filer's own reported rows do: `serving_filer_rows` carries
`(security_id, cusip, issuer_name, position_key)` keyed by the **same** `position_key`
(`inst_serving.py:679`). So this is a local join over data the page already loads — **no producer change**.

**The trap.** An *exit* is by definition absent from the current quarter's rows. Joining only the current
period would leave every exit unresolved — which is most of this table. The join must run over the **union of
the previous and current period's** rows for that filer.

**The fallback.** Where neither period names the security, the cell reads `unresolved security` with a
`provisional id` chip whose note carries the raw key. No name is invented. The preview shows both states, and
its issuer names are labelled in place as illustrative of the join rather than resolved.

**Parity.** `filer-payload.ts:173` builds the client payload and selects `position_key`; it must carry the
resolved name too, or a period switch re-renders rows that disagree with the server's.

### 8.3 The rest
- **8.3.1** The `.explainer` pointer ("A quarter-end snapshot. Filed up to 45 days later, so this page is not
  current holdings…") is replaced by the collapsed box of §6.1 plus the deep link. `ui.ts:1221` already
  documents that this text was reduced from a duplicate phrasing to a pointer; this finishes that move.
- **8.3.2** Six stat tiles (`filerTiles`, `ui.ts:931`) → notes, as §7.2.
- **8.3.3** The `§ †u ‡a ‡c` footnote block → notes on Position / Change / Δ value.
- **8.3.4** "every row this filer reported for the quarter, as it reported it — cross-filer de-duplication…"
  (`holdings.ts:1332`) → a note on the holdings panel.
- **8.3.5** Period chips → one labelled `.control-row`, as §6.2.

### 8.4 What stays
The truncation notice — *"45,466 of this filer's 50,651 reported rows for 2026-03-31 are not embedded in this
page — the page byte budget caps the embed"* — is a `terminusRow` with **no expand button beside it** (the
table is behind a pager). It names a bound nothing else on the page states, so by the §4.5 rule it stays. So
does the pager's `1–100 of 5,185 positions · page 1 of 52`.

---

## 9 · Methodology anchors (prerequisite for every deep link)

The page has only `#m1`, `#defaults`, `#m2`, `#m3m4`, `#publication`, `#privacy`. Add:

| Anchor | Lands on | Linked from |
|---|---|---|
| `#coverage` | M1 sources & conditions / parse coverage | congress head — **currently broken** |
| `#amount-ranges` | statutory ranges, open-ended Senate buckets | congress head, member page, Amount notes |
| `#filing-lag` | the 45-day rule and both dates | congress head, Dates and Late notes |
| `#owner-codes` | SP / DC / JT and what they do not say | member page, Owner note |
| `#13f-scope` | long-only, $100M threshold, not a census | institutional head, filer head, both boxes |
| `#13f-identity` | entity / CUSIP-6 / name key ladder | the identity chips' notes |

Content comes from text that already exists (the M2 standing caveat, the `§` footnote, `ui.ts:450`). No new
claims are authored.

---

## 10 · Mobile (≤720px)

Desktop stays full-fat; mobile is where the table simplifies to the stacked card. A hover means nothing on
touch, so there the `i` is a **44px pinnable button** and the panel opens full-width beneath it — same DOM,
same text, a tap instead of a hover. `.note-pop` must never be given `display:none` or `visibility:hidden`; it
is opacity- and top-layer-driven, which keeps the fold guard honest rather than merely quiet.

---

## 11 · What this plan refuses to do

1. **Delete the 13F box** (§6.1) — gated contract. Collapsed instead.
2. **Delete every terminus** (§4.5) — only the five that duplicate an adjacent expand button. Seven stay.
3. **Remove the 7d button** (§5.2) — an empty window is a fact worth stating.
4. **Thin the desktop tables** — the request was legibility, not fewer columns.
5. **Invent an issuer name** (§8.2) — an unresolvable security says so.
6. **Silently loosen a gate** (§12) — every assertion this plan invalidates is retargeted or retired with a
   stated reason, in the same commit as the change that invalidated it.

---

## 12 · Gate impact — deliberate, not incidental

Each of these asserts on markup this plan removes. None may be weakened by widening a regex.

| Assertion | Today | Action |
|---|---|---|
| `c4-rankings.test.ts:183` | literal `<span class="col-why">the rank number…` | retarget to the note's DOM |
| `r-codex-regressions.test.ts:178` | same literal | retarget |
| `r5-feed-table.test.ts:140,159` | counts `.col-why` == `FEED_COLUMNS.length - 1` | count notes instead |
| `r19-collapsed-honesty.test.ts:112,165` | `.col-why`, `.terminus`, `caveat-line` present | retire the two deleted selectors **with a comment naming R5/R6 and this plan**; keep `.compact-disclosure` and `.unranked-sep` |
| `css-fold.test.ts:267,292` | `.terminus`, `.caveat-line`, `.col-why` in `HONESTY_SELECTORS` | drop `.terminus`/`.col-why`; **keep `.caveat-line`** (the 13F box still uses it); add `.note-pop` |
| `css-fold.test.ts:668` | `.terminus` in the fold sweep | drop |
| `css-fold.test.ts:1166` | print block includes `.caveat-line` | keep; add `.note-pop` |
| `activity.test.ts:679-682` | `.caveat-line` count == clause count | **unaffected** — the 13F box keeps its six |
| `post/fixture-preview.test.ts:70` | header carries no second 13F phrasing | still true after §8.3.1 |
| `a5-table-css.test.ts`, `geometry/*.spec.ts` | header geometry | re-measure: `.col-why` leaving the `<th>` shortens every ranking header |

**New tests worth having.** (a) every note emits `aria-describedby` and resolves to a populated panel; (b) a
range change rewrites the window note's body, not only the window text (§4.6); (c) the empty-window state
renders whenever a rollup has zero rankable rows; (d) a queued range applies on `receiveRows`; (e) the
`position_key` join resolves over the previous **and** current period, with an exit-only fixture; (f) no
surface renders a bare `sid:sec:prov:` or `cusip6:` token in visible text.

---

## 13 · Sequencing

1. Pull `origin/main`; cut the worktree; add the six methodology anchors (§9) — everything links to them.
2. `note()` + CSS + the print rule + the `@supports` fallback. Convert `.col-why` and the five `title=` sites.
   Migrate the §12 assertions in the same commit.
3. Congress: page head, build id, notes, **delete** the terminus and the exclusion line, fold the counts into
   the window note.
4. The two 7d defects (§5) — independent of the cosmetic work, and the only reader-visible *bugs* here.
5. Institutional index: collapse the box, merge the control row, identity chips, notes.
6. Member page (§7).
7. Filer page (§8) — the `position_key` join last, because it is the only item touching a data path.
8. Mobile pass; `css-fold` / geometry / `test:post` against a **frozen tree** (hash before and after, per the
   verify-against-a-frozen-tree rule).
