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
- **B15 / TD-7 — CLOSED in the pipeline (PR #106, 2026-09-09).**
  `scripts/fetch_ticker_registry.py` fetches `company_tickers.json` from
  www.sec.gov at build time under the existing SEC UA policy (fail-fast,
  floor-checked, atomic, provenance recorded) and `publish.yml` points
  `POPULUS_TICKER_MAP` at it; the absent-path placeholder is gone. The same PR
  runs `populus committees` (B-6) from the cc0-legislators cache and
  `populus sectors` (B-5) from an EDGAR `submissions.json` SIC snapshot
  (`scripts/fetch_sic_snapshot.py`, paced under 10 req/s, 90% coverage floor
  because the ingest full-replaces `issuer_sic`). First production evidence
  lands with the next nightly publish; the dashboard's CI refusal of fixture
  ticker maps stays in force.
- **Holders-table dormancy is not TD-7 alone.** Measured on the 21 GB
  institutional store: 0 of 26,158 securities are entity-resolved and none has
  ever had a candidate proposed — 13F securities are provisional
  `sec:prov:<hash>` identities carrying no ticker observation for the index to
  match. Closing this needs a CUSIP→issuer bridge, which is gated by the
  `cusip-redistribution` counsel question, not by a build input. Fixing TD-7
  alone leaves the per-filer holdings table empty.
- **Tier C (refinement 20260910, R3) supplies 13F tickers without a CUSIP
  bridge:** `src/populus/ticker_mapping_13f.yaml` maps the normalized filed
  (issuer name, title of class) to a reviewed ticker — 1,531 verified rows
  drafted from the closed quarter 2026-03-31, 63.1% of the target set's value
  (top 2,000 keys ∪ everything the 37 notable managers hold), every row
  carrying `verified_date` / `verified_by` / `method`, none inferred. The
  residue and the verification rules are in
  `docs/design/TICKER-MAPPING-13F-COVERAGE.md`; the owner's 50-row spot check
  re-derives from `ticker_mapping_13f.sample.json`. Class-grain holders per
  ticker live in `agg_ticker_holders`.
- **Residual Senate name variants:** ~5.7% of senate rows are name-variant
  filings (`Hagerty, IV, William F`, …) the packaged `aliases.yaml` does not
  cover. Counted and published in `unresolved_names`, never dropped — a
  data-quality follow-up, not a blocker.
- **B46 — 58 one-token Senate exchange cells keep an ambiguous leg.** The
  two-leg fix (PR #152,
  [decision record](architecture/decisions/senate-exchange-ticker.md)) splits a
  `<br/>`-separated cell into the received `ticker` and `exchanged_ticker`.
  When eFD prints a single ticker for an exchange, the source does not say
  which leg it is. It is kept as `ticker`, with `exchanged_ticker` NULL (58
  rows, owner store 20260817.1). Closing it needs another source for the
  missing leg, such as the asset text's "(Exchanged)/(Received)" names
  resolved through the ticker registry.
- **B47 — 5 congress rows still fail the ticker key grammar**
  `^[A-Z0-9][A-Z0-9.:$\-]{0,15}$` (`dashboard/src/lib/derive.ts`).
  - Two are live: Toomey's 2017 received symbols `^MWE` and `^RGP`, kept
    verbatim by owner decision on 2026-10-16.
  - Three are unpublished rows carrying the 18-character option symbol
    `SPY160219P00180000`.
  - Decide whether the grammar admits these shapes or the rows are
    normalized.

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
- **B27 — `congress/data/feed.v1.json` at ~85% of the 25 MiB provider per-file
  cap — DONE 2026-09-14.** The single asset is retired; the corpus is published
  only as the byte-bounded per-year parts under `/congress/data/feed/`, and the
  old path serves a fail-closed tombstone. All three silent-failure requirements
  are implemented and tested in `dashboard/src/scripts/feed-corpus.ts`:
  (1) order is preserved exactly — parts are ordered by the `offset` each part
  declares about itself, never by resolution or array order;
  (2) a partial part set FAILS VISIBLY — a gap in the `offset` chain or a row
  count short of the index's `item_total` throws, and the island renders its
  stated load-failure rather than a short feed;
  (3) the index carries the metadata and part list, the three "full published
  data" strings now point at `/congress/data/` (a script-free page listing every
  part), and `classifyFeedPartsIndex` refuses a stale index exactly as
  `classifyDataset` refused a stale body.
  Contract: `docs/architecture/data-contracts/congress-feed-transport.md`.
  **The binding constraint moves to the per-project FILE COUNT** (17,749 of an
  18,000 self-cap on the 2026-09-13 production deploy), and the largest-asset
  margin is now governed by B22 below, not by congress data.
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

