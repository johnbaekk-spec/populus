# Populus — Developer Handoff (paste this whole file to your dev agent)

You are building the public dashboard for **Populus**, an open financial-data commons
(congressional trades + 13F institutional holdings from primary government sources).
The pipeline already exists (Python, separate repo); you are building the **static site**
it publishes. Approved UI mockups exist as HTML files in this design package — treat them
as the source of truth for layout, spacing, color, and copy. Recreate them faithfully.

## Stack constraints (from ARCHITECTURE.md)
- Static site (Astro or equivalent). Pre-render top routes; long-tail entity routes render
  client-side from same-origin JSON shards (see "S4" state in `States - Empty Partial Withheld`).
- No tracking, no cookies. No account required for anything in these mockups; watchlist = localStorage only. BUT: a paid convenience tier (Discord notifications, TradingView indicators) is on the roadmap — don't architect accounts/entitlements OUT of the system, just keep the record pages themselves free and ungated.
- All data comes from a published build: `stats.json` + JSON extracts. Never hardcode the
  numbers in the mockups — they are sample content. Every freshness/coverage stat is read
  from stats.json at build time.
- Real `<table>` semantics (th scope, caption) even though mockups use div grids.

## Design tokens (copy exactly; CSS custom properties, light default + `[data-theme="dark"]`)
Light: --paper:#faf9f5 --raised:#fffefb --ink:#262319 --ink2:#5f5a4e --ink3:#8d8779
--rule:#e5e1d6 --rule2:#cec8b9 --accent:#30567c --accent-h:#1f3d5c --amber:#7a5a14
--amber-bg:#f4e8cf --buy:#2b6a52 --sell:#92483a --dem:#49597c --rep:#7b524f --ind:#67624f
--hatch:repeating-linear-gradient(45deg,transparent 0 3px,#cec8b9 3px 4px)
Dark: --paper:#1b1915 --raised:#23201a --ink:#ece8dd --ink2:#a8a294 --ink3:#7d7869
--rule:#35322a --rule2:#4a463c --accent:#8fb0d4 --accent-h:#b4cde6 --amber:#d9a94e
--amber-bg:#3a2f17 --buy:#7dbd9f --sell:#d99180 --dem:#93a7cc --rep:#c99a94 --ind:#a09a88
--hatch: same pattern with #4a463c

Type: Source Serif 4 (identity, page titles, argument prose) · Public Sans (UI, body, ALL
data cells, `font-variant-numeric: tabular-nums` on every numeric) · IBM Plex Mono
(identifiers, receipts, as-of stamps). Self-host all three (open licenses).
Scale: display 40/700 serif · h1 28/600 serif · h2 21/600 serif · h3 16/600 sans ·
body 14.5/400 · data 13/500 tnum · label 10.5/600 caps +12% tracking · meta 11.5 mono.
Spacing 4px base. Radius 2px chips, 0 elsewhere. No shadows — hierarchy via hairlines
(--rule) and section rules (--rule2). Table rows 34–38px dense. Focus ring 2px --accent.
WCAG 2.1 AA minimum everywhere; party/side colors are always accompanied by words.

## The uncertainty grammar (G1–G7) — non-negotiable product logic
G1 RANGE: congressional amounts are statutory buckets. Render as fixed log-scale range
band ($1K → $50M+ track, filled interval). NEVER midpoints, never bar-length-as-value.
Sums of ranges render as ranges ("$3.2M–$11.5M"). The 10 buckets and their band
geometry (left%, width%) are in the mockups' JS (`B` maps).
G2 STALENESS: every trade shows traded date + filed date + lag "+Nd". Lag > 45d gets the
amber LATE chip. Every table header carries an as-of stamp. 13F pages say "quarter-end,
filed +Nd", never "current holdings".
G3 TRUNCATION: source-truncated lists (SEC top-25 holders) end in a dashed terminus row
attributing the truncation to the source. Our own render budgets use the same row, attributed
to us. Never a bare "show more" implying completeness.
G4 UNDISCLOSED: hatched pattern = the source didn't disclose. QoQ change with one side
undisclosed renders an "n/c" hatched chip (never coerced to add/trim). Em-dash = absent in
source, never zero. Zero prints 0.
G5 INFERENCE: anything Populus derived (issuer from CUSIP-6, filer→member join, "exit"
classification, derived %) gets a dotted underline + †/‡/§ footnote marker resolving to one
compact line under the table. No tooltips-as-only-channel; footnotes print.
G6 FLAGS: two visual classes — solid gray tag = source fact (no ticker, spouse cap, date
anomaly); dashed-border tag = parse defect (amount unparsed, needs OCR, unjoined filer).
amendment_unresolved is amber. Machine flag name available on hover/detail.
G7 PROVENANCE: last column of every table = SRC mono link to the exact government document
(PTR PDF / eFD page / EDGAR accession). Aggregates link "derived ·§". Every page footer:
build ID + snapshot hash + verify link + §13107(c) notice + not-financial-advice.

## Chart rules
C1 bucketed data → bands/ribbons only. C2 gaps stay gaps (no interpolation). C3 zero-based
value axes or explicit break. C4 every chart prints source + as-of + n + exclusions.
C5 party series = duotone strokes + distinct dashes, never fills. C6 no sparklines on range
data. C7 revised series show prior vintage as labeled ghost stroke.

## Routes & screens (mockup file → route)
- `Home` → `/` front door: hero + honesty specimen card + module grid with live stats + commitments.
- `Congress Feed` → `/congress` flagship: stats strip, filter bar (chamber/party/side/
  amount≥/owner/late-only; client-side), dense trade table, needs-OCR row treatment,
  footnote lines, pagination "older →" (filed-date desc default sort).
- `Congress Member` → `/congress/members/{bioguide}`: entity header + watch star, stat
  strip, quarterly disclosed-flow range ribbon (buy/sell), most-disclosed tickers, full txn table.
- `Ticker Unified` → `/tickers/{ticker}` **primary ticker page**: search-first masthead,
  section index (Congress | Institutional | Financials SOON | Macro SOON), congressional
  members+filings, 13F top holders with truncation terminus, planned-section placeholders.
  `Congress Ticker` and `Ticker Holders` mockups are the deep "full view" pages the unified
  page links to (`/congress/tickers/{t}`, `/institutional/tickers/{t}/holders`).
- `Institutional Filer` → `/institutional/filers/{cik}`: 13F explainer block, period
  selector, concentration strip, holdings table with QoQ chips (add/trim/new/exit/n-c),
  below-threshold terminus, footnotes.
- `Methodology` → `/methodology`: per-module sources+conditions, coverage stats from
  stats.json, known gaps, publication/verification, privacy, required notices.
- `States - Empty Partial Withheld` → S1 coverage-gate withheld module page; S2 out-of-extract
  entity (link to EDGAR, no data page); S3 filter-empty with nearest-match suggestions;
  S4 client-shard skeleton (shell paints first); S5 needs-OCR filing detail; S6 empty
  watchlist; S7 filing-window-open banner. Implement ALL of these.
- `Module Shells` → `/financials`, `/macro` placeholder pages + macro chart concept for later.
- `Mobile` → ≤720px rules: rows fold to two-line cards (who·what·side / band·dates·flags),
  filters become pinned chip row, wide tables scroll inside container with sticky identity
  column + edge fade, tap targets ≥44px.

## Search
Header search is the primary navigation (see `Ticker Unified` masthead). Client-side only:
a small prebuilt index (tickers, members, filers → page paths) fetched same-origin;
free text never leaves the device. "/" focuses it. Results grouped: Tickers · Members · Filers.

## Monetization guardrail
The public records and all pages in these mockups stay free, no sign-up. Future paid layer = convenience only (push notifications, third-party integrations), never the data. Copy therefore says "no account required" / "the data is free forever" — never "no accounts ever" or "everything free forever". Note: 5 U.S.C. § 13107(c) restricts commercial use of congressional disclosure data — get legal advice before selling anything derived from PTRs specifically (13F/EDGAR data is public domain and unrestricted).

## Copy tone
Court-record confidence, no hype, no emoji. Captions state limitations plainly
("a complete ranking does not exist in the public record"). Legal footer on every page.

## Definition of done
- All routes above at desktop + mobile, light + dark, matching mockups.
- G1–G7 implemented as shared components (RangeBand, DualDate, FlagTag, TerminusRow,
  FootnoteBlock, SrcLink, StatBadge) — one implementation each, reused everywhere.
- Zero hardcoded stats; everything from stats.json/extracts with graceful S1–S7 states.
- Lighthouse a11y ≥ 95; keyboard navigable; prints acceptably.
