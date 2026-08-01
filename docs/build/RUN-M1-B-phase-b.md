# RUN M1-B — Phase B decision record (House historical backfill, full corpus)

Date: 2026-08-01 (operation ran 2026-07-31 22:17 → 23:12 local; publish 2026-08-01 00:11)
Operator: pipeline session (Claude), owner decisions by John Baek in-session.

## 1. Operation — measured

- Scope: House e-file + paper index years **2013–2025** (Phase A had done 2015;
  the run re-covered it idempotently), ingested into `ops/m1-b/phase-a.db`
  with `--raw-root ops/m1-b/raw/house`.
- Result: **12/12 years attempted, failed: none**, 22:17:53 → 23:12:40 (~55 min),
  politeness measured at 0.414 s/request (Phase A instrumentation, unchanged).
- Corpus after Phase B: **60,357 `v_default_transactions` across 8,601 active
  filings** (from 3,911 / 1,469 at the start of the day).

## 2. Per-era e-file parse gate (0.97) — measured, denominators fully known

Every era: `efile_filing_measurable_rate = 1.0` (zero unmeasurable filings) —
these are genuine parse-quality figures, not measurement gaps. Defective rows
are **loaded and flagged**, never dropped; the gate governs certification only.

| Era | e-file rows | clean | rate | status |
|---|---|---|---|---|
| House 2014 | 1,954 | 1,923 | 98.41% | pass |
| House 2015 | 4,039 | 3,952 | 97.85% | pass |
| House 2016 | 4,076 | 3,938 | 96.61% | miss |
| House 2017 | 4,071 | 3,836 | 94.23% | miss |
| House 2018 | 4,506 | 4,202 | 93.25% | miss |
| House 2019 | 5,442 | 5,145 | 94.54% | miss |
| House 2020 | 7,114 | 6,758 | 94.99% | miss |
| House 2021 | 5,657 | 5,475 | 96.78% | miss |
| House 2022 | 3,725 | 3,608 | 96.86% | miss |
| House 2023 | 4,880 | 4,190 | **85.86%** | miss |
| House 2024 | 2,777 | 2,730 | 98.31% | pass |
| House 2025 | 8,205 | 7,657 | 93.32% | miss |
| House 2026 | 2,670 | 2,604 | 97.53% | pass |
| Senate 2026 | 991 | 991 | 100% | pass |

Miss pattern: mid-era House PDF template drift the 2026-calibrated parser
handles imperfectly; 2023 is the outlier. 2013 published no e-file rows
(paper-dominant era; no gate row).

**Owner decision (2026-07-31): publish era-scoped now.** Per-era coverage is
published honestly in `stats.json` (`totals.efile_parse_gate_by_chamber_year_
including_excluded`); a parser-extension run (M1-C) for the 2016–2023 template
era is queued to raise the misses. (Alternatives declined: hold publish for
M1-C; publish passing eras only.)

## 3. Corpus unification — why and how

`phase-a.db` carries no institutional tables; publishing it directly would
have minted a pointer dropping the 983 institutional filers published in
`20260731.1`. Both databases descend from the same published congressional
base, so unification re-ingested the 13 historical years into a backup copy
of the canonical DB (`ops/final/corpus.db`, SQLite backup API, integrity +
exact base-count assertions: 1,469 filings / 3,911 rows / 602,496 holdings).

The re-ingest ran at **zero transport**: the provenance checkpoints are
filesystem sidecars, so a fresh database settles every already-fetched
document from disk through boundary 2 of the provenance-boundary spec —
13 years in 20 minutes, no re-contact with the Clerk. Parity assertions on
the result: `v_default_transactions` = 60,357 (exact), `inst_holdings` =
602,496 (exact), gate block byte-identical figures to `phase-a.db`.

## 4. Publish — measured

- Build **20260801.1**: 4,184 artifacts, logical_digest `123ee3687b57…`,
  congress module + inst module (`e8679d17b0e4…`).
- Inst honesty layer unchanged from 20260731.1: period 2026-06-30 coverage
  98.53% [list], cover_rounding 4 (max delta $12), cover_conflict EXCLUDED 3
  (named in the build log).
- 32 non-conforming ticker slices skipped by the existing name-safety guard
  (preferred-share `$` tickers + `CRYPTO:BTC`); rows remain in the DB and feed.
- Published pointer_version **4** → `20260801.1`; `populus verify` ok
  (4,184 artifacts recomputed).

## 5. §9.10 file budget — breach measured, cap re-decided

The build measured **4,183 files against the ≤4,000 M1 hard cap**. Cause:
the ~2,500-ticker design assumption undercounted the 13-year ticker tail —
**3,856 distinct tickers** (member pages: 321, far under the ~700 assumed).
Dashboard arithmetic: a ticker consumes two pages (unified + deep view), so
full static coverage needs ~8,100 files.

**Owner decision (2026-08-01): raise the cap to ≤8,500 (full coverage).**
Every entity keeps its dedicated page; ~2.4× headroom under the Cloudflare
20,000-file limit; global 15,000 cap unchanged and still binding. A ≤6,000
rank-cut variant and a rollback to v3 were declined. Applied to:
`ARCHITECTURE.md` §9.10 (+ §11/§12 references), `scripts/accept_m1_b.py`
`FILE_BUDGET`, `tests/test_accept_m1_b.py`, and the dashboard
`DEFAULT_ENTITY_PAGE_BUDGET` (3,800 → 8,300, same fixed-route headroom).

## 6. Open items

- **Senate historical**: eFD returned 503 throughout (Phase A record has the
  recovery command); Senate window + per-era decision pending eFD recovery.
- **M1-C**: parser extension for the 2016–2023 House template era, then
  `populus reparse` (never a silent fork) to raise the nine missing eras.
- 2013 era: paper-dominant, no e-file gate row — falls to the same OCR
  backlog `needs_ocr_filings` already counts per era.