Extracted from the RUN M2-11 T0 findings and QA report. These are the measured
bounds future institutional work inherits, so they survive independently of the
records they came from.

Those records have **not** been deleted, and this section said they had. Owner
gate K2 called for removing the `docs/build/RUN-M2-11-*` family once its durable
content was extracted; the extraction happened, the deletion did not. The 32
files are still tracked because `tests/test_m2_11_qa_bundle.py` reads them from
the tree at runtime — that suite was expected to be deleted by RUN
PUBLIC-SECURITY-HARDENING, which instead kept and parameterized it, and this
program is forbidden to delete a file another run owns. K2 is therefore open,
not closed, and it closes when that suite is retired.

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
- **B48 — the exchanged ticker's page does not list the exchange.** Build
  20261016.3 has 50 rows with an exchanged leg. Each is listed only under its
  received `ticker`: Hagerty's ETRN → EQT row appears on `/tickers/EQT/` but
  not on `/tickers/ETRN/`. The leg is shown as text on the row's asset line
  (`· exchanged ETRN`), and it is deliberately absent from the "Net range"
  holdings rollup. Listing the row on the exchanged ticker's page needs a
  second ticker key per row, not a display change.
- **B49 — the congress feed text filter does not match the exchanged leg.**
  The filter (`dashboard/src/scripts/feed-client.ts`) matches a `ticker`
  prefix and a member-name substring, so filtering for `ETRN` misses the
  ETRN → EQT exchange.
- **B50 — decide whether "Largest buy · Own record" may show a buy that is
  below the filer's own record.** The card ranks by bracket delta and shows the
  top line even when no buy in the window exceeds the filer's previous
  largest. Build 20261016.1 showed Pelosi · BE $1M–$5M, "1 bracket below the
  largest of 216 prior disclosures". The wording is accurate, and the rule
  shipped as approved. The open question is whether to hide the card when the
  best delta is ≤ 0.
- **B51 — TD-1: delete the watchlist storage cleanup on or after
  2027-01-31.** `dashboard/public/theme-init.js` removes the four legacy
  `populus:watch*` localStorage keys on every page load. It exists only to
  clear devices that used the watchlist removed in signals-v3 M1.

## 7. Owner actions and data acquisition

- **B9 — claim the PyPI name** (`populus-mcp 0.0.1` placeholder; verified
  free — bare `populus` is taken).
- **B17 — one owner-run publish fixes `/legal/*`.** The live build predates
  the licenses-generator rebrand: `licenses.render_notice()` emits "Public
  Filings …" while the served `DATA-LICENSE.md`/`NOTICE` still read
  "Populus". The next data publish carries the fix with no code change; it is
  an owner action because it moves the signed pointer.
- **B38 — a two-quarter 13F corpus.** `scripts/acceptance/surfaces.py`
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
- **B52 — the MCP congress tools return only `ticker`.** Since PR #152 that
  field is the received leg of a two-leg exchange, and `exchanged_ticker` is
  not exposed. Adding it changes the tools' output contract, so it needs its
  own version decision.
- **B53 — no model of a member's relationship to the issuer.** Signals rank a
  trade against the filer's own record and committee overlap only. A former
  executive trading the former employer's stock reads as an ordinary trade:
  for example, Alan Armstrong's $5M–$25M WMB sale (Williams Companies,
  Armstrong's former employer) ranks Stands out on size alone. This was out of
  scope for Signals v3, and it needs a sourced relationship dataset before any
  surface can use it.

