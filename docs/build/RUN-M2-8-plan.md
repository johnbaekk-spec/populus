# plan-v1: RUN M2-8 — Host and serve the full 13F holdings corpus (reverse M2-CONTRACT §3 Pattern-F)

**Transport mode:** `interactive-disk`. **Scope class: L.**
**Revision 6 — 2026-08-02.** Cumulative: remediates review rounds 2 (21+1), 3 (14),
4 (10), 5 (8+1) and 6 (8+1) from external plan
review (`.codex-review/plan-2.codex.last.txt`; disposition map in
`.codex-review/RESOLUTION-NOTES.md`). **All five owner decisions are now closed**
(owner, 2026-08-02) and appear under Locked Decisions.

---

## Goal and Success Criteria

Serve the institutional 13F corpus as a first-class product: open a filer and see
**every position it reported**, open a ticker and see **every as-of-resolved
institution holding it**, scan a **cross-filer activity feed**, compare a quarter
against **the one before it**, and see positions flagged when they are outsized
against that filer's **own** history.

This reverses the Pattern-F / link-out-to-EDGAR treatment of per-filer holdings in
`M2-CONTRACT.md` §3 and `ARCHITECTURE.md` §5.6.

Success =

1. `/institutional/filers/<cik>` renders the filer's **complete reported position
   list** for the selected period **and the prior period**, so a displayed change
   can be inspected on both sides. Completeness means *as that filer reported it* —
   cross-filer affiliation de-duplication must not silently delete its rows.
2. `/institutional/tickers/<t>/holders` renders **all as-of-resolved** holders,
   with unresolved row and value counts displayed beside the table — never an
   unqualified "all holders" claim at <100% identity coverage.
3. `/institutional` renders a bounded, paginated activity feed carrying issuer,
   `period_of_report`, `filed_date`, and the elapsed reporting lag on every row.
4. Outsized positions are flagged against a **consecutive, fully-admitted** own
   history; any gap yields `awaiting_baseline`, never a flag.
5. Both consumers are actually served: the dashboard from same-origin shards in the
   Pages bundle, and MCP from a manifest-enumerated Release artifact.
6. Worst-case static-file count and per-file bytes are proven under the §12.1 caps
   **including M3's committed reservation, metadata, and spill shards**.
7. The reversal, and every document and artifact that asserted the old rule
   — including the distributed licence text — are reconciled.

---

## Requirements

- **R1** — Decision record reverses §3, stating the reversal in **two separable
  parts**: internal Pattern-R replication (derived from DR-8) and publication of
  the complete position list (an **owner product decision**, not a derivation).
  No unmeasured cost or load claim survives in it.
- **R2** — `M2-CONTRACT.md` §3 and `ARCHITECTURE.md` §5.6 / §10.2 are amended
  additively (strikethrough + replacement). **OQ-9 disposition:** OD-1 selects the
  primary per-filer walk, so bulk datasets are **not adopted as a source** — that
  half is closed; the residual *archival-for-reproducibility* question stays open
  and is recorded as such. R2 does **not** claim OQ-9 is fully closed.
- **R3** — Ingest the **full discovered universe** (OD-2) for every target period
  through the existing `inst_bulk` driver — no second discovery path, no second
  HTTP client. **The universe is discovered and bound per filing quarter, not once**
  (review F2): each period gets its own discovery, its own refs fingerprint, and its
  own journal binding. Filer entry and exit across periods is expected and tested;
  no fixed filer rectangle is assumed. Per-period counts are reported measured.
  **An open quarter is an as-of snapshot**: the current quarter still accretes
  filings, so its universe carries the discovery timestamp and is explicitly
  labelled provisional until the 45-day window closes.
- **R4** — Load **K = 6 periods** (OD-1/OD-4), via the **primary per-filer EDGAR
  walk**. **K must satisfy `K >= MIN_BASELINE_PERIODS + 1`** so the newest period
  has a complete baseline. **K = 6 is fixed for this run** — there is no
  measurement-conditional expansion. Raising K is a new owner decision and a new
  run, because it changes the storage ceiling, the ingest budget, and the flag
  baseline depth together (review F3).
- **R5** — A **serving projection** derived from the canonical store, carrying no
  duplicated per-row provenance strings, but binding **every row to its filing**
  through a per-shard **filing dictionary** (accession, submission type,
  `filed_date`, `period_of_report`, document URL, source) plus a per-row
  `filing_key`. Provenance is compressed, never dropped.
- **R6** — **Directional schemas.** The filer-ordered and issuer-ordered
  projections are distinct. Issuer-ordered rows **must carry a filer key**
  resolving through a filer dictionary; `cik` is only ever implied inside a
  filer-keyed group, never in an issuer bucket.
- **R7** — **Grain separation.** Reported-holding rows and QoQ position-change
  records are stored at their own grains with an explicit reference between them.
  Change fields are never attached to holding rows, so a many-to-one position can
  neither duplicate a delta nor silently absorb source rows.
- **R8** — A **per-filer completeness projection** that applies restatement /
  NEW-HOLDINGS composition but **not** cross-filer affiliation suppression, so a
  filer's page shows what that filer reported. The suppressed view remains the
  basis for cross-entity aggregates. The affiliate relationship is **disclosed**
  on the page rather than resolved by deletion.
- **R9** — **Publication topology, specified end to end.** Dashboard shards ship
  inside the Pages bundle (same-origin, G7). MCP consumes a separate
  **Release-asset serving artifact**, enumerated and hashed in the build manifest
  under the §5.5 protocol. Neither path places bulk data in the git-tracked
  build-scoped small-text area.
- **R10** — **MCP boundary implemented, not merely declared.** `mode='snapshot'`
  serves published per-filer detail for the published universe and periods;
  live-federated `F` is restricted to post-build filings and off-universe filers.
  Both sides are asserted in tests, and the manifest policy requires the new
  artifact.
- **R11** — Filer surface serves the complete position list for the selected
  period **and the prior period** (OD-5), with an explicit added/removed/changed
  view, paginated at exact page-size boundaries.
- **R12** — Holders surface serves **all as-of-resolved** holders, with unresolved
  row count, unresolved value, and coverage displayed beside the table. The word
  "all" never appears unqualified.
- **R13** — A **third, bounded, paginated activity projection** carrying issuer
  display fields and filing dates that `agg_qoq_deltas` does not hold, with
  amendment-aware `filed_date` semantics for composed filings. **Pagination is ONE total, byte-aware
  algorithm** — there is no second selection rule (review r5 F5, r6 F5):

  1. Sort by the total order above (NULL deltas last).
  2. Fill the current page until **either 2,000 records or 2 MiB of *serialized*
     bytes** (measured on the actual emitted JSON, never estimated) — whichever
     binds first — then close it. **No other page size exists**; `{500, 1000, 2000}`
     was a contradictory second rule and is deleted.
  3. Stop when 64 shards are full. Any remainder is **truncated**: the dropped count
     and the boundary record's sort key go to `stats.json` and are stated on the page.
  4. There is no no-candidate case: the byte ceiling always closes a page, and a
     single record exceeding 2 MiB (impossible at this schema) would occupy its own
     page — asserted rather than assumed.

  Tests assert exact page boundaries with no missing or duplicated
  record across the whole ordered set.
- **R14** — A **maximum-single-position-share** metric per (cik, period), distinct
  from the existing combined `topn_share_bps`, since the flag compares against the
  largest single position.
- **R15** — Outsized-position flag per the OD-3 thresholds, over a baseline that is
  **consecutive and fully admitted**: any missing period, `partial_lineage`,
  cover-conflict exclusion, or failed filing in the window yields
  `awaiting_baseline` — never a flag.
- **R16** — Honesty invariants survive: non-removable §5 `data_note`, G3
  never-drop, G4 as-of, NULL-honest integer semantics, and the CSS-fold ban at
  every breakpoint.
- **R17** — The retained federated boundary is stated in the contract and asserted
  on both sides in code and tests.
