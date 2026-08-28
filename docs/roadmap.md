# Roadmap — open work

Unresolved, current work only, grouped by capability. Completed delivery
history lives in Git history, not here (see the documentation policy in
[README.md](../README.md)). Items carry the measurement that makes them real;
when an item closes, delete it.

Sources consolidated here on cutover (2026-08-27): `BACKLOG.md`, `STATUS.md`,
`docs/build/M2-KNOWN-ISSUES.md`, and the RUN M2-11 T0/QA measurement records.
The original `B`-numbers are retained so existing references stay resolvable.

---

## 1. 13F list-parse correctness (KI-1..KI-4)

Carried open from the M2-5 merge. Full mechanism analysis was recorded in
`docs/build/M2-KNOWN-ISSUES.md` and the draft remediation spec
`docs/build/RUN-M2-5-parse-substrate.md` (both now in Git history only).

- **KI-4 / B1 — coverage is published above 100%. Fix first.**
  `compute_coverage` / `compute_period_coverage` divide unconditionally, so an
  inflated filing *prints* `coverage = 1.2` even though the gate correctly
  fails closed. The only one of the four that needs no malformed input — it
  sits on a live amendment-composition path. Fix: return `coverage = None` for
  an inflated population, keep numerator/denominator for diagnosis, and assert
  that neither corpus nor per-period coverage ever publishes above 1.
- **KI-1 + KI-2 / B2 — the parse substrate.** One defect wearing two faces:
  validation and R5 cross-format identity share a representation that cannot
  serve both. An out-of-domain status cell collapses to `""` — the same
  canonical value as a legitimately blank cell — so R5 can declare two
  *different* files identical (KI-1); and a row damaged before the fixed
  `[67:70]` status slice hides an A/D conflict, seeding a disputed identity
  (KI-2). The A/D conflict rule fires **6–76 times per quarter on production
  data**, so KI-2 sits on an exercised path. **Do not patch these
  individually** — two consecutive review rounds tried, and each fix moved the
  defect. A three-layer remediation spec (verbatim cells → injectively
  canonical R5 substrate → validated records) exists in Git history as
  `RUN-M2-5-parse-substrate.md`; it is a **draft whose design review hung and
  produced nothing** — design-review it before implementing.
- **KI-3 / B3 — the SEC `Total Count` trailer check is optional.** Skipped
  whenever extraction returns `None`, so a regex or typography drift silently
  removes the only independent row-count proof while parse coverage stays at
  1.0. Fix: require and parse the trailer for production PDFs; a
  recognized-but-unparseable trailer hard-fails.
- **B4 — three lower-value findings from the same round:** sidecar value-type
  schema validation (types unchecked, `int()` can leak a raw `TypeError`);
  incomplete replay/migration state snapshots; missing negative tests for
  split resolution returning `NULL`.
- **B5 — standing acceptance obligation: re-run the malformed-row count on
  every newly cached quarter.** KI-1/KI-2 were accepted at merge on a
  measurement, not an argument: across all seven cached SEC files —
  167,083 rows (2025q1 through 2026q2) — `bad_width` and `bad_field` were
  **zero**, so neither defect has a trigger in any list published to date.
  Their failure mode is silent (R5 passes, coverage stays high, a disputed
  identity seeds), so this count is the only alarm. A non-zero `bad_width` or
  `bad_field` on a new quarter means **stop and implement the substrate spec
  (B2)**. Two corollaries from that measurement worth keeping: the 2026Q2 text
  and PDF formats agree at the disposition level (identical accepted/conflict
  counts — independent corroboration of R5), and `rejected_status_conflict`
  fires on real data every quarter.

## 2. Corpus completeness and identity

- **B25 — CI builds lost the historical House corpus; the remedy is a
  decision.** The runner builds a fresh `populus.db` each run, so a CI build
  holds only its settled window: the last local build carried 57,068 House
  rows (2014→2026); the first CI build carried 2,857 (2026 only). Decide:
  seed the runner from the published corpus before ingest (the accumulated
  store becomes an input), or re-run the backfill under CI. A smaller corpus
  is indistinguishable from a quiet week to every gate that exists today.
- **B15 / TD-7 — ticker names are missing site-wide (the honest no-map
  state).** `POPULUS_TICKER_MAP` points at a deliberately absent path on CI
  because `company_tickers.json` exists only on a workstation; the deployed
  site renders `no-map` on ticker surfaces. Chosen, not overlooked — the
  fixture-fallback alternative would ship test data as production truth, which
  the served-tree sweep cannot detect. To close: give the pipeline a real
  registry source (an ingest step under the existing SEC UA policy — **the SEC
  UA must never change** — or a copy committed to `populus-data` and staged as
  a manifest-listed artifact), then point `POPULUS_TICKER_MAP` at it and
  delete the absent-path placeholder in `publish.yml`.
- **Holders-table dormancy is not TD-7 alone.** Measured on the 21 GB
  institutional store: 0 of 26,158 securities are entity-resolved and none has
  ever had a candidate proposed — 13F securities are provisional
  `sec:prov:<hash>` identities carrying no ticker observation for the index to
  match. Closing this needs a CUSIP→issuer bridge, which is gated by the
  `cusip-redistribution` counsel question, not by a build input. Fixing TD-7
  alone leaves the per-filer holdings table empty.
