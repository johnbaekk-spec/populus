# Design principles — the public dashboard

The durable design contract for publicfilings.org. Consolidated from the two
original design briefs (`DESIGN-BRIEF.md`, `docs/build/P3-DESIGN-BRIEF.md`),
the UX-overhaul and surfaces-legibility design decisions, and the mobile-fold
rules previously carried by the design mockups (`docs/design/handoff/*.dc.html`)
— all of which now live in Git history. **This document is the stated authority
those artifacts used to hold**: the stylesheets under `dashboard/src/styles/` (nine region files
imported by `Base.astro` in cascade order; split from the former
`global.css` by REPOSITORY-PROFESSIONALIZATION Slice 6) and
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

## 6. Tokens — deviations from the original mockups, locked

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

## 7. Structural shape

Four page archetypes, designed once and reused per module: **feed**
(dense, table-first, client-side filters), **entity** (member → 13F filer →
company are one template), **instrument** (ticker/series), **methodology**
(a first-class product surface and the launch anchor, not a footer link).
Plus the macro dashboard archetype (chart-heavy small multiples) at M4.
Later modules ship as forward-looking shells until their data exists.

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