- **R18** — Every artifact asserting the old rule is reconciled, including
  `src/populus/licenses.json`, the regenerated `DATA-LICENSE.md`, its tests, and
  the user-facing dashboard copy.
- **R19** — A **worst-case** static-file formula — including M1, M2 pages, all
  shard classes, metadata/dictionary files, a **bounded** spill count, and M3's
  committed reservation — is computed, CI-enforced, and fails at the cap; per-file
  bytes are gated at 25 MiB.
- **R20** — The **complete** standing gate set runs green: `make check`
  (= `make test` [pytest + `dashboard-gates`] + `make security`), **`make accept-m1-b`,
  `make accept-m2-5`, `make accept-m2-6`, `make accept-m2-8`** (executable commands,
  not bare target names — review F9), the two-build reproducibility digest, and the
  ≥0.95 value-coverage certification.

---

## Scope

Python: `src/populus/inst_serving.py`, `src/populus/inst_flags.py`,
`src/populus/inst_bulk.py`, `src/populus/inst_agg.sql`, `src/populus/inst_agg.py`,
`src/populus/views.sql`, `src/populus/publish/build.py`,
`src/populus/publish/manifest.py`, `src/populus/client/snapshot.py`,
`src/populus/mcp_server/server.py`, `src/populus/licenses.json`, `src/populus/cli.py`.

Dashboard: `lib/holdings.ts`, `lib/inst.ts`, `components/HoldingsTable.astro`,
the three institutional routes, three shard endpoint families, `test/css-fold.test.ts`.

Docs: the decision record, `M2-8-outsized-position-spec.md`, contract and
architecture amendments, `DATA-LICENSE.md`, `dashboard/README.md`, `STATUS.md`.

## Non-goals

- No change to the canonical `inst_holdings` **schema**, the identity substrate,
  the amendment/supersede machinery, or M2-7 cover-tolerance semantics.
- No change to the 0.95 threshold or certification logic.
- No new data source. OD-1 selects the primary walk, so `sec-13f-datasets` is **not**
  adopted and needs no register entry.
- No prices, returns, sector classification, or index membership — those are RUN
  M2-9 / M2-10.
- No deployment; no commit or push by this plan.

## Constraints

- Cloudflare Pages free tier **20,000 files, 25 MiB/file** (`ARCHITECTURE.md:682`).
  Populus global cap **15,000** counting pages *and* deployed shards, hard CI fail.
  Committed: M1 ≤8,500, M2 ≤1,500 filer pages, **M3 ≤2,000 + ~64 shards**.
- **Ops storage ceiling 40 GB** (OD-4, raised from 20 GB on 2026-08-02 after
  measurement), covering the canonical store *and* raw archives. Measured 20.0 GB
  at 4 periods; K=6 projects ~32 GB.
- **Owner time budget ~15 h** of ingest wall-clock (OD-1).
- SEC ≤2 req/s, SEC-accepted UA, ETag cache, breaker; all HTTP via `SecClient`.
  G7: no browser calls to SEC.
- `populus-data` git tracks build-scoped small text **capped at 5 MB/build**;
  Release assets hold everything else (`ARCHITECTURE.md:123`).
- Exact-integer arithmetic for every published numeric; no float in a digest.
- $0/mo infra.

---

## Current State

**Measured read-only 2026-08-01/02; estimates labelled.**

Published + serving: **build `20260802.2`, pointer v7, 1,810 tests green**, with
M1-E merged and **13/14 eras passing** (`STATUS.md` at HEAD **`cb8bfc5`**); inst
coverage **0.985326** certifiable, `cover_rounding=4`, `cover_conflict=3`.

> **Re-baselined twice (review F18 round 2, F1 round 3).** Revision 1 cited build
> `20260731.1`/v3 from project memory; revision 2 cited `20260802.1`/v6 from a
> local HEAD that was already three commits behind `origin/main`. This revision is
> written against `origin/main` **merged into the working tree** (`cb8bfc5`). The
> lesson is now explicit in the sweep: *this repository moves during planning* —
> fetch and compare against `origin/main`, not local HEAD, immediately before any
> review submission.

**Corpus** (`~/projects/Populus-ops/populus.db`, 821 MB): **one** period
(2026-06-30), 1,013 filings, 1,000 filers, **602,496** `inst_holdings` rows.

| Object | Measured |
|---|---|
| `inst_holdings` table | 590 MB alloc / 546 MB payload — **92.5% packed** (not fragmentation) |
| indexes | 174 MB |
| per-row payload | **~950 B** (≈1,330 B/row all-in with indexes) |
| `raw_row` JSON | 150 MB (avg 261 B/row) |
| all other TEXT | ~22 MB |

The ~950 B is audit envelope — per-row §5.1 provenance, denormalized filing keys,
and a `raw_row` duplicate — which is why a serving projection is derived rather
than the store being published.

**Universe — MEASURED 2026-08-02 by the running T0a discovery** (supersedes every
earlier figure in this plan):

| Quantity | Value | Note |
|---|---|---|
| refs in the 2026q3 form index | **3,913** | was **3,706** on 2026-07-31 — **+207 in two days** |
| ranked filers for `period_of_report = 2026-06-30` | **3,673** (`rank_failed 0`) | this is the OD-2 universe |
| selected | **3,673** | `--top-n 100000` ⇒ no cutoff |
| declared value | **$5.33T** | |
| already loaded from M2-6 | 1,000 | this run adds **2,673** filers |
| positions per filer (from the loaded 1,000) | min 1, **avg 602**, **max 37,140** | |
| distinct CUSIPs / issuer CUSIP-6 blocks | 12,577 / 7,578 | |

> **Three superseded figures, recorded rather than quietly replaced.** (1) Revisions
> 1–2 said *"3,706 filings for 2026-06-30, $6.76T, top-1,000 = 89.59%"* — that summed
> **every** period in the quarterly index. (2) Revision 3 corrected it to *"3,502
> filings / $4.93T"* by filtering the **stale** 2026-07-31 journal. (3) The measured
> value is **3,673 ranked filers / $5.33T**, from a discovery run on 2026-08-02.
>
> **The instructive part is why all three differ:** `refs` (index rows) ≠ `filings
> for the target period` ≠ `ranked filers` (after restatement-survivor selection),
> **and the index itself grows** — +207 refs in two days. An open quarter is a
> moving target. This is exactly why R3 binds a universe **per period with its own
> fingerprint**, why the journal's binding guard correctly refused to resume against
> changed source truth, and why no geometry may freeze on a pre-ingest number (T0b).

**Correction on record:** "8,412 filers" in `docs/design/handoff/Home.dc.html:101`
is mockup placeholder text, not a measurement.

**Existing machinery:** `inst_bulk.py` (1,172 lines — discovery, ranking, resumable
journals, `run_bulk_ingest`); the four `agg_*` tables; all three institutional
routes already shipped (P3-2, `f78376e`) rendering honest empty states;
`e/index.astro` long-tail route; `format.ts` / `filingWindow` dual-date rendering.

**The precise gap:** `dashboard/src/lib/inst.ts` reads only `agg_*` and never
`inst_holdings`; `filers/[cik].astro:6` records why — *"contractually unservable
(M2-CONTRACT §3)"*. The designer had drawn the holdings table
(`Institutional Filer.dc.html`); it was removed solely to obey §3.

### Findings from review round 2 that changed the design

| Finding | Verified | Design consequence |
|---|---|---|
| `v_default_holdings` applies **cross-filer affiliation suppression** (`views.sql:97-103`) | confirmed | A filer page built on it would **silently drop that filer's own reported positions**. R8 adds a non-suppressed per-filer projection. |
| `agg_filer_concentration.topn_share_bps` is a **combined top-N** share (`inst_agg.sql:99`) | confirmed | Wrong statistic for the flag. R14 adds max-single-position-share. |
| `_CoverFacts` (`inst_bulk.py:238`) does **not** retain `table_entry_total` | confirmed | T0a needs a journal extension or re-sweep — cheap, not free. |
| Declared cover entries ≠ admitted rows | measured: 1,017 covers declare **873,819** vs **602,496** stored | Shard geometry freezes on **post-ingest actuals**, never declared totals. |
| `DATA-LICENSE.md` still states holdings are "federated at question time, not replicated wholesale" | confirmed | R18 — a **distributed legal artifact** contradicting the amendment; fix at `licenses.json` source and regenerate. |
| No MCP / snapshot-client / manifest path in revision 1 | confirmed (0 of 30 planned paths) | R9/R10 add them. |