- **Residual Senate name variants:** ~5.7% of senate rows are name-variant
  filings (`Hagerty, IV, William F`, …) the packaged `aliases.yaml` does not
  cover. Counted and published in `unresolved_names`, never dropped — a
  data-quality follow-up, not a blocker.

## 3. Site weight and file budgets

- **B18.3 — the search index is ~3.9× over its declared 128 KiB budget** and
  ships to every visitor on every page: 451,932 B measured 2026-08-12;
  re-measured 506,945 B on 2026-08-18 after the corpus restoration (the growth
  made it worse, not better). A real user-facing weight problem, not
  bookkeeping drift.
- **B18.1/.2 — the file-budget constants encode a configuration decision.**
  `inst_budget.M1_MEASURED_PAGES = 12_442` was measured WITH a ticker map;
  production builds deliberately run without one (TD-7), so the projection and
  the tree cannot both satisfy an equality assertion. Decide which
  configuration the projection is for and say so in the constant's docstring.
  Do NOT simply re-measure into the smaller number — that under-projects
  capacity for the day TD-7 resolves. Do not re-measure at all until the B25
  corpus question is settled, or the outage becomes the baseline.
- **B27 — `congress/data/feed.v1.json` is at ~85% of the 25 MiB provider
  per-file cap** (22,288,548 B on build `20260817.1`; growth ~2 MB/year ≈ 18
  months of headroom, less in an election year). The design is settled and
  measured (owner, 2026-08-18): **shard by year, client fetches all shards**
  (~13 × ~1.5 MB), scheduled after M1. Three silent-failure requirements:
  (1) concatenate newest-year-first so the global order is preserved exactly;
  (2) a partial shard set must FAIL VISIBLY, never render a short feed;
  (3) the index file keeps metadata + `shards: [{year, path, rows}]`, the
  three "full published data" strings change with the shape, and
  `classifyDataset` learns the index shape while still refusing a stale cached
  body.
- **B21 / TD-M2-12-2 — `holders-period-data`** carries the same unbounded
  embed shape M2-12 fixed for filers; bounded in practice by `topn = 25` but
  not gated, so nothing catches it becoming a breach.
- **B22 / TD-M2-12-3 — the changes cap is per-period**, so the embed grows
  ~2 MiB per new quarter (12,979,794 B measured 2026-08-12, roughly six
  quarters of headroom). The R19 margin gate now fails the BUILD when that
  headroom is spent; the removal condition is a byte-bounded shard family for
  changes.
- **B20 — sweep for other `.length`-as-bytes gates.** The Codex F5 fix showed
  a cap measuring UTF-16 code units against a constant declared in bytes; the
  same class may live elsewhere.

## 4. Institutional serving capacity (M2-11 durable measurements)

Extracted from the RUN M2-11 T0 findings and QA report (K2; records now in Git
history). These are the measured bounds future institutional work inherits:

- Corpus at snapshot v1 (23,058,628,608 B, SHA-256 `977a4d24…28124121`):
  9,458 filers · 46,081 filings · 16,922,879 holdings · 6 periods.
- T0-v11 certifying full-corpus derivation, against the 180 s per-phase bound:
  materialization **158.950 s**, aggregate **156.725 s** (4,242,299 filer
  rows; 1,040,547,840 B against a 1,610,612,736 B limit), serving projection
  **123.690 s**; coverage 0.97985; peak RSS ~12.1 GiB. The eager build
  requires a 32-GiB physical-memory preflight and an Astro-only 24-GiB heap.
- Transport-v2 tail geometry: 7,951 tail filers, 54,944 fragments (786,432 B
  target, ≤64 parts, max 18), 2,714 physical shards of 4,096 (max body
  1,048,574 B), one 209,223 B routing index, one v1 fail-closed tombstone;
  zero over-ceiling/route-mismatch/reassembly-mismatch findings.
- Global file projection: **14,553 of 18,000 files → 3,447 files of measured
  headroom.** The 18,000 self-cap is 90% of Cloudflare's 20,000; the next
  breach has no third raise available (see ARCHITECTURE §13.4).
- The performance mechanism worth remembering: a `GROUP BY` over
  `v_default_inst_filings` flips the join order and re-evaluates the
  amendment-reconciliation cascade once per *holding* instead of once per
  *filing* (>240 s vs 0.25 s on a 50-filer pilot). Materializing the view as
  a same-name TEMP table with a `filing_id` index collapses it to 0.48 s with
  exact parity on all seven coverage outputs.

## 5. Deployment and operations

