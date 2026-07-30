# RUN M1-B — Congressional historical backfill (2013 → 2025)

**Status:** BRIEF — owner-scoped input to the orchestrate plan phase.
**Prepared 2026-07-30.** Independent of M2; sequenced after the M2 runs only
to keep one orchestrated run in flight at a time (G12 discipline).

---

## 1. The problem

M1's *code* is complete and gate-verified, but the published corpus is **one
partial year**: every active filing is filed in 2026 (312 House PTRs + 53
Senate + 250 kadoa rows; transactions span 2026-01-01 → 2026-07-21; 114
members). The design and product target is the full STOCK Act record — the
feed mock's "rows since 2012" — and both entity-page archetypes are thin
until members have history.

Measured scale from the already-cached House indexes (`data-cache/house/`):

| index year | PTR filings |
|---|---|
| 2015 | 728 |
| 2020 | 733 |
| 2026 (partial) | 312 |

Extrapolated: roughly **~9,500–10,000 additional House PTR filings** across
2013–2025, plus the Senate eFD history (queryable by date range via the
existing watermark DataTables client), plus whatever the kadoa seed already
covers (it is a *seed*, not a source of record — primary documents still get
fetched and parsed; kadoa lineage/crosswalk semantics per §9.6 are already
built).

## 2. The stage gate — measure one year before committing to thirteen

**This is the core of the brief.** The P1 parse gate (≥97% e-file parse) and
the 100% member-join gate were set and measured on the 2026 corpus. Older
eras differ in ways we have not measured: more paper filings (needs_ocr),
different PDF generators, template drift, members who left Congress a decade
ago.

Phase A of the run: fetch + ingest **one historical year (2015 — index
already cached, 728 PTRs)** end-to-end, and report measured: e-file vs paper
mix, parse coverage against the gate, member-join coverage (temporal aliases
must resolve 2015 members — congress-legislators includes historical
legislators; verify, don't assume), amendment-pair behaviour across a year
boundary, and per-era disposition counts.

**Owner decision point after Phase A** (the plan must surface it, not decide
it): if a historical era misses the ≥97% gate, the options are (a) era-scoped
gates honestly published per year in stats.json, (b) parser extensions for
the older template era, (c) accepting a higher needs_ocr share as
counted-not-parsed. Wrong-but-flagged beats silently wrong; excluded-and-
flagged beats fabricated coverage (§5.2, G3, G5).

Phase B (after the decision): the remaining years 2013–2025, House and
Senate, with the same measured reporting per year.

## 3. Scope

1. House: yearly FD ZIP indexes 2013–2025 (2013/2015/2020 already verified in
   M1's Appendix A; 2015/2020 cached), PTR PDF fetch at the politeness floor,
   resumable, provenance sidecars; parse-or-flag through the existing
   pipeline with `parser_version` discipline (§9.3) — a parser change to
   accommodate an old era triggers `reparse`, never a silent fork.
2. Senate: eFD date-range backfill 2012→2025 through the existing session/
   watermark client; paper filings → needs_ocr, counted.
3. Stats: per-year coverage in `stats.json` (the honesty layer §5.2 already
   carries by-chamber-by-year parse coverage — extend the years, keep the
   shape); the dashboard's tiles and the `congress_health` tool pick this up
   with no code change expected.
4. Publish acceptance: build → publish → verify with the enlarged corpus;
   feed/slices regenerate; the ~700-member and ~2,500-ticker page-budget
   assumptions of §9.10 re-checked against the real enlarged entity counts.

## 4. Non-goals (explicit)

- **No OCR.** Paper filings stay needs_ocr — retained, counted, honest
  (§5.2). An OCR capability is its own future contract.
- No new sources, no register changes (House Clerk, Senate eFD, kadoa,
  congress-legislators all have entries).
- No dashboard code (P3 is separate; the feed builds from whatever the data
  layer publishes).
- No amendment-semantics changes (OQ-13 collection continues as data arrives;
  the unresolved-pair rule stands).

## 5. Risks / owner decision points

| Risk | Handling |
|---|---|
| Historical parse coverage below gate | the Phase A stage gate + owner decision point above — the run does NOT proceed to Phase B on a silent miss |
| ~10k PDF fetches at polite cadence | resumable fetcher, multi-session operation; wall-clock arithmetic stated in the plan |
| 2013-era e-file PDFs predate the parsed template | parse-or-flag + golden fixtures per sampled era; disposition counts make drift visible |
| Member join for long-departed members | verify congress-legislators historical file coverage in Phase A; unjoined stays visible-and-flagged (the feed already renders the † path) |
| Senate eFD deep-history pagination behaviour | politeness floors + circuit breaker already built; Phase A includes a Senate year too |

## 6. Gates

`make test` green, dep_guard clean, mutation-verified fixes, measured (never
asserted) per-year coverage figures in the dev notes, publish acceptance on
the enlarged corpus, and the Phase A owner decision recorded verbatim before
Phase B begins.

## 7. Sizing

One orchestrated run for the code + Phase A (fetcher extensions, era
fixtures, per-year stats; M2-2-scale). Phase B is dominated by polite-cadence
fetch wall-clock — an operation run under the Phase A tooling, potentially
across several nights, not additional code.