---

## Detected Stack

Python 3.12, `uv` frozen lockfile, `pytest -q`, `click`, SQLite/JSON1, `httpx` only
via `SecClient`. Dashboard: Astro 7 static, Node 24.16.0, `node:sqlite`, `node:test` +
post-build gates. Gates: `make check` = `make test` (`test-python` +
`dashboard-gates`) + `make security`; acceptance targets `accept-m1-b`,
`accept-m2-5`, `accept-m2-6`. No stack-cache block exists (no `CLAUDE.md` /
`AGENTS.md` at root); detected from `pyproject.toml`, `uv.lock`, `Makefile`,
`dashboard/package.json`.

## Reuse Map

| Need | Existing | Decision | Why |
|---|---|---|---|
| Universe discovery, ranking, resumable ingest | `inst_bulk.py` | **Reuse, parameterize** | Already does this at top-1,000; only universe size and the period loop change. |
| Amendment composition | M2-2 restatement / NEW-HOLDINGS machinery, `views.sql` | **Reuse; add one sibling view** | R8's non-suppressed view reuses the composition CTEs and omits only the affiliation predicate. |
| QoQ classification | `agg_qoq_deltas` | **Reuse at its own grain** | Producer-owned; R7 references it rather than flattening it. |
| Concentration | `agg_filer_concentration` | **Extend** | Add max-single-position-share beside `topn_share_bps` (R14); do not repurpose the existing column. |
| Snapshot artifact delivery | `client/snapshot.py`, `publish/manifest.py` (already deliver `congress.db`, `inst_agg.db`) | **Extend** | The Release-asset serving DB is a new entry in a proven mechanism — not a new delivery path. |
| MCP tools | `mcp_server/server.py`, `inst_filer_holdings` modes | **Extend** | `mode='snapshot'` gains published detail; `'detail'` narrows to the federated boundary. |
| Long tail beyond 1,500 pages | `e/index.astro` + §12.1 long-tail rule | **Reuse** | Bounded client-render from same-origin shards already specified and implemented. |
| Dual dates + lag | `lib/format.ts`, `lib/derive.ts` `filingWindow` | **Reuse** | M1 solved filed-vs-transacted; period-vs-filed is the same shape. |
| Budget accounting | `publish/build.py` count-before-freeze + `stats.json` | **Extend** | Add shard classes to the existing hard CI cap. |
| Honesty fold guard | `dashboard/test/css-fold.test.ts` | **Extend, not duplicate** (review F22) | It already owns the honesty-selector mechanism; a second file would fork it. |
| Licence text | `licenses.json` → generated `DATA-LICENSE.md` | **Reuse the generator** | Never hand-edit the generated file. |
| Audit store | `inst_holdings` | **Unchanged schema** | Reshaping would invalidate the reproducibility digest for no product gain. |

New: `inst_serving.py` (no projection layer exists — every consumer reads `agg_*`),
`inst_flags.py` (isolated so the derived-claim definition is independently testable).

## Architecture

### A. Audit store vs serving projection

`inst_holdings` (~950 B/row) stays canonical, ops-local, schema-unchanged, and
**unpublished**; it is reconstructible from archived raw XML plus the deterministic
pipeline. `inst_serving` is derived, integer-only, and carries only served columns.

**Provenance is compressed, not dropped (R5).** Each shard carries a `filings`
dictionary — `{filing_key: {accession, submission_type, period_of_report,
filed_date, doc_url, source}}` — and every row carries `filing_key`. One entry per
filing (1,013 today) replaces 602,496 duplicated strings while preserving the
every-record provenance contract and amendment-aware filed dates.

### B. Three directional projections (R6, R7, R13)

Grains are kept separate; nothing is flattened across them.

| Projection | Bucketed by | Row grain | Carries |
|---|---|---|---|
| **filer** | `cik` | reported holding | security/issuer identity, value, shares, unit type, put/call, `share_bps`, flags, `filing_key`, `position_key` |
| **issuer-holder** | `issuer_key` | **one row per (issuer, period, filer)** — *not* per reported holding (review F6) | **`filer_key` (mandatory)** + filer dictionary; value summed across the filer's securities sharing the issuer; `security_count`; `affiliate_group_key` — **derived, not asserted (review F3)**: within a single
`period_of_report`, build an undirected graph **whose nodes are `cik`s, not filings**
(review r6 F3 — issuer-holder rows are filer-grained, so a filing-node graph leaves
a CIK with several surviving filings undefined). Project every restatement-survivor
filing onto its `cik`; draw an edge between two CIKs when either one's
`file_number_norm` appears in the other's `other_managers`; take **connected
components**; canonicalize each component's key as its lexicographically smallest
`cik`. A CIK therefore belongs to exactly one group per period **by construction**,
regardless of how many base or NEW-HOLDINGS filings it has. It is therefore a *canonical group*, not a
directional coverage edge, and it is recomputed per period (affiliations change).
Tested on: a direct one-way coverage edge, a mutual pair, a chain of three, a
relationship that a restatement removes, and an unaffiliated filer.
**Two sources, deliberately (review F4):** holder *membership* — which institutions reported the issuer — comes from **`v_filer_reported_holdings`**, so every reporter renders even when an affiliate reported the same position; the issuer's **deduplicated total** is computed separately from **`v_default_holdings`**, so the relationship is counted once. The two are stored as distinct fields and never summed into each other. If any component value is undisclosed the row's value is **NULL + `value_undisclosed_component`**, never a partial sum presented as a total. |
| **activity** | period, paginated | QoQ position change | `change_kind`, deltas, issuer display fields, **`filing_keys[]` — an ordered set, not a scalar** (a composed position draws on base + NEW-HOLDINGS amendments), an explicit `filed_date` rule = **max filed_date over the current-period composition**. **Exit provenance, stated exactly (review F5):** an exit has no current-period holding, so its evidence is (a) `prior_filing_keys[]` — the ordered composition that established the position last period — plus (b) `current_filing_keys[]` — the filer's current-period composition **in which the security does not appear**. Absence is only assertable when the current composition is *authoritative-full*, which requires **all** of (review r6 F4): exactly one surviving base 13F-HR for the (cik, period) after restatement resolution — **two or more surviving bases ⇒ not assertable**; every filing in the composition `parse_status = 'parsed'` — any `failed` or `cover_failed` member ⇒ not assertable; no amendment of unknown or unrecognised `amendment_type` in the period; every additive NEW-HOLDINGS amendment successfully parsed (a failed additive could have carried the security); discovery for that (cik, period) completed without `partial_lineage`; and ties on `filed_date` broken deterministically by `accession` ascending, as elsewhere in the codebase. Any unmet condition ⇒ `unclassified` + `exit_not_assertable`. A period whose only current filing is an **additive** NEW-HOLDINGS amendment is **not** authoritative for absence, so the row is emitted as `change_kind='unclassified'` + `exit_not_assertable` rather than as an exit. `filed_date` for an exit = max over (b); lag derived from that |

`position_key` is the explicit reference from a holding row to its
`agg_qoq_deltas` record `(cik, position_key, put_call, ssh_prnamt_type,
curr_period)`. Change fields never ride on holding rows — a position composed from
several reported rows can therefore neither duplicate its delta nor absorb rows.

Both browsable periods (current + prior, OD-5) live **in the same bucket file**, so
OD-5 doubles bytes per shard, not file count.

### C. Publication topology (R9) — both consumers actually served