## 9. Security and supply chain (security audit R2, 2026-09-07)

The R2 audit and its remediation are closed: the fork-to-runner exposure, the
data PAT's on-disk lifetime, the missing ingest ceilings, the response
headers, and eleven secret-scope evasion classes all landed on `main` and were
validated by a supervised production publish. What remains is the residue.

- **B39 — Dependabot #95 (`uv` 0.7.13 -> 0.11.15) cannot merge as opened.**
  `.github/ci/uv-requirements.txt` is `--require-hashes`, so the version and
  all three sha256 digests (manylinux_2_17 x86_64, macOS arm64, sdist) must
  move together, and `publish.yml`'s `UV_PIN` assertion plus
  `tests/test_publish.py` fail on a version-only bump. The failing checks are
  the guard working, not a broken PR. Same applies to every future uv bump.
- **B40 — four other Dependabot PRs open** (astro, mcp, click, the npm-dev
  group). Routine review; no known blocker.
- **B41 — R3 is BLOCKED, and the `main` ruleset is the interim tier.**
  Active today: required status checks (the three `checks.yml` contexts,
  strict), block force-push, block deletion, required linear history, zero
  bypass actors. Absent: the pull-request review rule, because a solo owner
  cannot approve their own change and weakening the count to zero would be
  worse than not having it. Unblocks when a second trusted GitHub account
  accepts write access and its handle is added to `.github/CODEOWNERS`; the
  upgrade procedure and its `jq -e` predicate are in the (unpublished)
  GitHub-security runbook, section 2.
  *Consequence to remember:* `required_linear_history` means merge commits are
  rejected on `main` — squash or rebase only.
- **B42 — two secret-scanning sub-settings silently no-op.**
  `secret_scanning_validity_checks` and `secret_scanning_non_provider_patterns`
  accept a `PATCH` with HTTP 200 and stay `disabled`: they are Advanced
  Security features a free public repository does not have. Core secret
  scanning and push protection ARE enabled. The runbook's R5 postcondition
  asserts all four, so it reports red for a reason no action can clear — fix
  the predicate, or record the exemption in it.
- **B43 — fork PRs cannot merge, by construction.** `checks.yml` carries no
  `pull_request` trigger while a repository-level self-hosted runner exists
  (audit finding C1), so a fork PR's head never reports the three required
  contexts and the ruleset blocks the merge. This is the intended state while
  contributions are closed. Reopening contributions means first moving the
  publish job off a runner attached to this repository — hosted publish, or an
  organisation runner group — not re-adding the trigger.
- **B44 — the runner stays registered while idle (accepted debt, TD-4).**
  The controller wipes and reconstructs its root before every registration, so
  a job lands in a pristine tree; what reconstruction cannot close is
  same-UID persistence outside that root, and the runner being continuously
  available. Window-scoped registration was designed and rejected as
  insufficient on its own: a queued job takes the runner the instant it
  registers, so it only helps while fork runs need approval AND none is
  approved. The durable fix is the same as B43's.
- **B45 — the secret-scope guard is not proven exhaustive.**
  `tests/test_publish.py` kills eleven known evasion classes (dot and bracket
  notation, `toJSON` bulk, dynamic indexing, three `format()` brace/quote
  boundaries, a PyYAML quoted-scalar re-serialization, mixed-case context and
  name, and placement at `container.env` / job `env` / `services.*.env`). It
  is defence-in-depth against a future regression, NOT the control that keeps
  the PAT scoped — that is the workflow structure itself. Seven review rounds
  found seven distinct evasions; assume a twelfth exists.

## 10. Optional process follow-ups

- **B7 — re-run RUN 6 (MCP server) through the orchestrated loop** for
  process parity; the code is merged and green, so this only re-establishes
  the paper trail.
- **B8 — a deeper cross-module adversarial sweep of M1.**

## 11. Launch redesign (#166, live 2026-10-22)

