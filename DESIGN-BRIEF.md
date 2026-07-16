# Populus — Design Handoff Prompt

*Prepared 2026-07-16. Give everything below the divider to a Claude design session. Intended timing: start of Phase P3 (first dashboard build) — usable earlier only for the optional brand/identity piece in §6.*

---

## Who I am and what this is

I'm John Baek — USC Marshall MBA, active discretionary/momentum trader, building a public reputation as a builder + investor/trader. **Populus** is my open financial-data commons: a free, MIT-licensed platform serving US financial disclosure data from primary government sources — congressional stock trades first, then institutional 13F holdings, company financials, and macro. Two consumers: an MCP server (no UI — not your problem) and a **public static dashboard** (your problem). This engagement is a **design-system pass, not a page-design pass** — what you produce at module 1 gets reused across three more modules with near-zero redesign.

Read the governing spec first: `ARCHITECTURE.md` in this repo — especially §2 (scope/thesis), §5.2 (honesty layer), §9.10 and §12 (dashboard surfaces and budgets), §15 (required legal notices). Do not restate it back to me; design against it.

## 1. The product truth your design must express

Populus's entire differentiation is **honesty and provenance**. Competitors bury data caveats; we surface them. This is not compliance chrome to be minimized — it is the brand. Concretely, these are first-class UI citizens and must be *designed*, not footnoted:

- **Dual dates on every trade row.** A congressional trade has a `transaction_date` and a `filed_date` up to 45 days later. Both always show. The lag itself should be legible at a glance (e.g., a days-to-file affordance; late filings visibly flagged). Never present filed as traded.
- **Amounts are ranges, not numbers.** Disclosures give statutory buckets ($1,001–$15,000 … Over $50M). Design a range presentation that stays honest — no fake point precision, no midpoint bars pretending to be values.
- **Provenance on every row.** Every fact links to the government document (PDF/page) it came from. The "receipt" link pattern needs to be unobtrusive but ubiquitous.
- **Published imperfection.** Coverage %, parse failures, unjoined names, "needs OCR" filings, freshness timestamps — shown, not hidden. Design stat/badge components that make a 97% coverage number feel like the trust signal it is.
- **Estimates labeled.** Flow-based "portfolio" views carry a visible estimate label. Amendment-flagged filings carry a visible pending-policy flag.
- **Required notices** (statutory prohibited-uses text, "not financial advice", per-source attributions) have fixed placements: dashboard footer + methodology pages. Design them dignified, not cookie-banner-ugly.

## 2. Structural shape — design once, reuse four times

Every module renders the same four page archetypes. Design the archetypes, not the instances:

1. **Feed** — reverse-chron records with client-side filters (chamber/party/ticker/side for module 1). Dense, scannable, table-first.
2. **Entity page** — a person/fund/company: identity header, activity history, summary stats, caveat note. (Congress member → 13F filer → public company are the same template.)
3. **Instrument page** — a ticker/series: who's trading it, aggregates, time context.
4. **Methodology page** — per-module: sources, license conditions, coverage stats, caveats. This is the launch posts' anchor link; it must look like the credibility asset it is.

Plus a **macro dashboard** archetype arriving at module 4 (yield curve, CPI, employment, COT positioning — chart-heavy, small multiples). Establish chart/data-viz foundations now even though it ships last.

## 3. Audience and tone

Analysts, traders, journalists, civic-data people, and LLM-users who clicked through from an MCP answer. Tone: **institutional civic-data, not fintech-bro, not partisan.** Party affiliation appears constantly in the data (D/R/I) — the palette must render it neutrally and accessibly without the site itself reading red-team/blue-team. Think court-record gravitas with modern data-product ergonomics. The name "Populus" (the people's data) can inform identity.

## 4. Hard constraints

- **Static site (Astro) on Cloudflare Pages. No backend, no accounts, no cookies.** Personalization = localStorage watchlist only ("my members / my tickers").
- **Page budgets are contractual:** global cap 15,000 static files; module 1 ≤4,000. Long-tail entities render client-side on a generic route from data shards deployed with the build — **but only entities within the published extract; out-of-extract entities get a link to the primary source, not a rendered page**. The template must work identically pre-rendered and client-rendered, and needs a designed "we don't render this entity — here's the government source" state.
- **Performance/accessibility is a phase gate:** Lighthouse ≥90 (performance AND accessibility) on feed, entity, and instrument pages. WCAG 2.1 AA. Design within that: system-font-first or one self-hosted family, no heavy hero assets, tables that stay accessible.
- **Light and dark from day one.** Data-dense tables and charts must hold contrast in both.
- **Responsive:** feed and entity pages must genuinely work on phones (journalists share these links); wide tables scroll within their container, never the page.
- **Every claim links out** (provenance) — external-link affordances everywhere without visual noise.

## 5. Deliverables I want

1. **Design tokens** — color (incl. neutral party-affiliation treatment + semantic flags: late, estimate, amendment-pending, needs-OCR), type scale, spacing, elevation; light + dark.
2. **Component inventory with states** — trade-row/table, range-amount display, dual-date display, days-to-file indicator, provenance link, coverage/freshness stat badges, entity header, filter bar, watchlist toggle, caveat/data-note callout, notice footer, empty states (no trades, unparsed filing, unjoined filer), loading states for client-rendered routes.
3. **The four page archetypes** as annotated mockups using module 1 (congressional) content, plus one macro-dashboard concept sketch.
4. **Data-viz foundations** — chart tokens and rules consistent with the honesty posture (ranges shown as ranges; revisions/vintages representable later).
5. **A one-page design-principles doc** future module pages get critiqued against.

Use **clearly-sample data** in mockups (real member names with real disclosed trades are fine — they're public records — but never invent trades and present them as real).

## 6. Optional pre-P3 piece (only if asked separately)

Brand identity: wordmark/logotype for "Populus", favicon, badge styling for the GitHub README, and domain-name input (domain is undecided — OQ-1). The README is launch surface #1 and ships before any dashboard.

## 7. What NOT to do

- No marketing-site fluff (hero videos, testimonial sections, pricing pages — there is no pricing).
- Do not design deferred features: accounts, alerts, payments, hosted APIs, comments, social anything.
- Do not design a trading tool: no buy/sell affordances, no recommendation framing, no performance-chasing gamification. Populus reports disclosures; the design must never imply advice.
- Do not soften, shrink, or bury the honesty elements to "clean up" the UI — if a mockup looks cleaner because a caveat disappeared, it's wrong.
- Don't propose component libraries that fight the constraints (SSR-only frameworks, client-heavy UI kits that tank Lighthouse).

## 8. Reference material

- I can share private screenshots of my other project's cockpit (Project Compass) as *density/layout reference only* — it's a private licensed-data product; nothing from it is copied, branded alike, or cited. Populus should read as its own public, civic thing.
- Incumbent congressional-trade sites exist (capitoltrades.com, unusualwhales.com/politics, quiverquant.com); review them for table-density conventions, then note where their honesty gaps are (single dates, point amounts, no provenance) — those gaps are exactly what our design makes visible.

## 9. Working format

Start with: (1) tokens + the trade-row/table component + the feed archetype — the highest-leverage 20%; critique loop with me on that before going wide. Then the remaining archetypes and inventory. Flag any constraint in this brief that you think is wrong for the goals rather than silently designing around it.