```
build ──┬─► Pages bundle (dist/)   bucketed JSON shards, same-origin, G7 intact
        │      counted in the §12.1 file cap; each far below 25 MiB
        └─► Release asset  inst_serving.db  (SQLite, one per build)
               enumerated + hashed in manifest.json under §5.5
               consumed by SnapshotClient exactly as congress.db / inst_agg.db are
```

Neither path writes bulk data into the git-tracked ≤5 MB build-scoped small-text
area, so `ARCHITECTURE.md:123` is respected. This resolves review F5: the dashboard
gets same-origin shards *and* MCP gets a manifest-enumerated artifact.

### D. Worst-case file budget (R19) — the proof, not an estimate

```
M1 pages (committed)                        8,500
M2 filer pages (committed budget)           1,500
M2 filer buckets                              512
M2 issuer buckets                             512
M2 activity shards (paginated)                 64
M2 metadata + dictionaries                      8
M2 spill shards (HARD CAP, CI-enforced)        64
M3 committed reservation (2,000 + 64)       2,064
                                          -------
worst case                                 13,224   vs 15,000 cap
headroom                                    1,776
```

Spill is **bounded**: any entity whose row count exceeds the spill threshold gets a
dedicated shard, and the spill count is capped at 64 with CI failing if exceeded —
so the formula is a true worst case, not a typical case. The measured
37,140-position filer is the named spill fixture. Bucket count, spill threshold and
page budget are **re-tuned only from T0b's admitted-row measurements**, never from
T0a's declared upper bound and never from the estimates
below.

### E. Storage and time (OD-1, OD-4)

> ## RESOLVED 2026-08-02 — measured, then re-decided by the owner
>
> **The estimate this section was built on was wrong by ~4x.** Every universe
> figure in earlier revisions came from **2026-06-30 — an OPEN quarter** whose
> 45-day deadline (2026-08-14) had not passed. A **closed** quarter carries
> **~8,800 ranked filers and ~3.3M holdings**, not ~3,670 and ~1.07M.
>
> | Period | Window | Filers | Holdings |
> |---|---|---|---|
> | 2026-06-30 | open | 3,672 | 1,071,954 |
> | 2026-03-31 | closed | 8,792 | 3,355,750 |
> | 2025-12-31 | closed | 8,719 | 3,328,618 |
> | 2025-09-30 | closed | 8,083 | 3,126,843 |
>
> **Measured storage** (4 periods): **13.8 GB db + 6.2 GB raw = 20.0 GB**
> (1,363 B/row db, 613 B/row raw). Each further closed period ~**6.0 GB**.
> K=5 ~26 GB; **K=6 ~32 GB**.
>
> **Owner decisions, 2026-08-02:**
> - **OD-4 AMENDED: ceiling 20 GB -> 40 GB.** 20 GB was a policy number set
>   against the 4x-low estimate; the estimate moved, not the requirement. The
>   volume has 213 GB free, so this is policy, not physics. K=6 leaves ~8 GB.
> - **K = 6 CONFIRMED, and not because "more is better".** With
>   `MIN_BASELINE_PERIODS = 4`, **K=5 makes only the NEWEST period flaggable**.
>   OD-5 makes the **prior** period browsable — so at K=5 a reader opening the
>   prior quarter would find every position `awaiting_baseline`, which reads as a
>   defect. **K=6 is the smallest K giving both browsable periods a complete
>   baseline.** Beyond 6 buys nothing this product surfaces.
>
> **A second, worse defect was found the same day — see E.1 below.**
>
> ### E.1 Identity must be seeded PER PERIOD, or history is unusable
>
> The backfill loaded four periods while only the **2026q2** 13(f) list was
> seeded: `identity bootstrap` seeds "every quarter covering a **loaded** period",
> and at bootstrap time only 2026-06-30 was loaded. `resolve_cusip` is as-of and
> fail-closed (G14), so it correctly returned NULL for every historical holding
> rather than time-travelling to a later list.
>
> **Measured consequence: 0.0% of rows keyed in all three historical periods, and
> corpus value-coverage 5.81% against the 0.95 gate — unpublishable.**
>
> Fixed at **zero SEC transport** (all six quarterly lists were already cached):
> (1) re-ran `identity bootstrap` -> **64,854** intervals seeded for 2025q3,
> 2025q4, 2026q1; (2) repointed NULLs with
> `Populus-ops/ops/m2-8/backfill_security_ids.py`, which resolves each distinct
> `(cusip, period)` pair through **the same `resolve_cusip` the ingest uses** — no
> reimplementation, so the two cannot drift — then applies one `UPDATE..FROM`
> pass: **9,737,050 rows repointed in 164 s**, NULLs 9,818,497 -> 81,447;
> (3) **coverage recovered 5.81% -> 99.862%** (99.2-99.3% of rows, 99.7-99.9% of
> value, every period).
>
> **Two requirements this owes the plan, neither yet an R-item:**
> - **The bootstrap must run AFTER each period loads, not once before.** Now wired
>   into `run-pull.sh` so it cannot be forgotten, but the ordering dependency
>   belongs in the plan and in `accept-m2-8`.
> - **`backfill_security_ids.py` must be productized** as a CLI command with tests
>   before it is relied on again. Its correctness rests on reusing `resolve_cusip`
>   and touching only NULL rows; both need pinning.



Measured 1,330 B/row all-in. Estimated full-universe 1.0–1.3M rows/period:

| K | Canonical + raw archives | 40 GB ceiling |
|---|---|---|
| 6 | **14.0 – 16.4 GB** | **fits both estimates** |
| 8 | 18.6 – 21.8 GB | fits only at the low estimate |

**K = 6 is fixed.** K=8 is *not* a conditional stretch in this run (review F3): a
floating K would leave budgets, rollback and DoD ambiguous. K=6 satisfies
`K >= MIN_BASELINE_PERIODS + 1` (= 5) with one period to spare. **Measured 2026-08-02:
~32 GB against the raised 40 GB ceiling.** K=5 would satisfy the arithmetic but
leave the OD-5 browsable prior period with no baseline — see the RESOLVED block above.

Ingest at ≤2 req/s. **Measured basis** (`ops/m2-6/ingest-journal-2026-06-30.json`):
**4,039 requests for 1,000 filers in 2,055 s** = **4.04 req/filer**, ~1.97 req/s
effective — not the 8.2 req/filer earlier revisions assumed. **Measured discovery**
(2026-08-02): ranking 3,913 refs took **33 min**.

| Stage | Requests | Wall-clock at ~1.97 req/s |
|---|---|---|
| discovery + ranking, per period | ~2 × refs ≈ 7,800 | **≈ 33 min** (measured) |
| ingest, per period, cold | 3,673 × 4.04 ≈ **14,839** | **≈ 2.1 h** |
| **per period total** | ≈ 22,600 | **≈ 2.6 h** |
| **K = 6 periods** | ≈ **136,000** | **≈ 15.5 h** |

The first period is cheaper in practice because 1,000 filers are already loaded and
resume cache-first. This sits at the owner's ~15 h budget (OD-1) and is resumable
across sessions.

### F. Per-filer completeness (R8)

`v_filer_reported_holdings` applies restatement + NEW-HOLDINGS composition and
**omits** the cross-filer affiliation predicate. Filer pages read it;
`v_default_holdings` (suppressed) continues to feed cross-entity aggregates so no
issuer total double-counts. Where an affiliate also reported a position, the page
**discloses the relationship** instead of deleting the row.

### G. The outsized flag (R14, R15) — specified before it is coded

```
share_bps(f,p,i)  = value_usd(i) * 10000 / total_value_usd(f,p)       -- integer
max_share(f,p)    = MAX(share_bps) over f's positions in p            -- R14, new
baseline_max(f,p) = MAX(max_share(f,q)) over the MIN_BASELINE_PERIODS
                    periods immediately preceding p
outsized         := share_bps(f,p,i) > baseline_max(f,p)*MULT/100
                    AND share_bps(f,p,i) >= FLOOR_BPS
```

