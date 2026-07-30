# RUN M2-6 — Bulk 13F corpus: filer universe, bulk ingest, first real inst publish

**Status:** BRIEF — owner-scoped input to the orchestrate plan phase.
**Prepared 2026-07-30.** Depends on RUN M2-5 (identity coverage via the SEC
Official 13(f) List) being merged: M2-5 makes the coverage gate *passable*;
this run gives the gate a *corpus* and produces the first published `inst`
module at real breadth.

---

## 1. The problem

Everything between EDGAR and the MCP tools is built and merged (M2-1..M2-5),
but the loaded corpus is the M2-2 acceptance sample: **4 Berkshire filings,
314 holdings** (`tests/fixtures/inst/real/CIK0001067983`). The CLI ingests
per-filer only — `populus ingest inst-13f --cik <CIK>` (repeatable, required
for live) — a deliberate M2-2 conservatism with no bulk path. There is no
filer-universe selection mechanism at all.

The published dashboard/aggregate contract (M2-CONTRACT §, ARCHITECTURE
§12.1) is **top filers, ≤1,500 static pages** plus aggregate slices. "Top
filers" is currently undefined in code.

## 2. Scope

1. **Filer-universe discovery from the EDGAR quarterly form index** (primary
   source, already register-covered under `sec-edgar`): enumerate all 13F-HR
   filings for a target quarter, through the existing `SecClient` only
   (politeness floor ≤2 req/s, UA, ETag cache, breaker — no second HTTP
   client).
2. **Ranking**: fetch cover pages (cheap) for the discovered filers; rank by
   the cover-declared total value; select the top-N universe. N is a plan
   decision bounded by the ≤1,500-page budget and total runtime at the
   politeness floor — state the arithmetic in the plan (filers × requests ×
   floor), don't discover it mid-operation.
3. **Bulk ingest driver**: resumable (journal of per-CIK progress; a crash or
   breaker-trip resumes without refetch or double-load — the M2-2 atomic
   per-filing load already gives idempotency), bounded (explicit universe
   file, never "everything"), observable (progress + per-filer disposition
   counts), and honest about partial completion (a universe member that
   failed is a counted disposition, not a silent gap).
4. **The operation itself**: run the bulk ingest for the selected universe,
   most recent complete quarter first; record wall-clock, request counts, and
   breaker events in the dev notes.
5. **Gate re-measure + publish acceptance** on the real corpus: measured
   value-coverage per period (exact figures, never asserted), `populus build`
   → `publish` with the gate passing → `inst` admitted → M2-4 serving
   lifecycle installs it → `inst_*` tools answer from published data.

## 3. Non-goals (explicit)

- No new data sources and no new register entries (sec-edgar + sec-13f-list
  cover everything here).
- No changes to the gate, its threshold, or the M2-4 serving lifecycle.
- No dashboard pages (P3 handoffs are separate).
- No historical multi-quarter backfill beyond what the plan explicitly
  budgets — one solid current quarter beats five ragged ones; additional
  quarters are a follow-on operation using the same driver.

## 4. Risks / owner decision points

| Risk | Handling |
|---|---|
| Runtime at ≤2 req/s for thousands of filers | plan states the request arithmetic up front; universe size is chosen to fit an overnight window; resumability makes multi-session operation safe |
| Amendment churn mid-quarter (13F-HR/A arriving during the operation) | M2-2 typed-amendment machinery already handles it; the driver just re-visits |
| Affiliated filers double-counting in the ranking step | M2-2 de-dup applies at load; ranking by cover value may over-count pre-load — acceptable for selection, stated in the plan |
| A filer in the universe fails to parse | counted disposition; coverage gate decides publishability, not the driver |

## 5. Gates

`make test` green (no regression vs the current baseline); dep_guard clean;
every behavioural fix mutation-verified; the operation's numbers (filers
attempted/loaded, holdings, coverage per period, publish result) reported
measured in the dev notes; publish acceptance per M2-5's R10 pattern.

## 6. Sizing

One orchestrated run. The code half is M2-1-scale or smaller (a discovery
module + a driver around existing machinery); the operational half is
wall-clock-bound, not code-bound.
