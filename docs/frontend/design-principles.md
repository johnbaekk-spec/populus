# Design principles — the public dashboard

The durable design contract for publicfilings.org. Consolidated from the two
original design briefs (`DESIGN-BRIEF.md`, `docs/build/P3-DESIGN-BRIEF.md`),
the UX-overhaul and surfaces-legibility design decisions, and the mobile-fold
rules previously carried by the design mockups (`docs/design/handoff/*.dc.html`)
— all of which now live in Git history. **This document is the stated authority
those artifacts used to hold**: the stylesheets under `dashboard/src/styles/` (nine region files
imported by `Base.astro`, whose import list is the single source of cascade
order) and
`dashboard/test/css-fold.test.ts` cite it as the spec source for the fold and
token rules below. Future module surfaces are critiqued against this page.

## 1. The product truth the design must express

Every number on this site is wrong in a specific, knowable way, and the
product's entire value is telling you how. Honesty and provenance are the
brand, not compliance chrome. These are first-class, designed UI citizens:

- **Dual dates on every trade row.** A transaction date and a filed date up to
  45 days apart. Both always show; the lag is legible at a glance; late
  filings are visibly flagged. Never present filed as traded.
- **Amounts are ranges, not numbers.** Statutory buckets render as ranges —
  no fake point precision, no midpoint bars pretending to be values.
  Open-ended and unparsed ranges render as hatch, never a solid bar.
- **Provenance on every row.** Every fact links to the government document it
  came from — unobtrusive but ubiquitous. Only `https://` provenance URLs
  render as live links.
- **Published imperfection.** Coverage %, parse failures, unjoined names,
  needs-OCR filings, freshness timestamps — shown, not hidden, styled as the
  trust signals they are.
- **Estimates and truncations labeled.** Flow-derived views carry an estimate
  label; a truncated ranking names the real author of the cut; an
  unclassifiable change is neither "add" nor "trim" and says so.
- **Required notices** (5 U.S.C. § 13107(c) prohibited-uses text, source
  attributions, "not financial advice", the build ID) have fixed placements.
  Amended 2026-09-29 (SIGNALS-CLARITY M1; record:
  `docs/design/SIGNALS-CLARITY-DECISIONS.md`): the **footer** carries, on every
  page, one notice sentence — the §13107(c) prohibited uses and "not financial
  advice", or the 13F caveat on the three 13F pages — and links to
  **methodology**, which carries the full prohibited-uses text and attributions
  (`#notices`), the sources and their conditions (`#sources`), and the build
  watermark `build <id> · code <sha7>`, once. The footer sentence is honesty
  copy: no width hides it. Dignified, not cookie-banner-ugly.

The negative form, which is a phase gate and a test: **if a mockup or a
refactor looks cleaner because a caveat disappeared, it is wrong.** No
honesty element may be softened, shrunk, or buried to "clean up" the UI.

## 2. Tone and references

Institutional civic-data: court-record gravitas with modern data-product
ergonomics. Reference the density of a terminal, the typographic rigor of a
broadsheet data desk, the provenance ethic of a scientific instrument readout.
Not consumer fintech: no gradients-and-glow, no gamification, no buy/sell
affordances, no recommendation framing. Party affiliation (D/R/I) renders
neutrally and accessibly — the site never reads red-team/blue-team. Congress
framing is "disclosed trading," never a portfolio; nothing claims to know a
congressional balance.

## 3. The uncertainty grammar

One reusable visual grammar for "how much should I trust this number?",
applied consistently to a dollar range, a stale filing date, a truncated
ranking, an inferred identity, and an unclassifiable change. Rules the
shipped implementation locked:

- A percentage states the denominator it divides ("100% · 49 e-filed", with
  the paper remainder its own tile); `pct()` prints "100" only when numerator
  equals denominator.
- Counts state what they count; paper filings are never folded into a
  transaction total.
- NULL integers render em-dash (never 0); disclosed zeros print 0;
  undisclosed sides render hatched `n/c`.
- Unknown is not a category: an unread party is not "Independent"; a
  side that did not parse renders "—" plus its chip, not "Other".
- A negative days-to-file is named ("filed −320d before trade", flagged),
  never printed as an arithmetic curiosity.