**Baseline eligibility (R15).** The window must be **consecutive** and every period
in it **fully admitted** for that filer: no missing period, no
`failed:partial_lineage` (`inst_bulk.py:834` treats it as an accounted outcome, so
counting periods alone is insufficient), no cover-conflict exclusion, no failed
filing. Any defect ⇒ `awaiting_baseline` (NULL), never a flag.

Non-negotiable: `total_value_usd <= 0` or NULL ⇒ no share, no flag, no division.
**And a *partially* NULL book is equally ineligible** (review F8): if any holding in
the current period, or in any baseline period, carries a NULL `value_usd`, the
denominator is incomplete, every `share_bps` computed from it is overstated, and
the filer/period yields `awaiting_baseline` rather than a flag. Only books whose
every retained holding has a disclosed value are eligible. Partial-NULL books are
rows in the T2 truth table and in the mutation list.
Further non-negotiables:
integer arithmetic only; the flag is **annotation** — nothing filters, ranks, or
excludes on it; and the label states the comparison ("largest position this filer
has reported in N quarters"), never a judgement. Banned on this surface: "bet",
"conviction", "bullish", "loading up", or any present-tense trading verb.

## Locked Decisions

### Locked — architecture

1. `inst_holdings` is not published and not reshaped; reconstructible from archived
   raw XML.
2. Dashboard data ships **inside the Pages bundle**, same-origin (G7). MCP consumes
   a **Release-asset** serving DB via the existing manifest protocol. Cloudflare R2
   is **not** introduced.
3. Shards are **bucketed**, not per-entity, with a **hard-capped** spill list.
4. Filer and issuer projections have **distinct directional schemas**; issuer rows
   always carry a filer key.
5. Holding and change records keep **separate grains** joined by `position_key`.
6. `agg_issuer_top_holders` is retained for ranking; completeness is added beside it.
7. Amendments to contract and architecture are **additive**; no in-place rewrite.

### Locked — owner decisions (owner, 2026-08-02)

8. **OD-1 — Backfill source: the primary per-filer EDGAR walk.** ~11.7 h at the
   politeness floor for K=6, resumable. SEC bulk datasets are **not** adopted, so
   the commons stays primary-source-only and no new register entry is needed.
9. **OD-2 — Universe: every eligible filer, discovered independently per period.**
   No cutoff, no per-page caveat explaining an omitted tail. **Units matter and
   were previously conflated** (review F2): for 2026q3 the form index yields
   **3,913 refs across all periods** (measured 2026-08-02; it was 3,706 two days
   earlier), which rank to **3,673 ranked filers** for
   `period_of_report = 2026-06-30` after restatement-survivor selection. OD-2
   therefore binds to *"every eligible filer for the period as discovered"*, **not**
   to any hard-coded count — and request and storage
   estimates below are expressed per **target-period filing**, the unit the driver
   actually walks.
10. **OD-3 — Flag thresholds: `MIN_BASELINE_PERIODS = 4`, `MULT = 150`,
    `FLOOR_BPS = 500`.** One year of own history; 1.5× the filer's own prior
    maximum single-position share; a 5%-of-portfolio floor so small books do not
    generate noise.
11. **OD-4 — Ops storage ceiling: 40 GB** *(raised from 20 GB by the owner
    2026-08-02, after measurement showed the original was set against a 4x-low
    row estimate)*, covering canonical store + raw archives. Measured: 20.0 GB at
    4 periods, ~6.0 GB per further closed period, **K = 6 ~32 GB** with ~8 GB
    headroom. K = 6 is fixed (review F3 — no measurement-conditional expansion).
12. **OD-5 — The prior quarter is browsable** (escalated by review F21, which
    correctly found this had been silently locked). A reader can open the previous
    period's portfolio and see **what was added and removed** behind any displayed
    change. Both periods live in one bucket file, so this costs bytes, not files.

## Alternatives Considered

| Alternative | Rejected because |
|---|---|
| Keep Pattern F; deep-link EDGAR | What the owner rejected; also cannot support the activity feed or own-history baselines at all. |
| Per-entity shards | 21,284 files — breaches the 15,000 cap and Cloudflare's 20,000 limit. |
| Publish the canonical store | ~1.3–1.7 GB/period; publishes an audit envelope no reader consumes. |
| One SQLite + WASM range requests | A full-universe period exceeds the 25 MiB/file Pages cap, forcing DB chunking — more moving parts than bucketed JSON. |
| Move serving data to R2 | Real infra, cross-origin surface, new failure mode — to solve a constraint bucketing already solves. |
| Reshape `inst_holdings` to ~250 B/row | Invalidates the reproducibility digest and M2-7 view predicates; the projection wins the same bytes derivatively. |
| Build filer pages on `v_default_holdings` | **Would silently delete a filer's own reported positions** (`views.sql:97-103`) while claiming completeness. |
| Reuse `topn_share_bps` for the flag baseline | Wrong statistic — combined top-N, not largest single position. |
| Count baseline periods without checking admission | `partial_lineage` is an accounted outcome, so gapped history would earn a flag. |
| Bulk datasets for backfill | Rejected by OD-1 — would put a secondary source in a primary-source-only commons. |
| A second fold-test file | Duplicates `css-fold.test.ts`'s mechanism (review F22). |

## Planned Files

**New — Python**
- `src/populus/inst_serving.py`
- `src/populus/inst_flags.py`
- `tests/test_inst_serving.py`
- `tests/test_inst_flags.py`
- `tests/test_inst_shard_budget.py`
- `tests/test_inst_federated_boundary.py`
- `scripts/accept_m2_8.py`
- `tests/test_accept_m2_8.py`

**New — docs**
- `docs/build/M2-8-holdings-publication-decision.md`
- `docs/build/M2-8-outsized-position-spec.md`

**New — dashboard**
- `dashboard/src/lib/holdings.ts`
- `dashboard/src/components/HoldingsTable.astro`
- `dashboard/src/pages/institutional/data/filers/[bucket].v1.json.ts`
- `dashboard/src/pages/institutional/data/issuers/[bucket].v1.json.ts`
- `dashboard/src/pages/institutional/data/activity/[page].v1.json.ts`
- `dashboard/test/holdings.test.ts`

**Modified — Python**
- `src/populus/inst_bulk.py`
- `src/populus/inst_agg.sql`
- `src/populus/inst_agg.py`
- `src/populus/views.sql`
- `src/populus/publish/build.py`
- `src/populus/publish/manifest.py`
- `src/populus/client/snapshot.py`
- `src/populus/mcp_server/server.py`
- `src/populus/licenses.json`
- `src/populus/cli.py`
- `tests/test_mcp_server_inst.py`
- `tests/test_licenses.py`
- `tests/test_inst_bulk.py`

**Modified — dashboard**
- `dashboard/src/lib/inst.ts`
- `dashboard/src/lib/ui.ts`
- `dashboard/src/pages/institutional/index.astro`
- `dashboard/src/pages/institutional/filers/[cik].astro`
- `dashboard/src/pages/institutional/tickers/[t]/holders.astro`
- `dashboard/test/css-fold.test.ts`
- `dashboard/README.md`

**Modified — contract / licence / architecture**
- `docs/build/M2-CONTRACT.md`
- `ARCHITECTURE.md`
- `DATA-LICENSE.md`
- `STATUS.md`
- `Makefile`

## Implementation Tasks

**T0a — Pre-ingest upper bound + storage stop-gate.** *(R3, R19; blocks T4)*
Extend the rank journal to retain `table_entry_total`, discover each period's
universe, and report the **declared** row count per period. This is an **upper
bound, never the admitted count** — measured today, 1,017 covers declare 873,819
entries against 602,496 stored rows. Its only jobs are (a) to refuse the run if the
projected footprint would breach the **40 GB ceiling**, and (b) to size the ingest
budget. **The stop-gate is computed over the whole footprint the owner's ceiling
covers** (review F7): existing on-disk bytes + projected canonical rows × measured
1,330 B/row (table **and** indexes) + **projected raw XML archives**. The raw bound is **not** an observed
average relabelled as a bound (review r5 F7, r6 F7). It is
`p95(bytes per filing over the existing cache) × 1.5`, floored at the observed mean,
and the projection sums: **existing on-disk cache bytes** + projected canonical rows
× 1,330 B (table and indexes) + projected raw archives + the **peak transient
footprint** (canonical and staging copies coexisting at promotion, i.e. the corpus
counted twice at that instant). The gate is a single numeric predicate:
**refuse unless `projected_peak_total <= 34 GB`** (0.85 x the 40 GB ceiling), leaving
6 GB headroom. It refuses; it never truncates. Boundary tests cover a projection
just below and just above 17 GB. **No ingest starts before T0a reports.**

**T0b — Post-ingest admitted measurement, freezes serving geometry.** *(R19;
blocks T7/T8)* After T4 loads a period, measure **admitted** rows from
`v_filer_reported_holdings` and `v_default_holdings`, plus the per-entity row
distribution. **Bucket count, spill threshold and the spill list are frozen from
T0b, never from T0a's declared totals** (review F4 — the earlier single-T0 was
self-contradictory: it claimed an exact count from data that only exists after the
ingest it was meant to gate).

