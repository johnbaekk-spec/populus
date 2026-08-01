# RUN M1-B — dev notes

Implementation record for the approved RUN M1-B Phase A plan (R1 … R20). The
Phase A **measured figures** and the owner decision live in
[`RUN-M1-B-phase-a.md`](RUN-M1-B-phase-a.md); this file records how the code was
built, the Phase B sizing, and the runbook actually executed.

---

## 1. What shipped

Four code modules plus reuse/verification:

1. **Shared checkpoint primitive** — `src/populus/ingest/checkpoint.py`
   (`read_checkpoint` / `commit_checkpoint` / `sha256_hex` / `archive_verified`),
   lifted verbatim out of `inst13f`, which now imports them behind its existing
   `_`-prefixed names. One implementation, two callers.
2. **Resumable House PTR fetch + verified-settled eligibility** —
   checkpoint-before-bytes with a per-document `pdfs/<year>/<DocID>.pdf.fetch-meta.json`
   sidecar; a filing is settled only when `raw_path` **and** `response_hash` are
   present **and** the archived bytes re-hash to that value.
3. **Senate submitted-date window seam + fetcher counters** — default-inert
   `submitted_start_date` / `submitted_end_date` through
   `_index_post_body` → `discover` → `run_senate_ingest`, exposed as
   `--submitted-start` / `--submitted-end` on `ingest congress-senate`.
4. **Per-era gate + join-coverage evaluator** — `src/populus/parse_gate.py`, plus
   two additive `stats.json` keys and the `OWNER DECISION REQUIRED` surfacing.

Plus `scripts/accept_m1_b.py` (one assertion body, two modes),
`scripts/phase_a_snapshot.py`, committed era fixtures, and `make accept-m1-b`.

## 2. Gates

| Gate | Result |
|---|---|
| `make test` | **1,727 passed** (baseline 1,645 → **+82**, zero regressions) |
| `make security` | `dep_guard: OK` — no new dependency |
| `make accept-m1-b` | **exit 0**, hermetic, never skips |
| `scripts/accept_m1_b.py --db …` (real corpus) | **PASSED** |

## 3. Mutation verification

Twenty behavioural mutations were applied and reverted; each turned a test red.

| # | Mutation | Caught by |
|---|---|---|
| M1 | settled = `raw_path` only (drop archive verification) | corrupt/missing-archive + fresh-db resume tests |
| M2 | write bytes **before** the checkpoint | the write-ordering + crash-resume tests |
| M3 | drop the non-200 guard | the 404-never-archived test |
| M4 | count retries as plain attempts | the retry-path test |
| M5 | reintroduce a tolerance band for unknown denominators (A8) | the single-unknown-filing test |
| M6 | count unmeasurable filings as measurable | 7 gate tests |
| M7 | flip the `meets_gate` comparison | 4 gate + acceptance tests |
| M8 | include `needs_ocr` in the censuses | gate + stats tests |
| M9 | rank a surfaced era away | the severity-ranking + acceptance tests |
| M10 | omit the surfacing banner | surfacing + acceptance tests |
| M11 | drop `submitted_end_date` from the request body | the end-bound + acceptance tests |
| M12 | hard-code the default body start | the byte-identical-default test |
| M13 | drop a `stats.json` schema key | the schema-`required` test |
| M14 | loosen the feed check to containment | the feed-exactness test |
| M15 | drop the file-budget assertion | the budget predicate + end-to-end over-budget test |
| M16 | skip the manifest sha256 comparison | the tampered-asset test |
| M17 | skip `flag_unresolved_pair_rows` | cross-year pair + acceptance tests |
| M18 | report aggregate join instead of per-era | 5 gate/stats/acceptance tests |
| M19 | count era rows from `transactions` instead of `v_default_transactions` | the default-view join test |
| M20 | revert the M1-only inst-probe guard | the M1-only build test |

M2, M13, M14 and M15 were **not** caught on the first pass. Each gap was a real
one — assertions that pinned an end state rather than the property — and each was
closed with a test that fails under the mutation (write-order spy + crash-resume;
schema-`required` rejection; feed exactness against reorder/truncation; an
end-to-end over-budget run). They are recorded here rather than quietly fixed.

## 4. Phase B sizing — re-derived from measurement

The plan's latency prior (~1 s/request House) is **replaced** by the Phase A
measurement: **301.8 s for 729 requests = 0.414 s/request**, against a 0.25 s
politeness floor (unchanged, in code). Real latency is ~0.16 s on top of the floor.

| Segment | N | Floor | Floor-bound | **Measured-rate estimate** |
|---|---|---|---|---|
| Phase A House 2015 *(executed)* | 728 PTR + 1 index | 0.25 s | ~3 min | **301.8 s measured** |
| Phase A Senate 01/01/2015→03/31/2016 *(not executed)* | `N_win` — **unmeasured**, eFD 503 | 2.5 s | — | `N_win` × ~2.5 s |
| Phase B House 2013–2025 remainder | ~9,500–10,000 PTR + ~11 index | 0.25 s | ~42 min | **~1.1–1.2 h** at 0.414 s/req |
| Phase B Senate 2012→2025 remainder | `N_sen` — measured at operation time | 2.5 s | — | `N_sen` × ~2.5 s → multi-night |