- Indeterminate rows under a filter are counted and stated ("73 amount not
  comparable"), never silently dropped behind a confident "matches 0".
- No default view renders an internal identifier (`sid:` key, raw flag slug,
  schema reference). The machine token stays reachable one interaction away
  and prints; the plain-English warning is what stays visible.
- Universal caveats hoist only at exactly 100%: a note reading "every row
  below carries X" over a 90–99% table is false, and below 100% the rows
  lacking the flag are the informative ones.

## 4. Definitions and live state — the `note()` rules

- **A definition hovers**: what a column means, how a number is computed, why
  a column is unsortable, what a marker asserts. Delivered by the `note()`
  primitive (`src/lib/format.ts`) through three channels off one source
  string: hover, click-pin/focus (44px pinnable button on touch), and print —
  `@media print` lays every `.note-pop` out in flow, which is what keeps
  paper honest.
- **A live control state stays on the page**: "showing N of M", "4 rows
  disclose no amount" — the table describing its own current state is never
  demoted to a tooltip.
- `title=` is not the mechanism for anything honesty-bearing.
- Note panels use the `popover` top layer (a positioned panel inside an
  `overflow-x: auto` scroll container is clipped), with an `@supports`
  fallback; `.note-pop` must never receive `display:none` or
  `visibility:hidden` — it is opacity- and top-layer-driven, which keeps the
  fold guard honest.
- **At ≤720px an open note is a bottom sheet** (signals-v4 M1, record SV4-M1
  below): fixed to the viewport's bottom, full width less 10px gutters, at
  most 70vh, over a scrim — placement and top-layer rules only, in the one
  stylesheet, so it holds wherever `note()` renders. It opens by activation
  (a tap, a click, Enter or Space; with no script through `popovertarget`)
  and closes on the scrim, Escape, its Close button (appended once by
  `notes.ts`, never server markup) or the trigger; hover and focus do not
  raise a sheet, which would cover its own trigger. Above 720px a note is
  anchored beside its trigger, as before. On the v4 surfaces every
  explanation is the ⓘ (mark) trigger; live control state stays on the
  page.
- Capped lists end in an honest terminus ("showing N of M positions — the
  rest are in the source filing, linked"); the terminus row is content, not
  chrome, and stays even where an expand control duplicates its count.

## 5. The mobile fold (≤720px, and the ≤1080px two-line row)

Previously specified by `Mobile.dc.html`; this section is now the authority
(the fold regions in `styles/media.css` and `styles/late-additions.css`, and
`css-fold.test.ts`, cite it).

- **Nothing honesty-bearing is media-query-hidden.** The CSS fold gate
  (`css-fold.test.ts`) walks every narrow-viewport media block and fails if
  any honesty selector receives `display:none` / `visibility:hidden` /
  `content-visibility:hidden`, because markup tests cannot see CSS.
- Both dates stay in the accessibility tree at every width — visually folded
  through the clip pattern (`position:absolute; width:1px; …
  clip:rect(0 0 0 0)`), never `display:none`, which deletes them for screen
  readers. A combined "traded → filed" string shows visually.
- Flags, the owner/partial qualifier, and the provenance link stay on screen
  and wrap rather than disappearing. Coverage tiles become a horizontal
  scroll strip rather than vanishing. Column headers fold through the same
  clip pattern, keeping every column name and every stated
  unsortability reason in the accessibility tree.
- The folded row is a grid with named areas on the row element itself (a
  `<tr>` may hold only cells; a browser hoists illegal children out of the
  table silently). There is **one** structural definition of a folded row:
  the ≤1080px block reuses the ≤720px fold's two-line grammar; the ≤720px
  block keeps what is genuinely about touch — 44px targets, the smaller type
  ramp, the 16px gutters.
- The two-line fold exists because the nine-column row is over-subscribed at
  laptop widths (measured: 1,033px of content in 854px at a 964px viewport)
  — no reallocation of column widths can fix it, so it is a layout change.
- The masthead has an intermediate 721–1080px state that keeps every element
  visible and buys room by tightening spacing and wrapping.
- Mobile accessible text is complete: at 375px a row's accessible text
  carries both dates, qualifiers, all flag chips, and the provenance link.
- Count/disclosure strings are assembled once (`feedCountText()`) and every
  sink receives the same string — a disclosure that reaches only a
  desktop-visible element is the fold failure this section exists to prevent.
- **Tables become row cards at ≤720px (launch redesign D4, from M1b).** No
  table scrolls sideways and the page never does. Each row is a card: a
  wrapping line of its cells, ordered by the ledger ROLE classes (`c-kind`,
  `c-member`/`c-flex`, `c-ticker`, `c-secondary`, `c-num`, `c-bar`, `c-filed`,
  `c-flags`, `c-src`) — never `:nth-child`. A number prints its column's label
  (`data-label`, copied from the head). The head folds through the clip
  pattern and unfolds as a wrapped line while it holds focus. Names, assets and
  managers wrap; an owner, partial, flag, date, lag, range or receipt is never
  line-clamped or ellipsised. The table attribute `data-card` (`feed`,
  `ranking`, `member-trades`, `holders`, `moves`, `generic`) selects the
  layout; the feed keeps its ≤1080px grid card. Every table carries explicit
  roles at every width (`role="table"`, `rowgroup`, `row`,
  `columnheader`/`rowheader`, `cell`), because WebKit can drop native table
  semantics once `display` changes and WCAG 2.1 AA is a hard constraint (§8).

**Record D4 (reversal, launch redesign M1b, owner decision 2026-10-20) — wide
tables on phones.** *Was:* "wide tables scroll within their container, never
the page" (here and in §8), with a sticky identity column and an edge fade at
≤720px. *Measured:* 33 tables scrolled sideways across the 17 audited views at
390px on live build 20261020.2 (the mock's phone audit), each hiding columns
past its right edge behind a fade; the approved mobile scope reverses it.
*Property kept:* the page never scrolls sideways, no column is off-screen
without a cue, and every column's content stays visible and announced.
*Mechanism replaced:* in-container scroll with a sticky identity column and an
edge fade → row cards (above), with explicit table roles shipped first (M1a,
R40) so the semantics survive the `display` change. *Sharper tests:* G3 runs
in full at 390 (any table container wider than its box fails, not only the
document; `ledger.spec.ts`); `launch-phone-css.test.ts` resolves the whole
cascade and asserts the EFFECTIVE `overflow-x` of every table wrapper at
360/390/430 is neither `auto` nor `scroll`, that card rows are flex cards keyed
on role classes, and that no honesty cell is clamped or ellipsised, each with a
re-planted control that fails; the phone harness (`phone.spec.ts`) checks
sideways tables, honesty visibility and table roles at 360/390/430 with planted
controls; `launch-semantics.test.ts` pins the roles on every parity surface and
every client sink. The css-fold test that pinned the old mechanism ("sticky
identity column + edge fade exist for wide 13F tables at the fold") is retired
in the same commit, with this record cited in its place. *Residual risk:* no
WebKit lane runs in the geometry suite (TD-L4); a VoiceOver pass on an iPhone
during the M1b live probe confirms the roles and does not gate. Above 720px
nothing changes: wide tables still scroll inside their container with the
scroll cue.

## 6. Tokens — current reference and accessibility corrections

The September four-screen overhaul uses `docs/design/reference/*.dc.html` and
its hash manifest as the visual source of truth for development and QA. Its
near-black canvas (#04070D), IBM Plex Sans, JetBrains Mono, blue links and
thin section rules supersede the prior parchment/serif appearance. The default
is dark; an explicit light preference remains available. Shared page chrome
uses the same system across routes.

Muted dark text uses #8FA0B3 and hatch stripes use #75879B for legibility.
The reference's smaller, darker labels are not copied where they would lose
contrast. The rules in §§1–5 still apply: source data, both dates, uncertainty
and keyboard/touch access survive visual changes. Prototype sample figures
and predictive commentary are not production data or product rules.

### Historical palette corrections

The following records the previous palette's corrections; its dark token
hex values are superseded by the current reference above.


The mockup token sheet (`Populus Design System.dc.html`, in Git history) is
the origin of the palette and type ramp; these corrections supersede it and
must not regress (pinned by `css-fold.test.ts`'s token assertions):

- `--ink3` darkened/lightened from the design's `#8d8779` / `#7d7869` (3.39:1
  and 3.68:1) to meet the WCAG 1.4.3 AA 4.5:1 floor — its consumers are
  9–12px text, disproportionately the honesty layer.
- The range hatch (`--rule2` at 1.58:1) corrected to 3.13:1 light / 3.67:1
  dark (WCAG 1.4.11).
- Fonts are self-hosted (Source Serif 4, Public Sans, IBM Plex Mono, latin
  subsets) — no external font requests, per the no-external-requests rule.

### The phone type ramp and the fifteenth token (launch redesign M1b, LD12)

At ≤720px the type tokens take their phone values — `--fs-label` and
`--fs-meta` 11px, `--fs-control` and `--fs-note` 12px, `--fs-cell` and
`--fs-small` 12.5px, `--fs-name` and `--fs-body` 14px, `--fs-title` 15px (the
display and hero sizes keep their 22px and 28px) — so no visible text is under
11px on a phone and no value is below its T0 value at any width. **Record
(reversal) — fourteen tokens → fifteen.** *Property kept:* one closed,
token-only type scale with a floor. *Mechanism:* a fifteenth token,
`--fs-input`, for one platform constraint: iOS zooms the page when a field
under 16px takes focus. It equals `--fs-name` by default and is 16px under the
same `(any-pointer: coarse), (max-width: 720px)` query that makes `--hit-min`
44px, and only inputs, selects and search boxes read it. *Sharper tests:*
`launch-phone-css.test.ts` (every field reads it at 390, 1080-coarse and 1440;
nothing else does; the ramp floors at 11px and never drops below T0),
`ledger-system.test.ts` T1.1 (fifteen tokens), G4's width-aware floor (11px at
≤720px, 9.5px above) and G5's fifteen-token minimum.

### Ledger tokens and non-text contrast (DESIGN-POLISH M1)

Every font size on the site reads one of fourteen `--fs-*` tokens in
`foundation.css`, none under a 9.5px floor. The ledger's header-label and meta
inks are lifted from the design's `#51617A`/`#64748A` to `--ink-label`
`#8494A8` (6.51:1 on `#04070D`) and `--ink-meta` `#7B8B9F` (5.80:1); the light
theme uses `#6b6659` (5.43:1) for both (L3).

**Record L16 (deviation) — non-text contrast.** Text is at least 4.5:1
everywhere. The 3:1 non-text floor applies to boundaries, bars and indicators
that are the *only* cue of a control, a state or a value. So the segmented
control's active item carries a 2px `--seg-cue` (`#69B4EC`, 7.72:1 on the
fill) inset bottom bar, while the group's outline (`--seg-border`) may stay
subtle, because each item's own text identifies it. Bars keep a printed value
beside them; the sell fill is lifted from the design's `#5A2E28` to `#9E4E41`
(3.48:1). The light theme follows the same rule.

## 7. Structural shape

Four page archetypes, designed once and reused per module: **feed**
(dense, table-first, client-side filters), **entity** (member → 13F filer →
company are one template), **instrument** (ticker/series), **methodology**
(a first-class product surface and the launch anchor, not a footer link).
Plus the macro dashboard archetype (chart-heavy small multiples) at M4.
Later modules ship as forward-looking shells until their data exists.

The September overhaul fixes the shared **page composition** every archetype
now follows, in the reference's order: masthead → identity block with the
four-figure ledger on the right → provenance strip → three data-derived
summary cards → dense content bands that share one-pixel seams → footer.
(Where the design-polish run departs from this order, the departure is recorded
below: L13 for the cards, L14 for the Signals rule book, SV3-M2 for the
Signals triage, SV3-M3 for the ticker page, SV4-M1 for the Signals rows,
tips and pane switch, SV4-M2 for the Signals tabs, the Institutional tab and
the reduced `/institutional/`, SV4-M3 for the Overlap and Playbooks tabs.)
`/signals` is a triage page (signals-v3 M2, record SV3-M2 below): three lead
cards, then "Filings to read" in three tiers beside the hit rate by family and
a slim hits table. Its rule book (every kind, its exact rule, hits, status —
withheld kinds included) and the lag distribution are on `/methodology`
(`#signal-rules`, `#signal-lag`), linked from the page. (Its device-local
watchlist band was removed with the watchlist in signals-v3 M1; the export's
watchlist band has no route twin.) Two deliberate deviations from the exports are
recorded here so they are not re-litigated by accident: the masthead carries
no build pill (R4 pins the build watermark to one place, once — `/methodology`
since SIGNALS-CLARITY M1, the footer before it), and every
analytics panel whose inputs are not in the build renders the same
"Not available in this build" surface with its named reason — the exports'
illustrative rows are never reproduced.

### Tables are ledgers (DESIGN-POLISH M1)

Every table is built from one region of `entities.css` (`ledger:begin` …
`ledger:end`): one flexible column, numeric columns right-aligned under
right-aligned headers, marks (§ † ‡ ≈) hung in a reserved slot so they never
move a digit, a 3px row edge coloured by kind, and one count grammar
("1–10 of 608 tickers", `rangeOfTotal`). A note's trigger is the text it
explains (the label form), a mark in the slot (sortable headers, links,
numbers), or — only where neither fits — the legacy glyph. A feed row's flags
are visible chips, and each chip is the label trigger of its own definition
(`FEED_FLAG_DEFINITIONS`): the site's published wording, and — for the seven
defect flags, since DESIGN-POLISH M3 — one sentence each derived from, and
citing, the producer line that sets the flag, ending with the methodology's
defect line.

**Record L9 (reversal of a mechanism) — the 44px target.** SL-R24's "44px at
every width" becomes the `--hit-min` square: 44px under
`(any-pointer: coarse), (max-width: 720px)`, 24px otherwise, reached through a
layout-neutral `::before` on every note trigger and sort button, clipped at the
header row's bottom and at the midpoint between a sort button and its mark.
The property — every note and sort control is comfortably tappable on touch —
is kept, and the check is sharper: the unit tests pin the per-adopter cascade
(no `min-width`/`min-height` on the element), and Chromium hit-tests the four
corners of each square (G12, `sl-notes.spec.ts`, `holders.spec.ts`), which also
fails if the hit area inflates the row.

**Record L8 (reversal, completed in DESIGN-POLISH M2) — sticky headers inside
boxes.** A-5's sticky header existed because tables scrolled inside
fixed-height boxes. The property it protected — the reader never loses the
column names inside a trapped scroll — is now held by construction: no table
sits in a `max-height` box and no table head sticks inside one; the page
scrolls, never the table. M1 removed eight of the eleven boxes; M2 removed the
last three (member flows, the member and filer filing histories, the filer's
reported positions) together with the `.etable` sticky head they used, and
gave those tables compact default views behind the one named binder
(`initDomDisclosures`). The pins are sharper than the rule they replace:
`a5-table-css.test.ts` finds no `max-height` table container and no in-table
sticky head anywhere, and the geometry check G2 fails any table ancestor that
scrolls vertically, with no exemption. The sticky IDENTITY column for sideways
scroll is a different property and is kept.

### Page composition (DESIGN-POLISH M2)

Each design page follows the approved preview on the design's grid fractions.
A paired band names ONE primary cell (`data-pair-primary`, the wider cell the
reader came for) and is balanced asymmetrically (coordinator decision CD-1):
the primary's table shows its FIXED default — member flows 20, filing history
12, a filer's reported positions 20, the Consensus board 10 (the Signals
triage is its band's primary since signals-v3 M2, and the slim hits beside it
show a fixed 10) — and is never cut to balance its side, and no row count
depends on the partner cell (CD-5); the side cell may end earlier, but not more
than 96px below the primary at 1440 (the geometry check G9), so no void opens
under the primary — unless the primary is COMPLETE: its table shows its whole
collection, read off its own count (`data-compact-total` ≤
`data-compact-shown`, every row showing), as a Consensus board of one to three
issuers does, and has no more rows to show. The rest of a compact table is one Show-all away through
the named binder, and the count says so ("1–20 of 608 tickers"). A pair whose
one cell holds only an empty-state line collapses to one full-width column
with that line under the other cell (`data-collapsed="empty-state"`, derived
from the cells' own empty-state markers); a lone table of at most three
columns left by that collapse keeps the design's cell width, half the band
(CD-2). A band never holds an empty or placeholder cell. A page carries at most one Planned line, at its foot, outside every
band. A column renders only when some row of its table's full collection has a
value (`presentColumns`, `data-columns`); a removed honesty column states its
reason in the table foot. Every page header renders its figures through the
one header ledger (`disclosureLedger`: valid `<dl>`, a tone per figure, values
on one line, subs of at most two lines, never cut). A figure whose value runs
past a 150px figure's 10 characters, or whose sub would take a third line of
its 23 characters (a long issuer name in a no-ticker Top add), is `data-wide`: it
takes its content's width above the fold and a full ledger row at it.

- **Congress:** the head beside the four-figure ledger, the provenance strip,
  the "Notes on this data" line (the three cards, collapsed), band C1 —
  Leaders (1.6fr) │ Tickers (1fr) — then the feed at 50 per page.
- **Member:** the head beside the ledger, the provenance strip, the quarterly
  chart (one data-derived line when its window holds nothing to plot), band M1
  — Net flow by ticker │ Trading profile + Sector mix — all disclosed
  transactions, band M2 — Filing history │ Signals — the Planned line, then the
  context disclosures.
- **Institutional** (signals-v4 M2, record SV4-M2): the head (h1 with its
  "About this page" ⓘ) beside a three-figure ledger (Filers tracked, Tracked
  value, Notable managers), the provenance chips (closed quarter, newest
  filing in amber, an open filing window in amber) with their one ⓘ, the
  one-line pointer to `/signals/#institutional`, the filer directory, Recent
  activity at full width, the collapsed "Recently added issuers", and the
  methodology link as the foot. The notable managers' named moves,
  Consensus and the new-position leaders (band I1) moved to the Signals
  Institutional tab.
- **Filer:** DOM order is the visual order (no `order` or `:has()` grid rules):
  the head beside its period ledger, the provenance strip, Position changes
  with the period and kind segments on its band head, band F1 — Reported
  positions (1.7fr) │ Book shape + Filing history (1fr) — the Planned line, the
  EDGAR and notes disclosures, and the §5 data note as the page's foot line.
- **Signals** (signals-v3 M2, record SV3-M2; signals-v4 M1, record SV4-M1;
  signals-v4 M2, record SV4-M2; signals-v4 M3, record SV4-M3): the head — h1
  "Signals" with the "How signals work" ⓘ beside it — beside ONE three-figure
  ledger group per tab (the selected tab's shows; Congress's without script),
  then the sticky tab strip (Congress │ Institutional │ Overlap │ Playbooks)
  over the panels. Congress: the lead cards,
  the pane switch (shown only where the band stacks), band S1 — Filings to
  read (1.5fr, the primary) │ Hit rate by family above the slim hits (1fr),
  its cells unstretched and the hits filled to the height of Filings to read
  — the foot's link row and the one-line withheld kinds. Institutional: the
  provenance chips, three lead cards, a three-pane switch, band S2 — Named
  moves (1.6fr, the primary) │ Consensus above the new-position leaders
  (1fr), unstretched, the moves filled to the side column's height — the
  foot's link row and the §5 data note. Overlap: the panel head with its
  playbook strip, the co-occurrence line, the controls (Same │ Opposite │ All,
  Broad accounts), one two-line row per name, the pager and the page's own
  bound. Playbooks: the "Not advice" line, the count line, the list of seven
  beside one article (stacked at the fold, the list a sideways strip).
- **Ticker** (signals-v3 M3, record SV3-M3): the head beside its five-figure
  ledger, the provenance strip, the "On Signals" block when the ticker has an
  active signal, then the sticky Congress │ Institutional tab bar over two
  panels — Congress: the timeline │ members active band, then the
  disclosures; Institutional: holders │ crowding, the overlap band, then the
  agreement — and the † footnote.

**Record L10 (reversal of the Sep-10 IA) — Leaders and Tickers pair (D1).**
The Sep-10 run stacked Leaders above Tickers, each at full width. They now pair
in one band (1.6fr │ 1fr), Leaders left. The property kept is "data first":
the leaders still lead the page, above the feed. The pins flip from "stacked"
to "paired at the same y" (`design-reference.spec.ts`, `refinement-m2.test.ts`).

**Record L13 (deviation from this section's composition) — summary cards.**
The paragraph above puts three data-derived cards on every page. They show on
`/signals/`; on `/congress/` they sit in one collapsed "Notes on this data" line
directly under the provenance strip (D2); on the member and filer pages they sit
in the collapsed context disclosures; `/institutional/` carries one method line
instead. The cards that show follow the card spec (the design's padding, tags
coloured by meaning, no foot). D2 also restores the Congress four-figure ledger
beside the H1 — TRANSACTIONS, HOUSE PARSE, SENATE PARSE and PAPER, from
`coverageSummary`, with the denominators in the subs.

**Record L14 (deviation) — the Signals band order (D3).** This section lists
the rule book before the hits. The owner's D3 places it as an expanded
full-width band after Hits │ Lag. The rule book's content requirement here —
every kind, its exact rule, why it carries information, hits and status,
withheld kinds included — is met in full: seven rows, never collapsed.
(Superseded in place by SV3-M2: the same seven-row rule book renders on
`/methodology#signal-rules`, still expanded.)

**Record SV3-M2 (signals-v3 M2, owner-approved mock 2026-10-13) — the Signals
triage layout.** `/signals/` answers "which filings should I read first",
from the filings themselves:

- **Head.** Kicker, "Congress signals", a one-line lede ending in the
  "How signals work" label note, and exactly three ledger figures: Hits (with
  the listed-stock count), Stand out ("of N rows ranked") and Window (90d,
  with its dates).
- **Lead cards.** Committee (amber; "direct match", "broad match", or the
  stated absence when committee data is not in the build — never a grade it
  cannot state), Largest buy (green) and Largest sell (red). One segmented
  control ranks buy and sell by "Own record" or "Absolute $": two clipped
  radio inputs and `:checked ~` rules, no script; without CSS both variants
  show. Every card shows both dates, its receipt and a ticker link.
- **Band S1.** Filings to read (1.5fr, the primary) │ Hit rate by family
  above the slim hits (1fr). A row is an `<article>`: the ticker-and-member
  heading is a stretched link to `/tickers/<T>/#on-signals`, the receipt a
  separate link above it; side, range, party-state, owner and LATE tags; the
  reason sentence; four meters (`role="img"`, "Size: strong"; three bars;
  level 3 amber, 1–2 accent, unknown hatched); the lead line's own filed
  date, then "traded {date} · {lag}d" and its filing's receipt — a grouped
  row labels its latest filing apart ("latest of {n} filings: {date}"). Routine is a closed `<details>`. A legend defines the levels and
  the four meters, the Cmte line carrying "context, never an allegation". The
  family rows are `<button aria-pressed>` filters with a removable pill; the
  slim hits table is Kind (its exact rule a note) · Ticker · Who (last name,
  the full name its link's name) · Traded → Filed · Size · Src, 10 lines and
  "Show 10 more". A non-stock hit keeps its asset-type chip beside the
  member. (Superseded in part by SV4-M1: the row is a two-line `<details>`
  with its receipt outside the summary, the legend is the "What the bars
  mean" tip, and the hits fill to the height of Filings to read.)
- **Moved, not deleted (LD9).** Every caveat that left the visible page is
  in the head note (fact not forecast; never prices, returns or intent;
  recomputed every build; the lag caveat; the lifecycle note; withheld and
  superseded counts; date anomalies) or beside what it qualifies (the window
  in its figure, the committee caveat on its card and in the legend, each
  kind's rule on its kind word, both dates in their column), and on
  Methodology (`#signals-ranking`, `#committee-direct`, `#signal-rules`,
  `#signal-lag`).
- **Phones.** At 390 and 360 px the row folds to one column, the meters name
  themselves inline (the desktop meter head is clipped, never removed), and
  nothing honesty-bearing is hidden: `css-fold.test.ts` sweeps the row's
  dates, LATE tag and receipt, the cards' dates and receipt, the committee
  caveat and the meter's inline name.

**Record SV3-M3 (signals-v3 M3, owner-approved mock 2026-10-13) — the ticker
page.** `/tickers/<T>/` is two real tabs, Congress and Institutional:

- **Head.** The title is unchanged: the ticker, then the issuer name from the
  SEC's present-day ticker file with its † "present-day mapping" footnote, or
  the ticker alone when no name maps. Five ledger figures: Congress txns,
  Members · 12m, Latest PTR, Filed late (the SELL tone when a row was late;
  its sub-line says how many rows are undated, whose timeliness is unknown,
  and its label note says why) and 13F holders. The lede and the three summary
  cards are gone (a deviation from this section's composition, like L13); the
  lede's "each section keeps its own clock" sentence is in the provenance
  strip.
- **On Signals (`#on-signals`).** Server-rendered, before the tabs. A ticker
  that leads a Stands out or Worth a look row gets that row exactly as
  "Filings to read" prints it — tier, member with party and state, side and
  range, the reason sentence, the four meters, ONE line's own filed date,
  trade date, lag and receipt — with "← Back to Signals", and the committee
  caveat whenever the Cmte meter shows committee context. A ticker with
  active hits and no such row gets up to five slim hit rows (each kind's
  exact rule a note, member, both dates, size, receipt), an honest count of
  the rest, and the caveat beside a COMMITTEE hit. Otherwise nothing; `/e/`
  never shows the block.
- **Tabs.** A sticky `role="tablist"` bar of two links over two
  `role="tabpanel"` sections. The server HTML shows both panels, stacked:
  without JavaScript the tabs are in-page links. `scripts/tabs.ts` selects one
  (from the hash, or the panel that holds a deep-linked element), hides the
  other with `hidden`, keeps a roving tabindex with Arrow, Home and End, and
  writes the hash with `history.replaceState`; `/e/` re-binds after every
  `populus:rerender`. Anchors keep clear of the bar (`scroll-margin-top`);
  paper prints both panels and every holder. A tab panel is hidden by the reader's choice,
  never by a width: no media query touches it.
- **Congress tab.** The timeline (with $15K, $250K and $5M gridlines) beside
  the members active; then the disclosures preview: up to five rows the On
  Signals block names, pinned first and marked "On Signals" (their marks ringed
  on the timeline), then the newest rows, ten in all, and "all N rows ↗".
  Pinned first, the Filed column claims no sort; the panel note states the
  order. The universal-flag hoist reads every shown row, pinned ones included.
- **Institutional tab.** Holders 1–10, then holders 11–N inside "Show all N
  holders" in the same HTML (the full holders view is linked only where it is
  built); the hoist and the terminus count all N. Then the overlap band and
  "Do the two regimes agree?".
- **Retired:** the section index with its Financials / Macro SOON tabs, the
  planned supplement, the "PLANNED institutional holder flow" line and the
  per-kind signals table. The ticker page carries no PLANNED markup: an
  overlap band that cannot read its notable-manager side states that absence
  and its reason in plain words (the holders page keeps the badge).

**Record SV4-M1 (signals-v4 M1, owner-approved mock 2026-10-17) — the Signals
rows, tips, fit and pane switch.** Decision record: `docs/frontend/signals-v4.md`.

- **The row (LD4).** A "Filings to read" row is an `<article>` holding a
  `<details>`: the `<summary>` is the row, the body the opened row, and the
  receipt a sibling of the `<details>` laid over the summary's reserved cell,
  so no link is nested in the disclosure button. Above 720px it is two
  lines at every width on a six-column grid (from 1440px
  `minmax(52px, max-content) minmax(0,1fr) 92px 104px 108px 34px`):
  ticker · filer (party and state, owner, tags) · range · meters · filed ·
  receipt, then side · the reason (one line, ellipsis) · traded and lag
  (spanning the meters and filed columns) · chevron. Below 1440px the
  meters move to line 2, beside the reason. The filer cell is one line:
  only the NAME gives way to an ellipsis — party and state, owner, ×N and
  every tag keep their width, a cluster's member count never shrinks, and
  the full name stays in the DOM and the opened row (no `title=`). One column head labels
  them once (Ticker, Filer · why, Range, Size Patt Oth Cmte, Filed · traded)
  and carries the "What the bars mean" tip. At ≤720px it is three lines — a
  flex row broken by two zero-height pseudo-elements: ticker · side · range
  · filed · receipt; filer · meters (each short name over its bars); reason
  · traded and lag · chevron. A filer that needs more room wraps; nothing is
  folded away (`css-fold.test.ts` sweeps `.si-row-filed`, `.si-row-traded`,
  `.si-row-src`, `.owner-note`, `.si-late-tag`, `.si-meter-label`,
  `.si-cmte-context` and `.si-row-why`). The opened row gives the full
  reason, the lead line's chronology, the grouping, the owner, the LATE
  detail, every meter in words with its definition, and the ticker, member
  and receipt links. One row is open at a time (`details[name]`); the ticker
  page renders the same row opened.
- **Tips.** One ⓘ per explanation: the head's "How signals work" beside the
  h1, "About lead cards", "About filings to read", "What the bars mean", one
  per tier (Routine's beside its summary, never inside it), "About hit
  rates", "About hits", and a withheld kind's reason. The sheet is §4's.
- **The fit (LD6).** The filled column's CONTENT ends within one row of its
  neighbour's content (`scripts/column-fit.ts`: `contentBottom`, never a cell
  box); the band's cells do not stretch (`align-items: start`). "Show more"
  extends past the neighbour by design; a filter change drops the extension.
- **The pane switch (LD7).** A `.seg` of two buttons, server-`hidden`; the
  client shows it and hides the unselected pane with the `hidden` attribute
  only while `(max-width: 1080px)` matches. No media rule hides a pane.
- **Lead cards (LD5).** Each pick opens its row through a stretched link
  under the card's own links; at ≤1080px the cards swipe in their own strip
  (`scroll-snap-type: x mandatory`), a named scroll region while it
  overflows.

**Record SV4-M2 (signals-v4 M2, owner-approved mock 2026-10-17) — the Signals
tabs, the Institutional tab and the reduced `/institutional/`.** Decision
record: `docs/frontend/signals-v4.md` §M2.

- **The tabs (LD8).** One `role="tablist"` (`.tk-tabs.sig-tabs`, bound by
  `scripts/tabs.ts` like the ticker page's) inside a ROLE-LESS scroll wrapper
  (`.sig-tabs-scroll`, sticky): the wrapper is the named "scroll sideways"
  region while the strip overflows, so the tablist keeps its role and name at
  every width. Every `[data-scroll-region]` goes on an element with no role
  or name of its own; the client refuses to re-role one that has (a console
  error) and a render test scans for the pair. Every panel renders and shows
  without script (stacked); print shows every panel. Each head ledger group
  is `[data-tab-for]` and toggles with its panel; every value in a hidden
  group is also stated inside its panel. Every in-page navigation (a hash, a
  card, a Consensus row) runs ONE reveal sequence (`revealTarget`): its tab,
  its pane, its filter and its row, then scroll and focus.
- **The Institutional tab.** Provenance chips (the closed quarter; the
  newest filing in amber) with one ⓘ holding the 13F snapshot caveats; three
  lead cards (Consensus row 1, the largest new stake, the largest exit) each
  stating its quarter, the single-filing two with their 13F receipt; the
  Named moves — kind and manager-type chips (the site's segmented groups) in
  a row that scrolls sideways at the fold, a removable name pill, one row per
  move as a `<details>` with its 13F receipt laid over the summary's last
  track (as SV4-M1's row) — the first fifteen carry their opened body, a
  held row only the data its body is rendered from on first opening, by the
  same renderer (the page's byte budget) — "Show 15 more", the count against the build's
  whole population and the page's own bound stated where it cuts; Consensus
  — ten rows, "Show all", each row a filter (a stretched button over its
  cells), the Congress count on its second line; the new-position leaders,
  each naming its largest new position. The Congress column (LD10) is a
  count with its words for assistive technology; an opened row lists its
  side's lines (each with range, both dates and receipt), copied from ONE
  per-name block in the closed "Congress lines behind the counts"
  disclosure, so a popular name's lines are never repeated per move.
- **The owner's label (LD20).** "Conviction leaders" renders only in its
  exempt heading, ARIA and caption forms or through
  `<span class="ref-label">…</span>`; its anchor is `#new-position-leaders`
  (the §0 gate reads raw bytes, ids included).

**Record SV4-M3 (signals-v4 M3, owner-approved mock 2026-10-17) — Overlap
and Playbooks.** Decision record: `docs/frontend/signals-v4.md` §M3.

- **Overlap (LD14).** A co-occurrence, worded so on screen (the line under
  the head) and in its tip: never coordination, never intent. One row per
  name as a `<details>` — line 1 the ticker, the relation word (SAME · BUY
  SIDE, SAME · SELL SIDE, OPPOSITE, MIXED), the issuer and both sides' ▲/▼
  counts with their words for assistive technology; line 2 the members and
  the managers, cut by an ellipsis above the fold and wrapped at it. The row
  carries both variants (broad accounts not counted, and counted): the
  inactive one's relation and counts are `hidden`, never a media rule. The
  opened row lists each member's newest line through the one Congress-line
  renderer (range, owner, both dates, receipt), the broad accounts' lines
  apart and named, and each manager's change with its 13F receipt. The page
  carries a bounded run of names per view and states the bound where a view
  runs past it; every count is the true total.
- **Playbooks (R19).** "Published research on the patterns these rows show.
  Not advice." is the tab's first line, visible, never a tip. The list is
  anchors (without script every article shows and the list jumps to it; with
  it one article shows and its link is `aria-current`); each article states
  its source and status, pattern, verdict (amber), rule and horizon (tips),
  what triggers it now, and its evidence for and against, each finding with
  its venue, sample and source link, visible (no `title=`). At the fold the
  list is a sideways strip of chips that keep their status.
- **Playbook chips (R21).** A dashed chip on a triggered row's first line
  (inside the filer cell, never shrinking), the playbook's section in the
  opened row, a Playbooks filter above Filings to read (dashed segmented
  chips with their counts; an unavailable playbook says so), and strips on
  Consensus, the new-position leaders and Overlap — links to the playbook.

**Record L15 (reversal of a Sep-10 SRC §5 ban) — the HOUSE PARSE label (D2).**
The Sep-10 copy pass banned "HOUSE PARSE" in visible text. D2 restores the
design's HOUSE PARSE and SENATE PARSE ledger labels. The property kept:
"parse" never appears in reader prose — the label is a figure name, and its
note says in plain words what it counts. The mechanism: the post-build scan
allows the label in exactly one home, the `/congress/` ledger's `<dt>`, and
matches it case-insensitively everywhere else, so a CSS-uppercased
"House parse" in any paragraph fails.

### Words in the ledger (DESIGN-POLISH M3)

One vocabulary per kind of fact, from one table each, on every surface:

- **Disclosed trades** read **BUY**, **SELL** or **EXCHANGE** (spelled out, never
  "EXCH"), and "—" when the side did not parse (`sideLabel`). A partial sale
  reads SELL with its "partial" qualifier. The Congress side filter uses the
  same words.
- **13F changes** read **NEW**, **ADD**, **TRIM**, **EXIT**, **NO CHANGE** and
  **NO PRIOR**; an unclassified or unknown kind stays the hatched **n/c**
  (`kindWord`, `docs/frontend/qoq-presentation.md` §1 as amended). A kind is a
  caps word in its kind's colour beside the row's edge — never a tinted pill.
  The filer holdings view's two-period comparison is not a QoQ classification
  and keeps its own words (ADDED, ABSENT, INCREASED, DECREASED, UNCHANGED).
- **Member flows by ticker** read **NET BUY**, **NET SELL**, **FLAT** (a
  bounded net range that spans zero and stays inside the smallest bucket, both
  bounds within ±$15,000), **±** (a bounded range that spans zero more widely;
  spoken "net range spans zero") or "—" (an undisclosed side, or an open bound
  that reaches across zero: no direction can be stated). The Issuer cell shows
  the issuer's name without a type code's words, because the row nets every
  trade in the ticker.
- **Qualifiers** (partial, then the owner code) are joined by one separator
  (`joinQualifiers`): no cell prints "· ·" or opens with a separator, and in an
  asset cell they sit outside the ellipsis.
- **The asset text** drops a trailing `[ST]` equal to the row's type, a
  parenthesised ticker equal to the row's ticker and a "Common Stock" /
  "Ordinary Shares" suffix; every other House code renders as the House
  Clerk's words (`ASSET_TYPE_WORDS`, transcribed from
  https://fd.house.gov/reference/asset-type-codes.aspx); an unknown code keeps
  its bracket. The parts are stripped to a fixpoint, and a suffix that a count
  or "of" governs ("each representing 3 Ordinary Shares") is not a type and
  stays. The rule is stated once, in the asset column's header note
  (`assetColumnNote`); a name that differs from the filing in any other way is
  a label trigger whose note gives the as-filed string, and it prints. A
  no-ticker asset (`assetNameCell`) is a label trigger whenever its cell hides
  anything (truncation, a code, a stated type).
- **Signal receipts** name their regime once: "PTR ↗" / "eFD ↗"; where the link
  cannot ("src") or there is no usable receipt, the regime stamp states it
  ("PTR src ↗", "PTR —") — the hit rows and the member panel alike
  (`signalReceiptHtml`).
- **CIKs** show without leading zeros; the padded form stays in URLs and data.
- **Issuer names** are the modal filed name, verbatim (owner decision D4 (a)):
  never re-cased, so an abbreviation is never mangled and an embedded CUSIP
  keeps its capitals for the scrub.
- **Sectors** show the SIC Manual's division titles (`sectorLabel`).

**Record CD3-4 (deviation from R17, M3 review; the owner may reverse) — the
as-filed note only where the rule does not say it.** R17 put the as-filed
string one interaction away on every asset whose display differs from it. On
the heaviest member pages that doubled the page (M001193 535 KB → 964 KB, 608
net-flow Issuer notes). A name that differs from the filing ONLY by a trailing
" (TICKER)" equal to the row's ticker, " [ST]" when ST is the row's type, or a
" Common Stock" / " - Common Stock" / " Ordinary Shares" suffix — each matched
exactly, case included — carries no per-row note; the column's header note
states the rule and the House Clerk's stock code once. What the rule does not
restore is which of those parts the filing carried; the filing itself (the
row's receipt) is the exact record. Any other difference — another code's
words, a case-variant ticker "(AAPl)", "[sT]", stray punctuation — keeps its
per-row note. The net-flow notes are keyed on the ticker (`n-mf-<ticker>`).

**Record L4 (deviation from the design) — a late row keeps its side.** The
design prints LATE as a late row's kind word. The side is honesty content
(§1): a late SELL is still a SELL. The row reads BUY or SELL; lateness is the
gold row edge and the dates cell's unchanged `LATE·Nd` text.

**Record L5 (deviation from the design) — NO CHANGE, not HOLD.** A held
position (share count unchanged) reads NO CHANGE: HOLD reads as an analyst
rating, which §2 forbids. The hatched n/c keeps its own meaning, "not
classifiable".

## 8. Hard constraints

- Astro, static, Cloudflare Pages. No backend, no accounts, no cookies, no
  tracking, no browser calls to external APIs (SEC sends no CORS headers) —
  all data is build-time extracts and same-origin JSON deployed with the
  site. The only reader state kept is the theme choice, in this browser's
  localStorage (the device-local watchlist was removed in signals-v3 M1, and
  `public/theme-init.js` deletes the keys it wrote). This is a stated brand
  commitment: a transparency-first civic-data tool that profiled its readers
  would contradict its own methodology page. (Analytics, if ever added, is
  cookieless and aggregate, and the published privacy promise is rewritten in
  the same change.)
- File budgets are contractual (global self-cap 18,000 static files — 90% of
  the provider's 20,000). Long-tail entities render client-side on `/e/`
  from same-origin shards through the **same render functions** the static
  pages use — parity by construction, one function, two callers.
  Out-of-extract entities get a designed "we don't render this entity —
  here's the government source" state, not a page.
- Lighthouse ≥90 (performance and accessibility) on feed, entity, and
  instrument pages; WCAG 2.1 AA. Light and dark from day one; data-dense
  tables hold contrast in both.
- Responsive for real: the page never scrolls sideways. Above 720px a wide
  table scrolls within its container with a scroll cue; at ≤720px every table
  folds into row cards with explicit table roles (§5, record D4). Feed and
  entity pages genuinely work on phones: no visible text under 11px, every
  tap target at least 44×44, fields at 16px so iOS never zooms.
- Mock numbers never ship: every tile derives from `stats.json` or the
  module's own manifest watermarks, or states absence. Cadence claims are
  replaced by the build stamp.

## 9. What not to design

No marketing fluff, no deferred features (accounts, alerts, payments, hosted
APIs, social), no trading-tool affordances, no component libraries that fight
the constraints, and — the standing rule worth restating — no mockup fidelity
at the cost of an honesty element. When following a mockup would remove
honesty content, the implementation deviates and records the deviation; the
mockup is authoritative on layout, type, and colour only.

Mockup data is never a measurement: design-artifact numbers are placeholder
values, and every shipped number must trace to a published artifact.