**T1 — Decision record + amendments.** *(R1, R2)* Two-part reversal (derivation vs
owner product decision); no unmeasured load claim. Amend §3, §5.6, §10.2
additively; record the OQ-9 split disposition.

**T2 — Outsized-position spec, reviewed before code.** *(R15)* Integer predicate,
baseline-eligibility rules, `awaiting_baseline` state machine, banned wording, and
a truth table over (eligible / gapped / partial-lineage / cover-conflict history) ×
(NULL / zero / positive total) × change kinds. **APPROVED before `inst_flags.py`.**

**T3 — Licence and copy reconciliation.** *(R18)* Update `licenses.json`,
regenerate `DATA-LICENSE.md`, update `tests/test_licenses.py`, replace the
user-facing assertion at `ui.ts:1016` and the comment at `[cik].astro:6`. Re-run a
repository-wide residue sweep for every phrasing of the old rule.

**T4 — Universe extension + K=6 backfill.** *(R3, R4)* Full universe through
`inst_bulk`; six periods via the primary walk. **Runs against a verified backup
copy**; source DB hashed before and after; only an accepted copy is promoted.
Report measured filers, requests, wall-clock, breaker events, dispositions.

**T5 — Per-filer completeness view.** *(R8)* Add `v_filer_reported_holdings`
(composition without affiliation suppression) beside `v_default_holdings`; leave
the suppressed view untouched for aggregates.

**T6 — Max-single-position-share metric, on the non-suppressed source.** *(R14,
R8)* Add the new column on `agg_filer_concentration` **and switch that table's
per-filer inputs from `v_default_holdings` to `v_filer_reported_holdings`**
(review F5: `build_inst_agg` currently computes concentration from the
affiliation-suppressed view, so a filer whose position an affiliate also reported
would be measured against a book missing its own rows — and the flag baseline
inherits the error). Cross-entity issuer totals keep the suppressed view. Add an
affiliated-filer regression asserting the two sources diverge exactly where
expected. Do not repurpose `topn_share_bps`.

**T7 — Serving projection.** *(R5, R6, R7)* Three directional projections, filing
dictionary + `filing_key`, filer dictionary + `filer_key` for issuer rows,
`position_key` reference; deterministic, integer-only.

**T8 — Publication topology, enumerated through every boundary.** *(R9)* Emit
Pages shards; build the Release-asset `inst_serving.db`; add its manifest entry,
digest and size; extend `publish/build.py` count-before-freeze to all new shard
classes. **`build.py:1952` resolves a single `module_db_artifact`, so a second
inst asset is not an ordinary extra entry** (review F9): this task must carry the
new asset through **preflight resolution, upload, resume/reconcile,
immutable-release verification, rollback, and client installation**, define its
**logical-digest projection**, and add negative tests that mutate or delete the
asset at *each* of those boundaries and assert a fail-closed result.

**T9 — Snapshot client + MCP boundary.** *(R10, R17)* `SnapshotClient` fetches and
verifies the new artifact; manifest policy requires it; `mode='snapshot'` serves
published detail; `'detail'` narrows to post-build / off-universe; both sides tested.

**T10 — Flags.** *(R15)* Implement to the T2 spec; mutation-verify every branch.

**T11 — Filer surface.** *(R11, R16)* `HoldingsTable.astro` + `holdings.ts`; current
**and prior** period with an added/removed/changed view; pagination fixtures at
exact page-size multiples; the 37,140-position filer as the spill/virtualization
fixture. Remove the "contractually unservable" comment; the EDGAR link becomes
provenance.

**T12 — Holders surface.** *(R12, R16)* All as-of-resolved holders with unresolved
row/value counts and coverage beside the table; no unqualified "all".

**T13 — Activity feed.** *(R13, R16)* Bounded, paginated projection with issuer
display fields and amendment-aware `filed_date`; dual dates + lag on every row.

**T14 — Honesty sweep.** *(R16)* Enumerate what each breakpoint drops on all three
surfaces; **extend `css-fold.test.ts`** (not a new file); confirm the `data_note`
and coverage figures render and never fold; record deviations in the register.

**T15 — Budget proof.** *(R19)* Implement the §D worst-case formula in
`test_inst_shard_budget.py` and the CI gate; assert the spill cap and 25 MiB/file.

**T16 — Acceptance + full gate set.** *(R20)* `accept_m2_8.py` end-to-end on the
staging corpus; run **`make check`, `make accept-m1-b`, `make accept-m2-5`,
`make accept-m2-6`, `make accept-m2-8`**, two-build digest equality, coverage ≥0.95.

## Testing Strategy

- **Hermetic** — fake transport, no sockets (autouse guard); committed fixtures.
- **Projection** — determinism; two builds identical; filing dictionary round-trip;
  **an issuer-bucket row without a `filer_key` is a hard failure**; a holding row
  carrying change fields is a hard failure.
- **Grain** — a position composed from multiple reported rows yields exactly one
  change record and loses no source row; composed base + NEW-HOLDINGS amendment
  resolves to the correct `filed_date`.
- **Exit classification (review F4)** — three named fixtures pin the
  authoritative-full rule, asserting the **ordered** `prior_filing_keys[]` /
  `current_filing_keys[]`, the resolved `filed_date`, **and the classification**:
  (a) *base + NEW-HOLDINGS*, security absent from both ⇒ **legitimate exit**;
  (b) *base + RESTATEMENT + a later NEW-HOLDINGS*, security absent ⇒ **legitimate
  exit** (the restatement supersedes; the additive amendment does not weaken
  authority); (c) **NEW-HOLDINGS only**, no base in the period ⇒
  **`unclassified` + `exit_not_assertable`**, never an exit. Mutation: delete the
  authoritative-full check and assert case (c) flips to a false exit.
- **Completeness (R8)** — a filer whose position is also reported by an affiliate
  appears **in full** on its own page while cross-entity issuer totals still count
  it once. This is the regression review F13 identified.
- **Flags** — the T2 truth table; `awaiting_baseline` asserted for gapped history,
  `partial_lineage`, and cover-conflict windows, not merely for short ones; NULL /
  zero totals produce no flag and no division; integer exactness to int64.
- **Mutation verification** — reintroduce each defect and confirm *behaviour*
  changes: drop the `awaiting_baseline` guard; count periods without checking
  admission; swap `max_share` for `topn_share_bps`; apply affiliation suppression
  to the filer view; drop `filer_key` from issuer rows; let a flag feed a filter;
  exceed the spill cap.
- **Budget** — a synthetic full-universe corpus asserts the §D worst-case formula
  including M3's reservation, metadata and the spill cap.
- **MCP** — `mode='snapshot'` returns published detail for an in-universe period;
  `'detail'` refuses or federates outside the boundary; the manifest requires the
  new artifact and verification fails without it.
