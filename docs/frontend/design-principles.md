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
  attributions, "not financial advice", the build ID) have fixed placements:
  footer and methodology. Dignified, not cookie-banner-ugly.

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
  dark (WCAG 1.4.11); the unstarred ☆ glyph likewise raised to `--ink3`.
- Fonts are self-hosted (Source Serif 4, Public Sans, IBM Plex Mono, latin
  subsets) — no external font requests, per the no-external-requests rule.

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
below: L13 for the cards, L14 for the Signals rule book.)
`/signals` is a feed-archetype page with three bands of its own: the rule
book (every kind, its exact rule, hits, status — withheld kinds included),
hits beside the lag distribution and per-family hit rate, and the
device-local watchlist band. Two deliberate deviations from the exports are
recorded here so they are not re-litigated by accident: the masthead carries
no build pill (R4 pins the build watermark to the footer, once), and every
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
12, a filer's reported positions 20, the signal hits 12 of their page, the
Consensus board 10 — and is never cut to balance its side, and no row count
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
its 23 characters (a long issuer name in the Consensus add), is `data-wide`: it
takes its content's width above the fold and a full ledger row at it.

- **Congress:** the head beside the four-figure ledger, the provenance strip,
  the "Notes on this data" line (the three cards, collapsed), band C1 —
  Leaders (1.6fr) │ Tickers (1fr) — then the feed at 50 per page.
- **Member:** the head beside the ledger, the provenance strip, the quarterly
  chart (one data-derived line when its window holds nothing to plot), band M1
  — Net flow by ticker │ Trading profile + Sector mix — all disclosed
  transactions, band M2 — Filing history │ Signals — the Planned line, then the
  context disclosures.
- **Institutional:** the head beside the ledger, the provenance and freshness
  lines, notable managers, the filer directory, band I1 — Consensus (1.3fr,
  the primary) │ Conviction leaders (1fr), as the approved preview draws it
  (CD-5) — Recent activity at full width, the Planned line, the collapsed
  "Recently added issuers".
- **Filer:** DOM order is the visual order (no `order` or `:has()` grid rules):
  the head beside its period ledger, the provenance strip, Position changes
  with the period and kind segments on its band head, band F1 — Reported
  positions (1.7fr) │ Book shape + Filing history (1fr) — the Planned line, the
  EDGAR and notes disclosures, and the §5 data note as the page's foot line.
- **Signals:** the head beside the ledger, the provenance strip, the three
  cards, band S1 — Hits (1.8fr) │ Lag distribution + Hit rate (1fr) — the rule
  book as an expanded full-width band, the watchlist band, the withheld panels.

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
  ("PTR src ↗", "PTR —") — the hit rows, the member panel and the watch band
  alike (`signalReceiptHtml`).
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
  site. Personalization is localStorage only. This is a stated brand
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
- Responsive for real: wide tables scroll within their container, never the
  page; feed and entity pages genuinely work on phones.
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