Squash-merged as `c02597e` and published as build 20261022.1 (publish run
39722671491). The record is
[docs/frontend/launch-redesign.md](frontend/launch-redesign.md); the
departures from the mock are in the deviation register in
[dashboard/README.md](../dashboard/README.md). Unless stated otherwise,
"before" is T0 (code 80694e3, data 20261019.2), "after" is the last gated tree
on the same data (67b9a8d; geometry re-run on a1e23dd), and "live" is
20261022.1. B54–B58 are DONE and kept for their measurements; delete each when
a later change re-measures it.

- **B54 — first-load DOM at 390, JavaScript on — DONE.** Before → after (live):
  G000583 13,833 → 1,813 (1,813); ticker AAPL, both tabs, 6,464 → 1,248
  (1,246); `/congress/` 5,341 → 1,648 (1,657); holders AAPL 4,851 → 607 (605);
  P000197 3,474 → 1,643 (1,643); J000289 481 → 138 (138); filer 1067983
  2,768 → 2,741; `/institutional/` 1,679 → 1,678; Methodology 747 → 759
  (752); home 280 → 374 (382); `/signals/` 35,446 → 10,242 (10,422), the one
  route over 3,000 (B59).
- **B55 — page bytes and the file count — DONE.**
  - `/institutional/` HTML 4,166,624 B → 152,259 B (cap 256 KiB). Its inline
    JSON went from 4,025,382 B to 115 B: the directory moved into
    `institutional/data/directory/{n}.v1.json` shards, fetched on the first
    search (live: 0 shards at load, 2 after a search).
  - `/signals/` HTML 1,856,423 B → 1,347,708 B against its 2 MiB budget.
    831,820 B of that is four JSON islands: `mv-list` 458,933, `ov-list`
    278,649, `signal-hits-body` 53,566 and `mv-bank` 40,672.
  - Elsewhere: G000583 662,533 → 321,349 B; `/congress/` 286,757 → 185,768 B;
    filer 1067983 321,838 → 339,779 B.
  - Two pages grew, as TD-L3 declared (B66): ticker AAPL 361,933 → 496,289 B
    (+134,356) and holders AAPL 186,333 → 353,578 B (+167,245).
  - The dist went from 17,818 to 17,822 files against the 18,000 cap, so
    headroom fell from 182 to 178. The directory family is declared at most 8
    files (the `launch-routes` block).
- **B56 — the phone rules, 17 views at 360 / 390 / 430 — DONE but for small
  taps.** Measured with the mock's audit algorithm:
  - sideways tables 35 / 33 / 30 → 0 / 0 / 0, after and live;
  - text under 11px: up to 46% of a view → 0% on every view;
  - small taps 3,367 / 3,366 / 3,366 → 77 / 79 / 72 after, and 74 / 76 / 69
    live.

  SC2's zero is not met. Live at 390 the real misses are Signals Overlap's 30
  13F receipt links (`a.mv-src`, 36×18) and 15 links of 67×19 on the Signals
  Congress tab. The rest are 44 px tall and just short after rounding: five
  264×44 links on `/congress/`, four on Methodology, and the footer's Legal
  link, which counts once on every view.
- **B57 — word gates (SC5, served HTML) — DONE.** Before → after, gate in
  brackets:
  - Congress 632 → 226 [240];
  - one-trade member 324 → 134 [160]; active member 370 → 232 [233, the
    retained-words rule];
  - Signals Congress 289 → 201 [203], Institutional 210 → 204 [212], Overlap
    113 → 104 [110], Playbooks 948 → 669 [680];
  - ticker Congress tab 374 → 198 [206];
  - Institutional 449 → 254 [280 with only its measured retained words, 302
    with its one unmeasured item];
  - Filer 472 → 247 [251]; Holders 318 → 275 [275];
  - stubs 131 / 179 → 42 / 42 [49]; Methodology 5,126 → 5,088 [5,540].

  Two pages pass on less than a measured gate:
  - The ticker Institutional tab reads 598 → 329, against a gate of 306 plus
    retained words. That is 308 without its two ceiling items (ticker-09,
    ticker-11) and 400 with them, so it passes only until those two are counted
    one by one.
  - The home reads 229 → 252. Its gate is the Home A board's count plus 10%,
    and M2 estimated the board at about 307 words without measuring it.