- **Dashboard** — `node:test` on `holdings.ts` (pagination at exact page-size multiples —
  the blind spot that produced three consecutive P3 defects); prior-period
  added/removed view; `css-fold.test.ts` extended to the institutional surfaces.
- **Licence** — `test_licenses.py` asserts the regenerated text matches
  `licenses.json` and contains no federated-only claim.
- **Real-corpus acceptance** — against a hash-verified backup copy, never the live
  canonical DB.

## Verification Matrix

| Req | Verified by | Evidence |
|---|---|---|
| R1 | T1 review | two-part reversal stated; no unmeasured load/cost claim remains |
| R2 | T1 diff | amendments additive; OQ-9 split disposition recorded, not overclaimed |
| R3 | T0a, T4, `test_inst_bulk` | per-period universes discovered and bound separately; measured counts per period; filer entry/exit tested; `dep_guard` shows no second client |
| R4 | T4 operation log | K=6 loaded; `K >= MIN_BASELINE_PERIODS+1` asserted in code |
| R5 | `test_inst_serving` | every row resolves to a filing via `filing_key`; no duplicated provenance strings |
| R6 | `test_inst_serving` | issuer rows without `filer_key` fail |
| R7 | `test_inst_serving` | multi-row position yields one delta, zero row loss |
| R8 | `test_inst_serving` | affiliate-reported position present on the filer page, counted once in issuer totals |
| R9 | `test_accept_m2_8`, manifest test | shards in `dist/`; Release artifact enumerated + hashed |
| R10 | `test_mcp_server_inst`, `test_inst_federated_boundary` | both sides of the boundary asserted |
| R11 | `holdings.test.ts` | prior period browsable; added/removed correct; pagination at boundaries |
| R12 | `holdings.test.ts` | unresolved counts rendered; no unqualified "all" |
| R13 | post-build gate + `test_inst_serving` | every feed row carries period, filed date, lag; pagination boundaries exact with no missing/duplicate record; the three exit fixtures classify correctly incl. `exit_not_assertable` |
| R14 | `test_inst_flags` | max-share differs from topn-share on a 50%-vs-5×10% fixture |
| R15 | `test_inst_flags` + mutation | truth table green; every mutation killed |
| R16 | `css-fold.test.ts` + T14 | nothing honesty-bearing hidden at 375/720/desktop; `data_note` present |
| R17 | `test_inst_federated_boundary` | post-build and off-universe paths asserted |
| R18 | `test_licenses` + sweep | regenerated licence carries no federated-only claim; zero residue |
| R19 | `test_inst_shard_budget` + `stats.json` | worst-case formula under cap incl. M3, metadata, spill cap |
| R20 | full gate run | `make check`, `make accept-m1-b`, `make accept-m2-5`, `make accept-m2-6`, `make accept-m2-8`, digest, coverage all green |

## Rollout / Rollback

**Rollout.** T0a (pre-ingest bound + stop-gate) → T1/T2/T3 (records, spec, licence)
→ T4 (backfill on a staging copy) → T0b (admitted measurement; freezes geometry) → T5/T6/T7 (views, metric, projection) → T8/T9 (publication + MCP) →
T10 (flags) → T11/T12/T13/T14 (surfaces + honesty) → T15/T16 (budget + gates). The
data stages publish nothing; the first public change is a normal
`populus build` → `publish` under the immutable §5.5 protocol.

**Rollback.** Publication is immutable and pointer-versioned: reverting means
minting a higher pointer generation at the prior build — the existing runbook, no
new mechanism. The dashboard reverts with the build it shipped in.

**Audit-store recovery (review F17 round 2, F14 round 3).** Revision 1 claimed
`inst_holdings` is never mutated. That was **false**: T4 inserts into it. The
procedure, stated executably rather than gestured at:

1. **Pre-flight** — assert free space ≥ 3× the projected post-ingest DB size
   (T0a supplies the projection); refuse to start otherwise.
2. **Stage** — `cp canonical.db staging.db`; record `sha256(canonical.db)` to a
   file; the canonical DB is **never opened for write**.
3. **Ingest + acceptance run only against `staging.db`.**
4. **Integrity before promotion** — `PRAGMA integrity_check` must return `ok`;
   the two-build logical digest must match; `accept-m2-8` must exit 0.
4b. **Install the accepted version durably (review F8).** After acceptance,
   `staging.db` becomes the durable version *before* anything points at it:
   close the SQLite connection cleanly (WAL checkpointed, no `-wal`/`-shm`
   residue), `rename()` it to `corpus-<build_id>.db` on the same filesystem,
   `fsync` that file, write `corpus-<build_id>.accepted.json` carrying its
   sha256 + row counts + gate results, `fsync` that marker, then `fsync` the
   **containing directory** so both names are durable.
5. **Promote with ONE atomic operation.** Two sequential renames are **not**
   atomic — a crash between them leaves the canonical path absent (review F10).
   Instead the corpus is **versioned** (`corpus-<build_id>.db`) and `current` is a
   **symlink** switched by a single `rename()` of a staged symlink over it, which is
   atomic on the same filesystem. Nothing is ever moved out of the way first.
6. **Retain** the previous `corpus-<build_id>.db` until the *next* successful
   promotion; restore = one symlink switch back. A startup recovery check asserts
   `current` resolves to an existing file whose recorded hash matches, and
   re-points it to the newest intact version if not. **Recovery only ever selects a
   version with a valid `.accepted.json` marker whose recorded hash matches the
   file** — an un-accepted or partially installed version is never promotable
   (review F8). After the symlink `rename()`, the containing directory is `fsync`ed
   so the switch survives power loss. Fault injection kills the process at four
   boundaries — before install, between install and marker write, between marker
   and symlink switch, and immediately after — and asserts every outcome leaves a
   resolvable, accepted corpus.
7. **Post-restore verification** — re-run `integrity_check` plus a row-count and
   digest comparison against the retained backup's recorded hash.

The canonical hash recorded in step 2 is re-verified at the end of the run to prove
the source was untouched. If the budget gate fails at T15 nothing is published and
geometry is re-tuned from T0b.

## Simplicity Audit

Minimum coherent design: **two new Python modules, three shard endpoint families,
one new component, one new data reader, five new test files, one acceptance script.**

- `inst_serving.py` — no projection layer exists; folding it into `inst_agg.py`
  would mix cross-filer aggregation with per-row serving.
- `inst_flags.py` — the only module producing a derived claim; isolation is what
  makes its definition reviewable.
- `holdings.ts` + `HoldingsTable.astro` — one reader, one component, shared by the
  filer and issuer surfaces.
- Three endpoint families — filer, issuer, activity. Review F10 established that
  two cannot serve the feed; these are the three orderings the product needs.
- `test_inst_shard_budget.py`, `test_inst_federated_boundary.py`,
  `test_inst_serving.py`, `test_inst_flags.py`, `holdings.test.ts` — one guard per
  constraint that would otherwise erode silently.
- `accept_m2_8.py` + its test — matches the existing `accept-m2-*` pattern.
- **No new fold-test file** — `css-fold.test.ts` is extended (review F22).
- **No new snapshot/manifest mechanism** — the Release-asset path already delivers
  two databases; this adds a third entry.

**Rejected abstractions:** a generic entity-shard framework; a pluggable flag-rule
engine (one rule, specified exactly — an engine makes it less reviewable); a
serving ORM; a second HTTP client; reshaping `inst_holdings`; a parallel fold-test
harness.

## Tech Debt Introduced

- **TD-M2-8-1 — Fixed geometry (512 filer / 512 issuer / 64 activity / spill cap 64).**
  Owner: pipeline. These are **hard maxima, not defaults**: universe growth makes the
  **build fail** rather than silently inflating shards. Impact: a future universe
  large enough to exceed them requires a plan change and a re-proved worst-case
  formula. Removal condition: none — this is the mechanism that keeps the cost
  property honest.
