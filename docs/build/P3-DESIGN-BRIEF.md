# Populus — dashboard design brief

*Hand this to a design agent/tool. It is written to be pasted whole.*

---

## What Populus is

**The open financial-data commons.** US financial-disclosure data, pulled only
from primary government sources, redistributable under conditions we record and
honor, and free forever. Two consumers: an MIT-licensed MCP server that analysts
run inside their LLM client, and this public dashboard.

The tagline is literal: *"Populus" — the people's data, returned to the people.*

Free financial data exists in abundance but is fragmented across agency sites,
bulk files, and undocumented endpoints. The companies that unified it sell it
back at $30–200/month. Populus unifies the free layer and keeps it free. **The
differentiators are provenance and honesty, not coverage.** Anyone can scrape
congressional trades. Nobody else shows you exactly how stale each number is,
what it excludes, and how it was derived.

## What already exists (this is real, shipped, and green)

A working pipeline and MCP server, 1,475 tests passing:

- **Congressional trading (M1, complete).** House PTR PDFs + Senate eFD, parsed
  and reconciled: 97.5% e-file parse coverage on the real 312-filing House
  corpus, 100% on Senate. ~54k rows.
- **Institutional 13F (M2, complete).** SEC EDGAR 13F ingest, normalization
  across the 2023-01-03 unit change, typed amendments, cross-filer aggregates,
  quarter-over-quarter deltas, per-issuer top holders, portfolio concentration.
- **A verified publication protocol.** Immutable content-addressed snapshots,
  signed pointer, per-artifact digests, reproducible builds.

**Data not yet in the dashboard:** M3 (company financials) and M4 (macro) are
not built. Design their surfaces as forward-looking shells, not detailed screens.

## The design problem — read this twice

Every number on this site is **wrong in a specific, knowable way**, and the
product's entire value is telling you how.

- A congressional trade is disclosed in a **dollar RANGE**, not an amount
  ($1,001–$15,000). There is no exact figure to show. Ever.
- It is filed **up to 45 days after the trade**, sometimes far later.
- A 13F holding is a **quarter-end snapshot filed up to 45 days late** — not
  current holdings. Long positions only. No shorts, no cash. Only managers with
  ≥$100M in 13(f) securities file at all, so it is **not a census**.
- Cross-filer rankings are truncated to a **published top-25 per issuer**.
- Some quarter-over-quarter changes are **unclassifiable** because a value was
  undisclosed on one side — they are neither "add" nor "trim."
- A position "exiting" may mean sold, acquired, delisted, moved to confidential
  treatment, or migrated to an affiliated filer. It does **not** mean "sold."

**The brief is not "add tooltips with disclaimers."** Disclaimers are what
products do when they want to be legally safe and practically ignored. The brief
is to make uncertainty *legible and useful* — so an analyst reads a number and
immediately knows its shape, without wading through prose, and without the
caveats making the interface feel timid or cluttered.

Reference the density and confidence of a Bloomberg terminal, the typographic
rigor of the *Financial Times* or *The Economist*'s data desk, and the
provenance ethic of a scientific instrument readout. **Not** a consumer fintech
app. No gradients-and-glow "trading" aesthetic. No fake precision. No sparkline
that implies a trend the data cannot support.

The hardest and most valuable thing you can design here: **a visual grammar for
"how much should I trust this number?"** that works consistently across a dollar
range, a stale filing date, a truncated ranking, an inferred identity, and an
unclassifiable change. Get that right and the rest of the site follows from it.

## Surfaces

**`/congress`** — the flagship, ships first.
- Feed of recent trades with client-side filters.
- `/congress/members/<bioguide>` — ~700 pages, one per member with data.
- `/congress/tickers/<ticker>` — ~2,500 pages, one per active ticker.

**`/institutional`** — 13F.
- Top-filer pages; ticker → who holds it; biggest quarter-over-quarter moves;
  per-filer portfolio concentration.

**`/financials`**, **`/macro`** — later modules. Shells only.

**`/methodology`** — **treat this as a first-class product surface, not a
footer link.** Per module: sources, license conditions, coverage statistics,
known gaps, caveats. It is the honesty layer made public and it anchors every
launch post. This page is a real part of the pitch.

## Hard technical constraints

- **Astro, static, on Cloudflare Pages.** No backend, no server rendering, no
  database.
- **No browser calls to external APIs.** SEC does not send CORS headers. All
  data arrives as build-time extracts and same-origin JSON shards deployed with
  the site.
- **File budget: ≤15,000 static files** total, pages *and* data shards
  (M1 ≤4,000; M2 ≤1,500 filer pages + aggregate slices). Long-tail entities
  beyond the pre-rendered budget are served by a generic client-rendered route
  fetching same-origin shards. Entities outside the published extract link out
  to the primary source rather than rendering a page.
- **No login. No accounts. No cookies. No tracking.** Cookieless page analytics
  only. Personalization (watchlists, follows) is **localStorage** — no sync, no
  server. This is a stated brand commitment, not an oversight: a
  transparency-first civic-data tool that profiled its readers would contradict
  its own methodology page.
- **Every page footer** carries: prohibited-uses notice (congressional data
  carries a statutory restriction under 5 U.S.C. § 13107(c)), source
  attributions, "not financial advice," and the build ID the page was rendered
  from.
- Accessibility is not optional. This is public civic data.

## What I want from you

1. **A visual system** — type scale, color (including how uncertainty and
   staleness are encoded), spacing, data-table conventions, chart rules.
   Light and dark. State the accessibility contrast basis.
2. **The uncertainty grammar**, as a reusable spec: how a range renders, how
   staleness renders, how truncation renders, how "unclassifiable" renders, how
   provenance is reachable from any number without cluttering it.
3. **High-fidelity screens** for: the `/congress` feed, a member page, a ticker
   page, an `/institutional` filer page, a ticker→holders view, and
   `/methodology`.
4. **Empty, partial, and withheld states.** These are not edge cases here —
   the institutional module can be *deliberately withheld* by a coverage gate,
   and the UI must say so honestly and specifically rather than showing a spinner
   or a shrug. Design that state as carefully as the happy path.
5. **Mobile.** Dense financial tables on a phone is a real design problem;
   don't punt it.

## The bar

This is a public, open-source project I am putting my name on. It should look
like it was built by people who take both the data and the reader seriously —
credible enough that a professional analyst uses it without embarrassment, and
clear enough that a journalist or a citizen can read it correctly on the first
try. Those two audiences are not in tension here; precision serves both.

Ambition is welcome. Decoration is not. Every visual decision should be
defensible in terms of what it tells the reader about the data.