`N_win` and `N_sen` remain **measured-at-operation**, never fabricated. The House
estimate is now grounded: ~10,000 requests × 0.414 s ≈ 69 min, plus per-year index
conditional GETs.

**Storage:** 727 PTRs = 65 MB → the ~10,000-document Phase B remainder is
**~0.9 GB** of archive.

**Resume cost, measured:** re-running a complete era cost **2 requests / 0.9 s**
versus 301.8 s for the first pass, so Phase B is safe to interrupt at any point.
The verified-settled re-hash reads ~65 MB per era per re-run (~0.9 GB across a
full Phase B pass) — the accepted cost of never silently skipping a corrupt
document (LD9/A9).

### Authorization condition

**Phase B was not executed, scheduled, or started by this run.** It begins only in
a subsequent operation authorized by the owner's decision recorded in
`RUN-M1-B-phase-a.md` §8 — including under a clean gate pass, because the brief
makes the decision itself the gate.

## 5. Runbook as executed

```bash
# 1. resolve + verify + snapshot (build 20260724.3)
mkdir -p ops/m1-b
uv run python scripts/phase_a_snapshot.py --data-repo ../populus-data --out ops/m1-b/phase-a.db

# 2. legislators inputs + era term coverage (house 484 / senate 126)
uv run populus ingest members --db ops/m1-b/phase-a.db \
    --from-cache data-cache/legislators --house-index data-cache/house

# 3. House 2015 — 728 PTRs, 301.8 s
uv run populus ingest congress-house --db ops/m1-b/phase-a.db \
    --year 2015 --raw-root ops/m1-b/raw/house

# 4. Senate window — FAILED, eFD 503 (three attempts; see phase-a.md §6)
uv run populus ingest congress-senate --db ops/m1-b/phase-a.db \
    --raw-root ops/m1-b/raw/senate --submitted-start 01/01/2015 --submitted-end 03/31/2016

# 5. member join over the enlarged corpus
uv run populus ingest members --db ops/m1-b/phase-a.db \
    --from-cache data-cache/legislators --house-index data-cache/house

# 6. stats + gate report
uv run populus stats --db ops/m1-b/phase-a.db --raw-root ops/m1-b/raw/house --out ops/m1-b/stats.json

# 7. the same acceptance, on the real corpus
uv run python scripts/accept_m1_b.py --db ops/m1-b/phase-a.db \
    --raw-root ops/m1-b/raw/house --data-repo ops/m1-b/data-repo
```

Read-only cross-checks recorded for reproducing the artifact's figures:

```sql
-- per-era member join (reproduces the rows_joined/rows figures)
SELECT chamber, substr(filed_date,1,4) AS yr,
       COUNT(*) AS rows_total, COUNT(bioguide_id) AS rows_joined
FROM v_default_transactions WHERE source != 'kadoa'
GROUP BY chamber, yr ORDER BY chamber, yr;

-- era term coverage, asserted BEFORE the era join is measured
SELECT m.chamber, COUNT(DISTINCT m.bioguide_id)
FROM members m, json_each(m.terms) t
WHERE json_extract(t.value, '$.start') <= '2015-12-31'
  AND json_extract(t.value, '$.end')   >= '2015-01-01'
GROUP BY m.chamber;

-- per-era paper share
SELECT substr(filed_date,1,4) yr, SUM(parse_status='needs_ocr') paper, COUNT(*) total
FROM filings WHERE chamber='house' AND source='house-clerk' GROUP BY yr ORDER BY yr;
```

## 6. `parser_version` discipline (R8, no parser change this run)

The archive-only reparse path is verified ready and was **not** exercised on the
real corpus (2015 needs no parser extension — it parses at 97.8%). If the owner
later picks option (b):

1. extend `populus.parse.house_ptr` and bump `PARSER_VERSION`;
2. `populus reparse congress-house --db … --raw-root … --parser-version <old>`
   — selects by the previous stamp, reads only the archive, re-stamps and
   re-evaluates, and makes **no** network request;
3. re-run `populus stats` and read the per-era gate block.

A test pins the no-transport property: the reparse reads exactly the archived
file and nothing else.

## 7. Known limitations carried forward

- **The Senate historical era is unmeasured** (eFD 503). One command recovers it;
  nothing was persisted and the watermark cannot have regressed.
- **The live cross-year amendment-pair count is unmeasured** for the same reason.
  The mechanism is proven hermetically, and that distinction is stated wherever
  the figure would otherwise appear.
- **Pre-existing, unchanged:** House ingest covers `FilingType == 'P'` only (no
  annual FD path), and House PTR amendments carry no `supersedes` linkage
  (explicit non-goal).
- The verified-settled re-hash is O(archive bytes) per run. If a future corpus
  makes it hot, the fix is a cached digest sidecar — never a weaker check.