- **TD-M2-8-2 — Two browsable periods, not the full history.** Owner: product
  (OD-5 chose current + prior). Impact: a reader cannot page back beyond one
  quarter in the UI, though flags and aggregates use all six. Removal condition: an
  owner decision to publish more periods, gated on the §D formula.
- **TD-M2-8-3 — `inst_holdings` retains the ~950 B/row audit envelope.** Owner:
  pipeline. Impact: ~2.3–2.7 GB per full-universe period ops-local; K=6 consumes
  a measured 20.0 GB at four periods and ~32 GB projected at K=6, against the 40 GB
  ceiling — leaving ~8 GB, i.e. room for one further period but not two. Removal condition: the store becomes unwieldy **and** a migration is
  shown digest-safe.
- **TD-M2-8-4 — Identity coverage bounds the holders claim.** Owner: product. At
  ~0.95 value coverage the holders page is "all as-of-resolved holders", not all
  holders. Impact: a permanent qualifier. Removal condition: RUN M2-9's issuer
  identity work raises coverage; the qualifier stays until it is 100%.

## Memory Touch-Points

- `~/.claude/skills/_shared/failure-modes.md` — always loaded; sweep below.
- **`reversing-a-reviewed-decision`** — governs T1. Origin traced (`f7985f6`,
  `db8adc2`); property separated from mechanism; the property is now pinned by the
  §D budget proof rather than by refusing to publish. Review F3 forced a sharper
  split still: the derivation and the owner product decision are recorded
  separately.
- **`specify-before-rewriting`** — T2 precedes `inst_flags.py`.
- **`measure-the-mechanism`** — T0a gates the ingest and T0b gates the geometry; the declared-vs-admitted row
  gap (873,819 vs 602,496) is why geometry freezes on post-ingest actuals.
- **`design-handoff-honesty-fold`** — T14; review F22 corrected the approach to
  *extending* the existing CSS-aware guard rather than forking it.
- **`mutation-tests-pin-properties`** — the mutation list.
- **`mockups-are-not-measurements`** — the 8,412 correction; written after citing a
  mockup figure as measured in this same workstream.
- **`verify-against-a-frozen-tree`** — T4/T16 hash the corpus before and after; all
  Current State figures were read-only.
- **`john-baek-profile`** — measured vs estimated labelled throughout; cost, time
  and provider limits stated before being incurred.
- **`populus-project`** — consulted for context, but its published-state figures were
  **stale and produced review finding F18 (round 2), then again F1 (round 3)**;
  current state is re-read from `STATUS.md` at `origin/main` — **build `20260802.2`,
  pointer v7**, 1,810 tests, 13/14 eras.

## Failure-Mode Sweep

- **F0 full-set sweep — ✓.** Three institutional routes; every occurrence of the
  old rule reconciled — `M2-CONTRACT.md` §3 row/size/tool line, `ARCHITECTURE.md`
  §5.6/§10.2/DR-8 note/OQ-9, `dashboard/README.md`, **`licenses.json` +
  `DATA-LICENSE.md`** (missed in revision 1, review F16), `ui.ts:1016`,
  `[cik].astro:6`. Historical run records are deliberately not rewritten.
- **F0 secrets — N/A.** No credential touched; deployment out of scope.
- **F0 verify-don't-assume — ✓.** Provider caps cited from `ARCHITECTURE.md`;
  published state re-read from `STATUS.md` at HEAD after F18; `views.sql:97-103`,
  `inst_agg.sql:99`, `inst_bulk.py:238` and `:834` each inspected before being
  relied on.
- **F1 enumerate all consumers — ✓.** Dashboard, MCP snapshot, MCP federated,
  published aggregate — each has a requirement, a task and a test (R9, R10, R17).
- **F1 exact full gate set — ✓.** `make check` (= `make test` [pytest +
  `dashboard-gates`] + `make security`), `accept-m1-b`, `accept-m2-5`,
  `accept-m2-6`, `accept-m2-8`, two-build digest, coverage ≥0.95 (R20, review F19).
- **F1 units + NULL/awaiting state — ✓.** `share_bps` integer bps;
  `awaiting_baseline` defined over admission, not just count (review F12).
- **F1 re-baseline against the live tree — ✓ (after failing it once).** F18 was a
  genuine miss; state re-derived from HEAD.
- **F1 simplicity audit completeness — ✓.** Every new file enumerated; matches
  Planned Files.
- **F2 full-tree gate scope — ✓ (planned).** `make check` covers the repo.
- **F2 behavioural test validity — ✓ (planned).** Mutation list per property.
- **F2 bulk SQL — ✓ (planned).** Set-based projection over the views, not per-row
  loops over ~1M rows.
- **F2 dead CSS selectors — ✓ (planned).** Extended `css-fold.test.ts` verifies
  against rendered DOM.
- **F3 verify function not liveness — ✓ (planned).** Acceptance asserts rendered
  rows and MCP responses, not that a build completed.
- **F3 doc-drift — ✓.** Amendments additive; STATUS.md updated; licence regenerated
  from source rather than hand-edited.
- **F4 propagation sweep — ✓.** Re-grep after T1/T3 for every phrasing, including
  "federated at question time" and "not replicated wholesale" (the wording that
  defeated revision 1's sweep).
- **F5 transport — ✓.** `plan-v1`; `planned-files.json` regenerated.
- **N/A:** prod-write auth scope (publication is the existing immutable protocol),
  config→settings rename, connection-pooler read-only, RLS/ACL simulation,
  deploy-bridge runbook (deployment out of scope).

## Definition of Done

1. **R1, R2** — decision record states the two-part reversal with no unmeasured
   claim; amendments additive; OQ-9 disposition recorded honestly.
2. **R3, R4** — T0a's declared bound and T0b's admitted counts both reported, **per
   period**, with the universe discovered and bound separately for each filing
   quarter (no fixed filer rectangle); measured requests, wall-clock and
   dispositions; filer entry/exit across periods tested; `K = 6` fixed and
   `K >= MIN_BASELINE_PERIODS+1` enforced in code.
3. **R5, R6, R7** — every served row resolves to its filing; an issuer row without
   `filer_key` fails; a multi-row position yields one delta and loses no row.
4. **R8** — the affiliate regression test passes: a filer's own page shows the
   position, issuer totals count it once.
5. **R9, R10, R17** — shards in `dist/`, Release artifact hashed in the manifest,
   `SnapshotClient` verifies it, both sides of the federated boundary asserted.
6. **R11** — prior period browsable; added/removed correct; pagination correct at
   exact page-size multiples; the 37,140-position filer renders.
7. **R12** — unresolved row count, unresolved value and coverage displayed; no
   unqualified "all holders" string anywhere.
8. **R13** — every activity row carries period, filed date and lag; the byte-aware
   pagination closes pages correctly at both bounds with no missing or duplicated
   record; the three exit fixtures (base+NEW, base+RESTATEMENT+later-NEW, NEW-only)
   classify as exit / exit / `unclassified`+`exit_not_assertable` respectively.
9. **R14, R15** — max-share distinguished from topn-share on the named fixture;
   truth table green; every mutation killed; `awaiting_baseline` renders for a
   gapped and for a `partial_lineage` history, not only a short one.
10. **R16** — fold guard green at 375/720/desktop; `data_note` on all three
    surfaces; deviations registered.
11. **R18** — regenerated `DATA-LICENSE.md` carries no federated-only claim;
    `test_licenses` green; repository-wide residue sweep returns nothing outside
    historical records.
12. **R19** — `stats.json` reports measured worst-case file count and max shard
    bytes inside the §12.1 caps; CI fails at the cap and at the spill cap.
13. **R20** — `make check`, `make accept-m1-b`, `make accept-m2-5`,
    `make accept-m2-6`, `make accept-m2-8`, two-build digest equality and ≥0.95
    coverage all green and reported **measured**.
14. Every figure in the dev notes labelled **measured** or **estimated**; no
    estimate presented as a measurement.