- **B58 — gates by name — DONE.**
  - test:post 15 → 14 failing names, 0 new; R20 (holders) now passes.
  - test:geometry 29 → 14 on a1e23dd, 0 new; 15 of T0's names now pass.
  - test:holders-browser 0 → 0 (34 pass).
  - Live, `playwright.production.config.ts` in each theme: 932 pass / 11 fail /
    69 skip, every failure among the T0.5 live baseline's 23 names; 12 of those
    23 now pass.
  - `docs/maintenance/POST-BUILD-BASELINE.md` has not been re-measured by name
    for the new tree.
- **B59 — `/signals/` is 7,242 elements over the 3,000 budget (D6, owner).**
  It measured 10,242 at first load on 20261019.2 data (10,422 live). By panel:
  Congress 5,149, Institutional 2,751, Overlap 1,661, Playbooks 538, outside
  the panels 143. D6 keeps the 51 triage rows' bodies (4,653 elements) in the
  page. Nothing more is cut without a new owner decision: the triage-row bodies
  or another cut.
- **B60 — `/congress/` has elements outside the viewport on phones.** The live
  audit finds 4 escapes at 390 and 430:
  - the More filters "to date" input (`input.filter-select`, x 306–483) and
    its filter group (16–483);
  - one unidentified unlabelled `div`, at x −209 to 81, with an `a` inside it
    at −196 to 68.

  At 360 two long filed names (`span.filed-name`, BondBloxx) also run to 365.
  Identify the div, then wrap or contain the date row.
- **B61 — accounts are a separate plan (D2).** Not built: sign-up and sign-in,
  the watchlist, the header buttons, member Follow, the home sign-up band, and
  the Account and Watchlist boards. `watchlist-removed.test.ts`,
  `post/watchlist-absent.test.ts` and design-principles §8/§9 stay in force
  until that plan lands.
- **B62 — 13F freshness.** The build holds filings received through
  2026-07-31, so the home's newest closed quarter reads Q1 2026. It is stated
  with its filings-through date. This is an ops and data item, and an owner
  launch precondition.
- **B63 — the advisory sweep fails repository-wide.**
  - pip-audit flags certifi 2026.7.22 (PYSEC-2026-4320) and pillow 12.3.0
    (eight CVEs), so `make security` exits 2 and never reaches `npm audit`.
  - Run alone, `npm audit` flags vite 8.0.0–8.1.5 (three GHSAs).
  - Dependabot #164 (pillow) and #165 (certifi) are open. The fix is its own
    fix(deps) PR.
- **B64 — no Codex round reviewed the redesign.** Three internal reviews of
  8159717 and one fix round replaced the plan's per-milestone Codex rounds. An
  external review now needs a range diff, `80694e3..c02597e` (159 files,
  +20,028 / −3,533). Partition it by risk: the held-rows binder, the central
  table roles, feed paging, and the copy against the honesty pins.
- **B65 — the launch reference boards are not pinned (LD33, R36).** The ten
  `launch-*.dc.html` boards and the launch-board opener in `canvas-compare.ts`
  were never added. The September Congress and Congress Member boards are
  retired from the comparison, so no structural board comparison covers the
  launch layouts.
- **B66 — the plan's declared debt.**
  - **TD-L1:** a quick filter or More filter still downloads the whole feed
    corpus, 31 parts and 23,178,782 B.
  - **TD-L3:** held rows that a no-JS reader reaches ship twice, as the island
    and the `<noscript>` table (B55's two growths).
  - **TD-L4:** there is no WebKit lane, and the plan's VoiceOver check on an
    iPhone is not in the run records.
  - **TD-L5:** the launch boards are compared by structure only (B65).
  - TD-L2 is B59.
- **B67 — owner preconditions the plan left open.**
  - The DATA-LICENSE registers' counsel review (dated "Review by: 2026-10-23")
    must happen before the site is promoted as launched.
  - The insider playbook stays "Needs Form 4" until Form 4 ingest exists.
  - The search-index overrun is B18.3.