- **B36 — the runner controller conflates "lock contended" with "lock
  unopenable"** and bricks the publish runner until a human notices (~14 h
  lost on 2026-08-23: an `EISDIR` on a stale lock *directory* exited 1, which
  `acquire_lock` maps unconditionally to `refuse lock-held`; 840 cycles
  reported contention with a process that did not exist). The stale directory
  is cleared; the conflation is not. Fix: a distinct exit code for "could not
  open the lock path" mapped to its own `lock-unopenable` refusal. Diagnosis
  without root: `gh api repos/johnbaekk-spec/populus/actions/runners`
  (`status=offline` is the tell), then
  `launchctl print system/com.populus.runner-controller`. A publish still
  queued past ~100 min is not late, it is stuck.
- **B37 — preview verification has no retry for `unavailable`**, so one
  transport timeout discards a 2.5-hour run (observed 2026-08-23; the page
  served 200 in <0.5 s on retry, three for three). The no-retry principle is
  right for production (unverified bytes already serving) and wrong for
  preview, where nothing is serving by construction. Fix: a bounded retry of
  `unavailable` findings **on the preview leg only**; never retry `mismatch`,
  and do not touch the production leg's rules.
- **B16 / TD-4 — decide whether `acknowledge_unrecorded_code_sha` stays.**
  The override clears the R18 live-but-unattested deadlock; it must name the
  exact serving `code_sha`, is `workflow_dispatch`-only, attests nothing, and
  records that a human overrode a gate. Used once (2026-08-08). Keeping it is
  defensible — the deadlock is structural — but an override nobody exercises
  is an override nobody remembers; if it stays it belongs in the §14
  credential/override inventory and the quarterly review.
- **Monitor immutable-settings check gap (D8 of the professionalization
  program).** The monitor does not yet emit an observable record for the
  immutable-releases setting check; the locked contract is a frozen
  `MonitorCheck` (`check="immutable_releases"`,
  `status ∈ {passed, unchecked, failed}`, secret-free detail) reported on
  every evaluation — `unchecked` observable but not an alarm, `failed`
  alarming and exiting 1. Scheduled with the monitor move to
  `src/populus/monitoring/` (Slice 3).
- **The publish cron never fires on time by design tolerance** (nominal
  06:17Z drifts +43 to +100 min). Monitors must key off run existence, never
  the clock.
- **B26 — the two host-bound test skips are load-bearing and unguarded.**
  `test_runner_controller.py` (macOS-only) and `test_m2_11_qa_bundle.py`
  self-skip off their preconditions; if a `pytestmark` is deleted, CI goes
  green on a suite that never ran. A cheap guard: assert both suites are
  collected on Darwin and skipped elsewhere.
- **B23 / B24(ci) — the CI gap should shrink.** A hosted runner proves less
  than `make test` by design (two host-bound suites skip), and
  `npm run test:post` — the R19/R22 file-size gates that would catch a 25 MiB
  breach — runs only where a real `POPULUS_BUILD_DIR` exists. Wire the
  post-build gates publisher-side, where the data already is.
- **B29 — `production dist has NO institutional fixture routes (Locked #19)`
  cannot pass in the configuration the geometry lane requires.** The test
  asserts the DEV build withholds the institutional module; geometry work
  builds the PRODUCTION configuration where 1,500 filer pages are legitimate.
  Either the test learns the build mode and skips loudly in the other, or the
  geometry lane gets its own staged dev build. A configuration conflict, not
  a leak (verified 2026-08-18).

## 6. Frontend polish

- **B30 — at 360px the member name is squeezed to 8px** by a `flex-shrink: 0`
  ticker cell inside the folded line 1 (`.cell-ticker` takes 194px of a 294px
  line for a long fund name). Pre-existing, measured, deliberately not folded
  into R7. The fix is a judgement call: letting the ticker shrink truncates
  40-character fund names (R5's boundary case); moving it to line 2 changes an
  approved mobile grammar.

## 7. Owner actions and data acquisition

- **B9 — claim the PyPI name** (`populus-mcp 0.0.1` placeholder; verified
  free — bare `populus` is taken).
- **B17 — one owner-run publish fixes `/legal/*`.** The live build predates
  the licenses-generator rebrand: `licenses.render_notice()` emits "Public
  Filings …" while the served `DATA-LICENSE.md`/`NOTICE` still read
  "Populus". The next data publish carries the fix with no code change; it is
  an owner action because it moves the signed pointer.
- **B38 — a two-quarter 13F corpus.** `scripts/accept_alpha_surfaces_v2.py`
  runs, preflights every artifact, asserts registry coverage 113/113, and
  then correctly REFUSES to certify: a quarter-over-quarter delta needs two
  adjacent quarters and every local release carries at most one. The script
  refusing is the script working; end-to-end leaderboard coverage is proven
  by the two-period integration test in `tests/test_issuer_adds.py` (a
  fixture, not the corpus). Needs owner-acquired data.

## 8. Modules and surfaces (deferred by design; one module at a time, G12)

- **B12 — M3, company financials.**
- **B13 — M4, macro.**
- **B14 — remaining P3 dashboard surfaces** beyond the shipped set.

## 9. Optional process follow-ups

- **B7 — re-run RUN 6 (MCP server) through the orchestrated loop** for
  process parity; the code is merged and green, so this only re-establishes
  the paper trail.
- **B8 — a deeper cross-module adversarial sweep of M1.**
