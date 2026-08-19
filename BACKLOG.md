# Populus — backlog

**As of 2026-07-31**, on `main` @ `f78376e`. Consolidates the older `STATUS.md`
"Pending" list with everything carried open out of M2. Ordered by priority
*within* each section; sections are ordered by kind, not urgency.

**Shipped:** M1 (congressional trading, 6 runs) · M2 (institutional 13F, 6 runs
— identity coverage 0.9996, `inst` serving) · P3-2 (public dashboard frontend)
· **P3-3a/P3-3b — `publicfilings.org` live 2026-08-08 with a signed,
independently-verifiable deployment record.**
**In flight:** RUN M1-B (congressional 2013–2025 backfill).

---

## 0. LIVE OUTAGE — the member identity layer (found 2026-08-14)

- [x] **B24 — every `/congress/members/<bioguide>` route 404s in production, and
      has since build `20260807.1`.** Found while running the UX-overhaul
      preconditions; live (`20260814.1`) serves 17,065 congressional rows with
      **zero** member pages, so no disclosure on the site can be attributed to
      a person and every member search hit is a dead link.

      **Root cause.** `apply_member_join` (`members.py:645`) is the ONLY writer
      of `transactions.bioguide_id`, and it runs solely inside
      `populus ingest members`. `publish.yml` ingested house and senate and
      never members — it never has. Local builds worked only because the
      owner's store already held a roster from a manual run; the runner builds a
      FRESH `populus.db` every time, so the first fully CI-built release
      (`20260807.1`) shipped an empty `members` table and NULL bioguide ids.
      `ingest members` is offline-only by design and reads
      `data-cache/legislators/`, which is in `.git/info/exclude` — so CI had no
      possible source for the roster either.

      **Why nothing caught it.** The slice loop at `build.py:2649` iterates
      `WHERE bioguide_id IS NOT NULL`; with zero joined rows it runs zero times,
      writes no artifact and raises nothing. `stats.json` even published the
      evidence — 210 `unresolved_names` — and no gate read it. The dashboard
      post-build suite DOES fail on the missing tree, but `npm run test:post`
      never runs in CI (it is behind `build:bounded`'s 32 GiB floor), so the
      only red was invisible.

      **Fixed here (2026-08-14), pending an owner publish:**
      `scripts/fetch_legislators_cache.py` fetches the CC0 roster
      (`cc0-legislators`, already in the §15 register) with validation that
      refuses a truncated or non-roster body; `publish.yml` gains an
      "Ingest members (identity join)" step between the ingest and stage-build;
      and `stage_build` takes a DECLARED `expect_member_join` — permissive by
      library default so synthetic test builds keep working, declared `True` by
      both production CLI call sites — which REFUSES a build carrying rows with
      zero joins. Measured on a copy of the shipped `20260812.1` store:
      **0% → 95.2% of rows joined** (house 100%, senate 94.31%), 156 members,
      and the production `populus build` emits 156 member artifacts where it
      previously emitted none and exited 0. The same command against the
      unrepaired store now exits 1.

      **Still open:** the residual senate 5.7% is name-variant filings
      (`Hagerty, IV, William F`, `Manchin, III, Joseph`, …) that the packaged
      `aliases.yaml` does not cover. They are counted and published in
      `unresolved_names`, never dropped — a data-quality follow-up, not a
      blocker. **The live site stays broken until the owner runs a publish
      cycle**; no code change can deploy itself.

- [ ] **B25 — the same root cause, bigger: CI builds lost the historical House
      corpus.** Found alongside B24 and NOT fixed here, because the remedy is a
      decision rather than a missing step.

      The runner builds a fresh `populus.db` every run and the House ingest
      fetches its settled window, so a CI build holds only what that window
      returns. The owner's local store had accumulated 14 House ingest runs plus
      the RUN M1-B backfill. Measured:

      | | House rows | Senate rows |
      |---|---|---|
      | `20260802.2` (last local build) | 57,068 (2014→2026) | 991 |
      | `20260812.1` (CI) | 2,857 (2026 only) | 14,198 |

      So the move to CI dropped ~54,000 historical House disclosures from the
      published site (live currently reports 17,065 rows) while gaining Senate
      history the local store never had. Nothing warned: a smaller corpus is
      indistinguishable from a quiet week to every gate we have.

      **Decide:** seed the runner from the published corpus before ingest (the
      accumulated store becomes an input, not a by-product), or re-run the
      backfill under CI. Until then the site is missing a decade of House
      filings.

      **Consequence for B18 — do not re-measure the file-budget constants yet.**
      `M1_MEASURED_PAGES = 12_442` was measured on the full local corpus; the
      current tree measures 5,634 M1 files / 5,746 total *because* of this
      outage. Re-measuring now would encode the outage as the baseline, which is
      the exact error B18 already warns against. Both constants stay stale, and
      the three post-build file-budget tests stay red, until the corpus question
      is settled — then measure once, on a restored tree.

---

## 1. Correctness — carried open from M2

Full detail, reproductions and file:line: [`docs/build/M2-KNOWN-ISSUES.md`](docs/build/M2-KNOWN-ISSUES.md).

- [ ] **B1 · KI-4 — coverage is published above 100%.** An over-counting
      amendment composition makes an inflated filing *print* `coverage = 1.2`.
      The gate correctly fails closed; the **published number** is wrong.
      **Do this one first.** It is the only M2 finding that needs no malformed
      input — it sits on a live path — and a ratio above 100% directly
      contradicts the project's premise of calibrating trust in numbers.
      *Fix:* return `coverage = None` for an inflated population, keep
      numerator/denominator for diagnosis, assert corpus **and** per-period
      coverage never publish above 1.

- [ ] **B2 · KI-1 + KI-2 — the parse substrate.** An invalid status cell
      collapses to the same canonical value as a blank one, so the R5
      cross-format gate can declare two *different* files identical (KI-1); and
      a row damaged before the fixed `[67:70]` status slice hides an A/D
      conflict, seeding a disputed identity (KI-2). One defect wearing two
      faces: validation and R5 identity share a representation that cannot serve
      both. **Do not patch these individually** — two consecutive review rounds
      tried, and each fix moved the defect.
      *Fix:* implement [`docs/build/RUN-M2-5-parse-substrate.md`](docs/build/RUN-M2-5-parse-substrate.md)
      — **but design-review it first; its review hung and produced nothing.**

- [ ] **B3 · KI-3 — the SEC `Total Count` trailer check is optional.** Skipped
      whenever extraction returns `None`, so a regex or typography drift
      silently removes the only independent row-count proof while parse coverage
      stays at 1.0. *Fix:* require and parse the trailer for production PDFs;
      a recognized-but-unparseable trailer hard-fails.

- [ ] **B4 · Three lower-value round-2 findings.** Sidecar value-type schema
      validation (types unchecked, `int()` can leak a raw `TypeError`);
      incomplete replay/migration state snapshots; missing negative tests for
      split resolution returning `NULL`.

- [ ] **B5 · Re-measure malformed-row counts on every newly cached quarter.**
      B2 was accepted on a measurement — 167,083 rows across all seven cached
      SEC files, **zero** malformed. That is what makes KI-1/KI-2 latent rather
      than live. Their failure mode is **silent** (R5 passes, coverage stays
      high, a disputed identity seeds), so this count is the only alarm.
      A non-zero `bad_width` or `bad_field` means stop and do B2.

## 2. Process

- [ ] **B6 · Check what a review actually examined before trusting its verdict.**
      M2-5 round 2 returned *APPROVED, zero findings*; an independent
      code-scoped review of the same commit returned *2 blockers, 6 majors* and
      re-graded the round-1 fixes as 10 fixed / 5 partial / 1 not-fixed. The
      difference was scope: the approving round spent its budget on harness
      bundle provenance and never read the implementation. Scope reviews to the
      code and put harness/CI provenance explicitly out of scope.

- [ ] **B7 · (Optional) Re-run Run 6 through orchestrate for process parity.**
      Code is merged and green; this only re-establishes the plan→review→QA
      paper trail the other runs have.
      ```bash
      cd ~/projects && ORCH_ASSUME_YES=skip-human-gate ORCH_PROFILE=quality WORKFLOW_MAX_ARTIFACT_BYTES=8388608 \
        ./orchestrate-tool/orchestrate.sh Populus "Re-validate RUN 6 (MCP server, already implemented under src/populus/mcp_server/) per docs/build/RUN-6-brief.md; ARCHITECTURE.md governs (§9.9, §11); tests green under 'uv run pytest -q'."
      ```

- [ ] **B8 · (Optional) Deeper cross-module adversarial sweep of M1.**

## 3. Owner actions — outward-facing, P0

These are **yours, not an agent's**: they involve account credentials and a
naming decision.

- [ ] **B9 · Claim the PyPI name.** Publish the `populus-mcp 0.0.1` placeholder.
- [ ] **B10 · Pick the domain (ARCHITECTURE OQ-1).** `populusfinance.com`
      collides with Populus Financial Group; candidates are in ARCHITECTURE.

- **Publish a data build to fix `/legal`** (B17). `licenses.render_notice()` now
  emits "Public Filings" while the live build `20260812.1` still carries
  "Populus", and `publish/build.py` renders both files through that generator —
  verified 2026-08-13. One publish, no code. It moves the signed pointer and cuts
  a public release, which is why it is here and not done.
- **Tear down the session's worktrees** (owner-only per the worktree rule):
  `.claude/worktrees/{rebrand, inst-changes-bound, licenses-rebrand,
  baseline-7ce271d}` plus the gitignored `.claude/worktrees/populus-data`
  symlink, which exists so `../populus-data` resolves for gates run from inside a
  worktree. Run the D6 proof before removing any of them.

## 4. Roadmap — deferred by design

One module at a time (G12).

- [ ] **B11 · RUN M1-B** — congressional 2013–2025 backfill. *(in flight)*
- [ ] **B12 · M3** — company financials.
- [ ] **B13 · M4** — macro.
- [ ] **B14 · P3 remaining dashboard surfaces** beyond the P3-2 frontend.

---

## 5. Carried open from RUN P3-3b (site went live 2026-08-08)

`publicfilings.org` is live and serving an **attestation-verified** build:
generation 1 for `20260808.1`, 5379/5379 files swept, `verification_scope:
expected_paths`. Twelve runs; ten first-contact defects, all fixed and
mutation-pinned. These two are what P3-3b knowingly did **not** close.

- [ ] **B15 · Ticker names are missing site-wide — the honest no-map state
      (TD-7).** `POPULUS_TICKER_MAP` points at a deliberately absent path on
      CI, because `company_tickers.json` exists only under
      `data-cache/inst/registry` on a workstation: it is not in git, `build.py`
      emits none, and `publish.yml` ingests congress only. So the deployed site
      renders `no-map` on ticker surfaces and the search index carries empty
      ticker names.

      **This was chosen, not overlooked.** The alternative the code originally
      had was falling back to `tests/fixtures/inst/mcp/company_tickers.json` —
      shipping *fixture* data as production truth, which the served-tree sweep
      cannot detect because the served bytes would faithfully match the built
      bytes. Refusing a fixtures path under CI is now enforced
      (`dashboard/src/lib/inst.ts`) and lint-asserted in
      `tests/test_attestation_structure.py`.

      **To close:** give the pipeline a real registry source — either an ingest
      step that fetches SEC's `company_tickers.json` under the existing SEC UA
      policy (**the SEC UA must never change**), or a copy committed to
      `populus-data` and staged into the build as a manifest-listed artifact so
      it is covered by the digest and the sweep. Then point
      `POPULUS_TICKER_MAP` at the staged copy and delete the absent-path
      placeholder in `publish.yml`.

- [ ] **B16 · The TD-4 override exists and has been used once — decide whether
      it stays.** A live-but-unattested deployment deadlocks the R18 gate: it
      refuses to publish over an unexplained state, including the publish
      carrying the fix. Cloudflare will not delete an active production
      deployment, and attesting a known-bad build to clear a gate is the one
      thing this system exists to prevent. So
      `acknowledge_unrecorded_code_sha` was added: it must name the exact
      `code_sha` the domain serves, is `workflow_dispatch`-only (a nightly can
      never carry one), clears **only** that state, attests nothing, and records
      in the verdict that a human overrode a gate.

      **It was used once, on 2026-08-08, to clear the deadlock run 10 created.**
      Procedure and the explicit "what not to do" are in
      [`docs/runbooks/deploy.md`](docs/runbooks/deploy.md); mutants pin that any
      other sha and an always-on form both fail.

      **Decide:** keep it as the documented TD-4 clearing path, or remove it now
      that generation 1 exists and the deadlock cannot recur in the same shape.
      Keeping it is defensible — the deadlock is structural, not a one-off — but
      an override that is never exercised is an override nobody remembers is
      there. If it stays, it belongs in §14's credential/override inventory and
      in the quarterly review.

---

## 6. Carried open from 2026-08-12 (rebrand + M2-12 + Codex review)

The rebrand, the licenses-generator fix, and the M2-12 "Position changes" bound
all shipped and are live. These are what an external Codex code review and the
gate runs left behind, recorded so nothing here is discovered later as a surprise.

- **B17 — `/legal/*` still reads "Populus". ONE owner-run publish fixes it.**
  `DATA-LICENSE.md` and `NOTICE` are served from the PUBLISHED DATA BUILD, not
  the repo, and build `20260812.1` predates the generator fix. **Verified
  2026-08-12:** `licenses.render_notice()` now emits "Public Filings NOTICE …"
  while the live build carries "Populus NOTICE …", and `publish/build.py` renders
  both files through exactly that generator — so the next data publish carries
  the rebrand with no further code change. No dashboard work remains.

- **B18 — the three genuinely-failing pre-existing gates** (the rest of the 18
  `test:post` failures are worktree artifacts: `dist-cut`/`dist-fixture`
  subprocesses resolve `../populus-data`, which only exists relative to the main
  checkout).
  1. `inst_budget.M1_MEASURED_PAGES` = 12,442 vs 5,288 measured. **Root cause
     found:** the constant was measured WITH a ticker map; production builds
     deliberately run WITHOUT one (TD-7), so the whole `tickers/` tree is absent.
     The two configurations cannot both satisfy an equality assertion — decide
     which one the projection is for, and say so in the constant's docstring.
     Do NOT just re-measure into the smaller number: that would UNDER-project
     capacity for the day TD-7 resolves and the ticker pages come back.
  2. The projection base misses whole file classes (9,664 measured vs a 12,545
     base) — same family as (1), same decision.
  3. **The search index is 451,932 B against its declared 128 KiB budget** — a
     3.4× overrun that ships to every visitor on every page. **Re-measured
     2026-08-18: 506,945 B, now a 3.9× overrun** — the corpus restoration and 444
     members made it worse, not better. This one is a real
     user-facing weight problem, not a bookkeeping drift.

- **B19 — RESOLVED 2026-08-14 (UX-overhaul R29): the M2-11 QA-bundle trio
  removed.** The three tests (legacy round-two transition, round-three
  predecessor, the exact-76-path-scope closeout) certified mid-flight states of
  the now-completed M2-11 finalization against live owner-machine evidence, and
  that state cannot be rewound: the two `main`-driven tests now die on
  `finalization docs attempt cap is exhausted` (the recorded
  `private-index changed-path inventory mismatch` signature had itself gone
  stale — the evidence root kept evolving under them), and the closeout test
  required the live repo's dirty state to equal the historical 76-path scope at
  `EXPECTED_HEAD`, true only inside the original QA worktree at that moment.
  Removed rather than repaired, because repair would mean rewinding owner
  evidence history, not fixing a test. The CI deselect list and the
  allowlist-accuracy step in `.github/workflows/checks.yml` were deleted in the
  same change; `make test` and CI now run the identical unfiltered set.

- **B20 — Codex F5 fixed the byte cap; the same class may live elsewhere.**
  `capRows` measured UTF-16 code units while its constant is declared in BYTES,
  so the fixture's cap-boundary case sat at 4,090,715 B against a 2,097,152 B
  budget. Fixed in both runtimes. Worth a sweep for any other size gate that
  measures `.length` on a string and calls the result bytes.

- **B21 — `holders-period-data` (TD-M2-12-2)** carries the same unbounded embed
  shape M2-12 fixed for filers. Bounded in practice by `topn = 25` holders per
  issuer, so it is not currently a breach — but it is not gated, so nothing would
  catch it becoming one.

- **B22 — the changes cap is per-period (TD-M2-12-3)**, so the embed grows ~2 MiB
  per new quarter: roughly six quarters of headroom from the 12,979,794 B measured
  on 2026-08-12. The R19 margin gate (60% of the provider cap) now fails the
  BUILD, not the deploy, when that headroom is spent. Removal condition is
  TD-M2-12-1's byte-bounded shard family for changes.

## 7. Carried open from the 2026-08-13 deploy (CI's first run)

`.github/workflows/checks.yml` landed with the close-out and its FIRST run found
163 failures — 162 environmental, 1 a real bug. All are fixed; what follows is
what that exercise left behind.

- **B23 — CI proves LESS than `make test`, by design, and the gap should shrink.**
  On a GitHub runner: **2,490 passed, 941 skipped** of 3,423. The skips are two
  host-bound suites that now declare their own preconditions rather than being
  hidden in a CI ignore-list:
  * `tests/test_runner_controller.py` (41) executes a **macOS-only** script — BSD
    `stat -f %u` / `%Lp`, which GNU coreutils reads as "filesystem status", so
    every test died at `state-dir-stat-failed` before an assertion.
  * `tests/test_m2_11_qa_bundle.py` (121) drives a builder pinned to **absolute
    owner-machine paths** (orchestrate-tool checkout, Populus-ops snapshots).

  Neither can be authoritative where its subject does not exist, so the local
  `make test` remains the real gate. Worth revisiting if the QA-bundle builder
  ever takes its roots as parameters instead of constants.

- **B24 — `npm run test:post` is not in CI at all.** It needs a real
  `POPULUS_BUILD_DIR` plus the release DBs, which live in the private data repo.
  That means the R19 file-size/margin gates and R22 shard-family gates — the ones
  that would have caught the 25 MiB breach — run ONLY when someone runs them by
  hand. **RUN P3-3 should wire them publisher-side**, where the data already is.
  Until then, a build can breach the provider cap and no automation will say so.

- **B25 — `ops/runner/runner-controller.sh` is inconsistent about `stat`
  portability.** Line 321 carries a `|| stat -c %u` fallback; lines 210 and 223
  do not. Harmless while the script only ever runs on the Mac mini, and
  deliberately NOT "fixed": it runs as root and executes a wipe, so loosening its
  probes to satisfy a runner it will never touch is risk without benefit. Recorded
  so the asymmetry is not mistaken for an oversight later.

- **B26 — the two host-bound skips are load-bearing and unguarded.** If someone
  deletes a `pytestmark` skipif, CI goes green on a suite that never ran. A cheap
  guard would be a test asserting both suites are collected on Darwin and skipped
  elsewhere; nothing enforces it today.

## 8. Carried open from `feat/m1-geometry` (R35 harness + R9 stat strip, 2026-08-18)

PR #45 ships the browser-geometry harness and the R9 stat-strip fix. External
review ran to its 3-round cap (9 + 5 + 2 findings; 14 of 16 closed). These are
the two it could not close plus the bookkeeping the rounds produced, recorded
here because `.codex-review/` is git-ignored and would not survive the machine.

**`test:post` now reaches 60 assertions, not 49.** It had been running on Node's
~4 GB default heap and OOM'd inside `node:sqlite` at 193s, so
`file-budget.test.ts` reported one opaque failure while asserting **nothing**. It
now carries `--max-old-space-size=24576` (matching `build:bounded`) and passes 11
of its 12 — including `R22 GATE (F7)`, which the 08-17 handoff had recorded as
environment-broken. That gate is fine; it needs the build staged per handoff §8.
Consequence: the post-build lane's machine floor is now the same 32 GiB the build
already required.

**The 13 remaining `test:post` failures, attributed.** Owner decision 2026-08-18:
merge PR #45 and track these separately — none is new, none is caused by that
work, and the live site ships with all 13 today.

- 10 × `fixture-preview.test.ts` — **already covered by B18's preamble.**
  Re-confirmed 2026-08-18: `make-inst-preview.py` resolves a dev build at
  `…/.claude/worktrees/populus-data/releases/data-20260815.2/`, which does not
  exist. Worktree artifact, not a defect.
- 1 × search index — **B18.3.** Re-measured **506,945 B** against the 128 KiB
  budget (was 451,932 B; the corpus restoration and 444 members made it worse).
- 1 × `R19 GATE (margin)` — **B27**, below.
- 1 × `Locked #19` leakage check — **B29**, below.

- [ ] **B27 — `congress/data/feed.v1.json` is at 85% of the 25 MiB per-file cap,
      and the cap is the hosting provider's, not ours.** Measured on build
      `20260817.1`: 22,288,548 B — `txns` 21,854,530 B over 71,714 rows (~305
      B/row), `paper` 433,083 B over 3,047 rows. Growth is ~2 MB/year against
      3.9 MB of headroom: **roughly 18 months**, and an election year compresses
      that. It is deployable and IS deployed today, which is why nothing looks
      broken — Cloudflare will simply reject a future deploy outright.

      **The design is settled and measured (owner, 2026-08-18): shard by year,
      client fetches all shards.** ~13 shards of ~1.5 MB. The constraint is
      PER-FILE, not total download, and the feed filters/searches/pages
      CLIENT-SIDE over the whole corpus, so no scheme reduces what a filtering
      visitor downloads. Three things this must get right, each of which fails
      silently if missed:
      1. **Concatenate NEWEST-YEAR-FIRST.** The load order (filed desc, txn_id
         asc within a date) is the stable tie-break every other sort depends on.
         Years do not overlap, so year-desc concatenation preserves the global
         order exactly — and getting it wrong changes sort results rather than
         raising anything.
      2. **A partial shard set must FAIL VISIBLY**, never render a short feed. A
         feed missing a year looks exactly like a quiet week — the B25 failure
         mode again.
      3. `/congress/data/feed.v1.json` stays an INDEX (metadata, `txn_cols`,
         `paper_cols`, `paper`, `shards: [{year, path, rows}]`). Three strings
         advertise it as "the full published data" / "the raw dataset"
         (`congress/index.astro:186`, `watchlist/index.astro`, the load-failure
         copy) and must change with the shape, or the page claims a completeness
         the file no longer has. `feed-client.ts` and `watchlist-client.ts` both
         fetch it; `classifyDataset` must learn the index shape and keep refusing
         a stale cached body (the F3 version-mismatch path).

      Owner decision 2026-08-18: **schedule after M1**, not before. A recent-window
      default (3.9 MB first paint) was considered and deliberately NOT taken — it
      narrows the default view, which this site may only do out loud.

- [ ] **B28 — R6's scroll cue may be unreliable above the 720px fold, and the
      geometry gate cannot currently prove otherwise.** Raised by external review
      (round 3 F2) and left OPEN when the cap was reached.

      R6's cue is a Lea-Verou "scrolling shadow" painted on `.table-scroll`'s
      background, *behind* the table. Its visibility therefore depends on what
      the table's own cells cover. Above 720px there is no `mask-image`
      fallback — inside the fold there is, and that is what actually paints
      at 360/720px.

      Measured 2026-08-18 on `/institutional/filers/1067983/`, sampling a
      right-edge strip below the 29px sticky `thead`, scrolled to mid-range:

      | condition | 964px | 1440px |
      |---|---|---|
      | real corpus | scrollable, cue paints | **not scrollable** (1278/1278), cue paints |
      | `.etable{min-width:4000px}` | scrollable, **cue paints NOTHING** | scrollable, cue paints |
      | `.table-scroll{max-width:240px}` | scrollable, **cue paints NOTHING** | scrollable, **cue paints NOTHING** |

      Two readings, and the measurements do not separate them: either the cue is
      genuinely unreliable above the fold under heavy overflow — a defect in
      merged code that predates `feat/m1-geometry` — or all three forcing
      instruments are invalid because they change what covers the background.

      **The gate today asserts** (all five widths): the container exists, the cue
      is declared, the cue PAINTS (right-edge strip differs with and without it),
      and the identity column is `position: sticky`. **It does not assert** that
      the container is scrollable at 1440px, because with today's corpus it is
      not. Deciding this means changing R6's cue mechanism or its contract.
      Owner decision 2026-08-18: **investigate before further M1 work.** Do not
      write a fourth forcing instrument unreviewed — "tuned until green" is the
      failure this branch has already paid for twice.

- [ ] **B29 — `production dist has NO institutional fixture routes (Locked #19)`
      cannot pass in the configuration R35/R9 require.** The test asserts the DEV
      build withholds the institutional module. Browser-geometry work must build
      the PRODUCTION configuration (`POPULUS_INST_DB` set), where
      `dist/institutional/filers` legitimately holds 1,500 pages. One tree cannot
      satisfy both premises. Either the test learns the build mode it is looking
      at and skips loudly in the other, or the geometry lane gets its own staged
      dev build. It is a configuration conflict, not a leak — verified 2026-08-18
      that the pages present are the real institutional tree, not fixtures.

## Notes for whoever picks this up

- **G-guardrails govern**: G1 no paid/vendor data · G3 never silently drop ·
  G4 both dates always · G5 ranges and units labeled · G10 flows/snapshots ≠
  holdings · G12 one module at a time · G14 no identity time-travel.
- **Run orchestrate in a dedicated git worktree**, never the main checkout — its
  tree-fingerprint invariant FATALs on any concurrent change, and several
  sessions now write this repo simultaneously.
- **Verify against a frozen tree.** A headless agent reporting "completed" does
  not mean its writes landed; hash the source tree before and after any gate run
  and treat a mismatch as invalidating the run. A traceback whose displayed
  source line doesn't match the code (a comment, a wrong signature) is a
  source/bytecode mismatch — you are chasing a ghost, not a bug.
- **A partial sweep passes every check you run.** 2026-08-13, four times in one
  session: the brand rename fixed one of two CSS-drawn marks; a comparator was
  repaired in TypeScript but not its Python mirror; a route rename updated a
  filename comparison but not the filter regex two lines above; and a workflow
  edit truncated the file, silently deleting a whole CI job while the run stayed
  GREEN. Grep the complete sibling set, then MUTATE the fix and watch the test go
  red — a test that passes against the defect it names is not a test.
- **Verify in the environment you are claiming for, not the one you have.** Three
  false "verified" claims from one root cause: a pager "worked" because the check
  clicked a period chip first; suites "needed no environment" because the machine
  already had `uv`; a workflow was "correct" because one job of two was inspected.
  Each was caught by something external — Codex, then CI. Neither is optional.
- **Never read a `node --test` or pytest log before its summary line is written.**
  Twice a mid-run partial log was reported as a result, and twice it was wrong.
  Wait for `ℹ fail` / `N passed`, and when polling CI, pin the run to the commit
  SHA rather than asking for "the latest".
- **When three-plus review rounds land blockers in one mechanism, stop patching
  and write the spec.** Proven on the M2-4 serving lifecycle, M2-4 amendment
  composition, the P3 feed pagination, and again on the M2-5 parse substrate
  (B2).
