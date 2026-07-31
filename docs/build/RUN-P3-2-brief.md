# RUN P3-2 — Full frontend from the approved design handoff

**Status:** BRIEF — owner-scoped input to the orchestrate plan phase.
**Prepared 2026-07-30.** Builds on the P3-1 `/congress` feed (base branch
snapshot `feat/p3-congress-feed@0fe8f6f`, commit `edf15f9` + 3 QA rounds).
The complete approved design package is imported at `docs/design/handoff/`
(14 files, from Claude Design project `1edc8435-2597-4222-b30c-647b0a20d66e`).

---

## 1. The task

Implement the remaining public dashboard surfaces in `dashboard/` (Astro,
static, per ARCHITECTURE §12) from the imported handoff. **Read
`docs/design/handoff/HANDOFF.md` first — it is the governing spec for this
run**: design tokens, type scale, the uncertainty grammar G1–G7, chart rules
C1–C7, the route map, search, monetization guardrail, copy tone, and the
definition of done. The `.dc.html` mockups are the source of truth for
layout, spacing, and copy; `support.js` carries their shared logic
(bucket band geometry `B` maps, sample data). Mockups use div grids —
production uses real `<table>` semantics (th scope, caption).

## 2. Scope (routes)

Already shipped on the base branch (do NOT rebuild; refactor only as §3
requires): `/congress` feed, `/legal`, base layout, tokens in
`dashboard/src/styles/global.css`, `dashboard/src/lib/{data,format}.ts`.

This run adds, per HANDOFF.md "Routes & screens":

1. `/` — Home (front door, honesty specimen card, module grid w/ live stats).
2. `/congress/members/{bioguide}` — Congress Member entity page.
3. `/tickers/{ticker}` — unified ticker page (primary).
4. `/congress/tickers/{t}` — congressional deep ticker view.
5. `/institutional/tickers/{t}/holders` — 13F holders deep view.
6. `/institutional/filers/{cik}` — institutional filer page.
7. `/methodology` — per-module sources, coverage from stats.json, notices.
8. `/financials`, `/macro` — module shell placeholders.
9. States S1–S7 from `States - Empty Partial Withheld.dc.html` — ALL of them,
   wired into the routes they belong to (S1 withheld module, S2 out-of-extract
   entity, S3 filter-empty, S4 client-shard skeleton, S5 needs-OCR detail,
   S6 empty watchlist, S7 filing-window-open banner).
10. Header search (client-side prebuilt index, "/" focus, grouped results) —
    see `Ticker Unified.dc.html` masthead.
11. Mobile fold rules from `Mobile.dc.html` — subject to §4 below.

## 3. Shared components, one implementation each

Definition of done requires G1–G7 as shared components: `RangeBand`,
`DualDate`, `FlagTag`, `TerminusRow`, `FootnoteBlock`, `SrcLink`,
`StatBadge`. The P3-1 feed already implements several of these patterns
inline or as local partials — the plan must inventory what exists in
`dashboard/src/` and promote/reuse rather than duplicate. Where the feed
page must be touched to adopt a promoted component, keep the diff surgical:
P3-1 QA work continues on the base branch in parallel and will be merged.

## 4. Standing deviations (owner-decided; do not re-litigate)

Two places where the mockups are wrong and faithful implementation is a QA
blocker (DESIGN-BRIEF §7: "if a mockup looks cleaner because a caveat
disappeared, it's wrong"):

- **The mobile fold must not remove honesty content.** The handoff's phone
  fold `display:none`s filed dates, lag, owner/partial qualifiers, flag
  chips, and provenance links. Before implementing any fold, list what the
  narrow layout drops and check each against DESIGN-BRIEF §1 (dual dates,
  ranges, provenance, published imperfection, labelled estimates). Anything
  on that list folds — re-laid-out, wrapped, or visually-hidden-but-announced
  — never removed (`display:none` removes it from the a11y tree too).
- **`--ink3` fails WCAG AA** at the handoff's 9–12px sizes (3.39:1–3.68:1,
  needs 4.5:1), and the affected text is disproportionately honesty copy.
  Use the corrected value already shipped in `global.css` on the base branch.

Record every such deviation with its measurement in `dashboard/README.md`'s
deviation register (template + three P3-1 entries already there).

## 5. Data honesty in this run

- Zero hardcoded stats: every number renders from the published build
  (`stats.json` + extracts via `dashboard/src/lib/data.ts`). Mockup numbers
  are sample content.
- Institutional data may be thin in the dev extract (M2-6 corpus run is in
  flight). Pages must degrade honestly to the S1/S2 states, not fake breadth.
- Sums of ranges render as ranges; em-dash ≠ zero; undisclosed = hatched;
  inference gets †/‡/§ footnotes that print (G1–G7, non-negotiable).

## 6. Gates

`make test` (pytest via uv, frozen lockfile), `uv run python
scripts/dep_guard.py`, and the dashboard suite (`npm test` in `dashboard/`,
vitest) must be green. Markup-level tests cannot see CSS — the mobile-fold
rule in §4 is a review obligation, and the plan should add markup-visible
assertions where feasible (e.g. honesty elements present in mobile card DOM,
not display-gated out of the fold block).

## 7. Sizing

One orchestrated run, larger than P3-1 (eight routes + states + search vs
one route) but on rails the base branch already laid: tokens, data layer,
formats, test harness all exist. The plan should sequence shared-component
promotion first, then routes, then states/search/mobile.
