# Review Brief: UX Overhaul Revision 4 — corpus restoration, then translation, curation, and insight layers

**Plan:** `docs/design/UX-OVERHAUL-PLAN.md` (plan-v1, Revision 4, validates rc=0)
**Branch:** `feat/ux-overhaul` — worktree content byte-identical to `origin/main@b61188a`
**Review round:** confirmation round 1 (owner-authorized fresh loop, phase
`plan-review-c2`) — the seventh external round overall. History: Revisions 1–3 drew
19 → 11 → 8 blockers; the Revision 4 loop drew 8 → 5 → 2, hitting its 3-round cap
with round 3 confirming the archive, transaction-floor, joined-identity, and
master-freeze remediations genuine and leaving exactly two blockers, both inside
R36's CSP mechanism. Those two were remediated AFTER the cap and are what this
confirmation round exists to verify.
**Focus areas (confirmation round — narrow by design):** ONLY the two post-cap
remediations of the prior loop's round-3 findings, plus its nit:
(r3-F1) the provider-control envelope now includes EVERY consumer — the inventory
document gains `control_files`; `_require_copy_faithful`
(`src/populus/deploy/snapshot.py:259`) compares the copied tree against
`files` ∪ `control_files` so full-tree byte binding survives; the serving sweep
iterates `files` only; `site_file_count` counts `files` only; `snapshot.py`,
`inventory.py`, `verify.py`, `tests/test_deploy_snapshot.py`, and
`tests/test_deploy_verify.py` are all in Planned Files.
(r3-F2) the complete `_headers` rule is locked byte-exactly in the plan — every
directive and source enumerated, with the REAL base64 SHA-256 of the emitted
`is:inline` pre-paint script (`sha256-l7z5mLHE3mvA5XUH9QJEiNRmReuFTfsBcWHAxRGvW3k=`,
389-character script, measured from built `dist` bytes), directives measured against
the real site (zero inline styles), and missing/altered/hash-drift negative tests
pinned.
(r3-F3 nit) this brief's stale aggregate-floor paragraph was replaced and the brief
restaged in the index. All findings from the six prior rounds are otherwise
adjudicated; please do not re-open settled items absent new evidence.

## Summary of Changes

Revision 4 re-pins the plan onto `origin/main@b61188a` — a base that is **deployed and
attested**: live serves build `20260815.2` with matching `populus:code_sha`
`b61188ac…`, and `builds/20260815.2/deployments/1.json` records generation 1 for that
pair. Between Revisions 3 and 4, executing the plan's preconditions surfaced a
production outage: `publish.yml` had never run the members ingest, so seven consecutive
CI builds published with zero member pages (B24). The fixes are already merged in the
reviewed base (PRs #37–#39): a CC0 roster fetcher with validation floors, an
identity-join workflow step, a declared `expect_member_join` refusal in `stage_build`
pinned by an AST test, and a serving-anchor resolver in the deploy path. Two Revision 3
premises were falsified and are corrected in Current State: deploys had been completing
daily (the marker-mismatch deadlock, not a never-completed deploy, was the real M0
problem — since resolved), and the three pytest nodes were not the only reds in
`make check`.

The same investigation measured B25: the runner builds a fresh `populus.db` every run;
House ingest fetches only the current year (`src/populus/ingest/house.py:74`), so
~54,000 historical House rows (2014→2025) silently vanished from the published site,
while Senate re-fetches 14 years nightly because an empty store backfills from
`01/01/2012` (`src/populus/ingest/senate.py:602`). The new milestone **M0b** closes the
loop: R42 seed-forward (every run seeds from the previous release's `congress.db`,
fetched through the existing release backend and verified against the manifest sha256;
no fresh-DB fallback exists afterward), R43 one-time bootstrap (the never-published
local `data-20260802.2` seed — digest pinned in the plan text itself; the local manifest that
also records `086c937e…` is untracked — plus a one-time bounded Senate era ingest using the existing
`--submitted-start/--submitted-end` CLI options), R44 a fail-closed corpus-shrink guard over per-(source, chamber) RAW-table counts
plus joined counts plus a proof that THIS run's member join executed, R45 the file-budget constants re-measured once on
the restored tree in the production configuration (deliberately sequenced after
restoration so the outage is not encoded as the baseline), and R46 arming the nightly
last via the workflow's own `POPULUS_SELFHOSTED_VALIDATED` contract
(`publish.yml:62-66`).

M1–M6 carry forward from Revision 3 with two amendments: **F2 is resolved by owner
decision** — R34 was executed with the real serving projection (998 filers, closed
period 2026-06-30; five filers exceed the 2 MiB per-period byte cap, worst CIK
0001710537 at 21,449 rows / 7.78 MiB; bytes bind at ≈383 B/row), and the owner chose
the capped embed with an honest terminus over any full-data expansion, so the R19
parity contract's third render path is now the capped embed — and **R31's calibration
is formally data-dependent on the restored corpus**, since thresholds measured on the
shrunken corpus would calibrate the outage.

## Detected Stack

- **Python ≥3.12** at the repo root — `pyproject.toml`, `uv.lock`, pytest
  (`testpaths=["tests"]`), producers in `src/populus/`; httpx + pyyaml available.
- **Node / TypeScript (Astro)** at `dashboard/` — `package.json` + committed lockfile,
  `astro check`, `node --test`.
- **Gates:** `make check` = `uv sync --frozen` + **unfiltered** `uv run pytest -q`
  (3,521 passed / 11 skipped at the base) + `cd dashboard && npm ci && npm run gates`
  (`check` → `test` → `build:bounded` [refuses under 32 GiB RAM] → `test:post`) +
  `make security` (`scripts/dep_guard.py`, whose network-primitive sweep matches
  comments too). **`test:post` never runs in CI** (hosted runners sit under the RAM
  floor), so the authoritative post-build evidence is always a local run — this is how
  B24 stayed invisible.
- **CI/CD:** `checks.yml` python job now runs the unfiltered tree (the R29 deselect
  allowlist was removed); dashboard job runs check + unit only. `publish.yml`: publish
  on the self-hosted `populus-ops` runner (owner's Mac), deploy/sign/assert-signed on
  hosted runners holding the credentials; nightly cron `17 6 * * *` gated by
  `POPULUS_PUBLISH_ARMED` && `POPULUS_SELFHOSTED_VALIDATED`.

## Reuse / Duplication Check

Carried from PLAN.md §Reuse Map. The M0b rows are new and are the ones to scrutinize;
every claimed primitive was verified at the pinned base this session:

| Need | Landed primitive | Disposition |
|---|---|---|
| Fetch + verify a release asset (R42) | backend `verify_asset`/`read_asset` (`src/populus/publish/build.py:182,190`; LocalDir + gh-release implementations) | Reuse — no new download code |
| Asset identity (R42, R43) | `congress.db` `sha256` + `logical_digest` in each build's `manifest.json` | Reuse as the seed's integrity pin |
| Pointer/manifest authentication (R42) | pointer loader + `manifest_sha256` byte check (`build.py:3386`), `validate_manifest` (`manifest.py:513`), `pointer_manifest_identity_error` (`manifest.py:659`) | Reuse the complete chain before any asset read (round 1 F2) |
| Machine-local input via repo variable (R43) | `POPULUS_INST_DB` pattern in `publish.yml` | Follow the pattern for `POPULUS_CONGRESS_SEED_DB` (bootstrap-only) |
| Senate historical era (R43) | `ingest congress-senate --submitted-start/--submitted-end` (`src/populus/cli.py:136-151`) | Reuse — no new fetch path |
| Declared-expectation refusal (R44) | `expect_member_join` / `expected_modules` in `stage_build` | Follow the pattern; the floor guard is a workflow-step CLI check because its baseline (the seed) is extrinsic to the build |
| Empty-env hygiene (R42–R44) | `scripts/fetch_legislators_cache.py` `.strip() or DEFAULT` + blank refusal | Follow the pattern for every new knob |
| Older-era store reconciliation (R43) | `ensure_views` + `ensure_subline_columns` (idempotent; already invoked on the members CLI path) | Reuse |
| Interval math, sector grouping, member v2 sections, holdings caps + terminus, flag rendering, footnotes, chart/rail patterns, concentration stats, search index, owner-signed YAML, css-fold | as enumerated in PLAN.md §Reuse Map | Unchanged from Revision 3 (already reviewed rounds 1–3) |

No M0b implementation exists yet, so there are no plan-vs-code deltas. The B24 fixes
(PRs #37–#39) are merged into the base under review, not part of this plan's future
diff.

## Simplicity Audit

Carried from PLAN.md. M0b adds exactly: one library module
(`src/populus/publish/seed.py`), two CLI subcommands (`seed-corpus`, `corpus-floor`),
two workflow steps, one `workflow_dispatch` input, one test file
(`tests/test_corpus_seed.py`), and two re-measured constants. Zero new tables, zero
frontend changes, zero new top-level directories. Rejected abstractions: a new download
client (backends exist), a `stage_build` floor parameter (extrinsic baseline stays in a
step), DB-merge tooling for the bootstrap (the supported era ingest is used instead),
permanent local-path seeding (bootstrap-only, digest-pinned). The M1–M6 unit inventory
carries from Revision 3 minus the full-data expansion machinery deleted by F2's
resolution; the complete per-unit table with removal-failing tests is in PLAN.md
§Simplicity Audit.

## Tech Debt Introduced

Declared in PLAN.md, each with owner, impact, and removal condition:

1. The bootstrap depends on one machine-local file until the R43 release publishes;
   removed when R43 completes and the bootstrap variables are cleared.
2. `seed-counts.json` is a per-run baseline, not a published artifact: a chamber
   stalling exactly at its seed count is not caught by the floor (the journal's
   freshness watermarks remain the detection surface for a quiet source). Low impact;
   fold floor history into the journal if it ever bites.
3. B18.3 — the search index ships 451,932 B against its declared 128 KiB budget — stays
   open and worsens with 321 members restored. Recorded, re-raised in BACKLOG, not
   solved here.
4. Carried from Revision 3: curated-registry re-verification is unscheduled; frozen
   calibration constants have no re-measurement cadence; the SIC snapshot is
   point-in-time; `ui.ts` keeps growing; the privacy promise becomes a maintained
   claim.

No hidden debt: there is no implementation diff yet.

## Memory Touch-Points

- `memory-select.sh` reported an unreadable index on this machine (recorded in
  PLAN.md); the session's loaded memory index supplied the applied lessons:
  *plan-v1 authoring gotchas* (21 headings once each, literal R-ids, backticked
  paths); *always `bash -c` the validator* (applied — it caught two real traceability
  gaps before rc=0, so the green is demonstrably non-vacuous); *a green gate can be
  green because checks were skipped* (encoded as the `test:post`-never-in-CI note);
  *negative control must isolate one guard and assert the code was reached* (R44's
  zero-pair and missing-sidecar branches must refuse, so an empty baseline can never
  pass vacuously); *verify-against-a-frozen-tree / measure-the-mechanism* (every M0b
  mechanism claim cites file:line or command output); *a liveness probe matching your
  own run* (R46's evidence must be a **scheduled** run, not the arming dispatch).
- `~/.claude/skills/_shared/failure-modes.md` loaded; the sweep is carried below.

## Repo Structure Conformance

| Planned addition | Conventional location | Actual location | Conforms? | Notes |
|---|---|---|---|---|
| Seed/floor library code | `src/populus/publish/` (siblings: `build.py`, `upload.py`, `record.py`, `seed`-adjacent release logic) | `src/populus/publish/seed.py` | yes | release-backend consumers live here |
| CLI commands | `src/populus/cli.py` (single Click entrypoint; pattern of `stage-build`, `snapshot-site`, `finalize-build`) | `src/populus/cli.py` | yes | |
| Corpus tests | `tests/` (pytest `testpaths`) | `tests/test_corpus_seed.py` | yes | |
| Workflow steps + dispatch input | `.github/workflows/publish.yml` | same | yes | mirrors the legislators-cache step placement |
| Runbook additions | `docs/runbooks/deploy.md` | same | yes | |
| M1–M4 files | as reviewed in rounds 1–3 | unchanged from Revision 3 | yes | geometry suite in `dashboard/test/post/`, owner-signed YAML in `src/populus/` |

No new top-level directories. Network access stays out of library modules: `seed.py`
reaches the network only through the injected release backend — the same boundary
`build.py` already holds — and `dep_guard`'s sweep applies to it.

## Failure-Mode Sweep

- **F0 full-set** ✓ — the corpus guard covers every (source, chamber) pair, not just
  house; R36 changes both privacy-copy files in one commit; the banned-wording
  covered-set grows with every new surface; all seed env knobs get blank-as-unset
  handling (PLAN.md Constraint 13).
- **F0 secrets** ✓ — the seed path carries no credentials (release assets via the
  already-authenticated backend); §14 credential/job boundaries untouched; this brief
  and every prompt pass through the bridge's scrubbing.
- **F0 verify-don't-assume** ✓ — house/senate window semantics (`house.py:74`,
  `senate.py:602`), release availability (`data-20260802.2` never published; GitHub
  releases begin at `data-20260808.1`), backend affordances (`build.py:182,190`), the
  arming switch (`publish.yml:62-66`), and the seed digest (manifest sha256
  `086c937e…`) are each cited to code lines or command output, not prose.
- **F1 enumerate consumers** ✓ — M0b's consumers are two workflow steps and two CLI
  commands, all in Planned Files. **F1 exact gate list** ✓ — Constraint 9, including
  the CI-cannot-run-`test:post` caveat. **F1 units/NULL** ✓ — floor counts are row
  counts over `v_default_transactions`; an absent sidecar refuses, never reads as
  zero. **F1 re-baseline** ✓ — re-pinned to `b61188a`; R32 keeps it honest.
- **F2 full-tree gates** ✓ — new Python enters the unfiltered pytest tree and
  dep_guard's sweeps. **F2 removal-failing tests** ✓ — enumerated per unit in the
  Simplicity Audit. **F2 dead CSS** N/A for M0b (no CSS); the existing sweep covers
  M1+ selectors.
- **F3 function-not-liveness** ✓ — R43 is verified by querying the released database's
  actual per-chamber windows, not by green workflow steps; R46 by a scheduled run's
  artifacts, not by the variable being set.
- **F4 propagation** ✓ — closing B25/B18.1/B18.2 sweeps `BACKLOG.md` for every stale
  count in the same commit.
- **F5 transport** ✓ — the plan validates as plan-v1 (rc=0 after two caught gaps);
  this brief validates as review-brief-v1 before submission; Revision 3 is archived at
  `docs/design/UX-OVERHAUL-PLAN.r3.md`, not overwritten.
- N/A with reason: connection-pooler read-only (no PostgreSQL), bulk-SQL backfill (the
  existing upsert ingest is the only write path), RLS simulation (no RLS).

## Diff Context

No implementation diff exists — this is a pre-development plan review. Proposed
interfaces:

### The corpus loop (new — M0b)
**Files:** `src/populus/publish/seed.py`, `src/populus/cli.py`,
`.github/workflows/publish.yml`, `tests/test_corpus_seed.py`, `docs/runbooks/deploy.md`
**What's changing:** every publish run seeds `populus.db` from the previous release
(pointer `latest.json` → `builds/<id>/manifest.json` → `congress.db` sha256 → backend
fetch → byte-exact verify → atomic placement → `ensure_views` +
`ensure_subline_columns` → write `seed-counts.json` per-(source, chamber) baseline).
Baselines are IDENTITY lists (round 2 F2/F3): seed filing_ids, joined
(filing_id, bioguide_id) pairs, and per-filing transaction counts — counts alone were
rejected twice (the default view shrinks under amendment healing, `views.sql:23`; raw
transactions shrink under corrective reparse, `load.py:513`; aggregates can be offset,
`members.py:651`). After the ingests and member join, `corpus-floor` refuses a
vanished filing identity, a vanished joined pair, an unauthorized per-filing
transaction decrease (`corpus_floor_allow_reparse` names reviewed exceptions), a
missing THIS-run members `ingest_runs` row, a missing sidecar, or an empty baseline. A `senate_era_backfill` dispatch input adds the one-time
`--submitted-start 01/01/2012 --submitted-end 04/30/2026` era fetch (the seed's Senate
floor is 2026-03-24; overlap is upsert-idempotent by design).
**Key decisions:**
- Seed-forward over recurring backfill: House history is ~13 PDF-heavy year fetches
  against a government server; the data exists locally with a recorded digest.
- Era ingest over SQL merge: only supported code paths touch the store.
- Floor guard as a workflow-step CLI, not a `stage_build` parameter: the baseline is
  extrinsic (the seed), unlike the intrinsic member-join invariant.
- No fresh-DB fallback anywhere: that path is the proven cause of both B24 and B25.
- Seeded inline `inst_*` tables are DROPPED from the working copy at seed time:
  `stage_build` with `--inst-db` unset derives an inst module from inline tables
  (`build.py:2777`), so "inert" was wrong — round 1 F3 caught it, and the drop plus
  both-variable-states tests are now the contract.

### Constants re-measure (R45)
**Files:** `src/populus/inst_budget.py`
**What's changing:** `M1_MEASURED_PAGES` (12,442) and `SITE_CHROME_FILES` (103) become
measurements of the first restored-corpus build in the production (no-ticker-map)
configuration, with docstrings naming the configuration and the TD-7 ticker-tree delta
(B18's explicit instruction). The three red post-build file-budget tests then pass with
their existing ±1,000 tolerance; no test logic changes.

### M1–M6 surfaces
Unchanged from Revision 3's reviewed contracts (security directory, calibration
algorithm shape, curated registry, recipe families and parity tuple, follow score,
notable topology, coverage floor, analytics + privacy rewrite, geometry harness), with
the two amendments named in the Summary. PLAN.md §Architecture states both and
otherwise carries Revision 3 by explicit reference to the archived file.

## Review Checklist

- [ ] R42: is pointer → manifest → sha256 sufficient seed identity, or should the
  `logical_digest` also be recomputed after placement (transport corruption vs
  at-rest tampering coverage)?
- [ ] R42: is refusing when neither pointer nor override exists correct for disaster
  recovery (empty data repo), or does that need a documented explicit-fresh escape
  hatch with its own loud marker?
- [ ] R43: is upsert idempotency across Senate amendment pairs
  (`supersedes`/`amendment_unresolved`) actually order-independent when the era fetch
  re-encounters filings the seed already holds?
- [ ] R43: the inert-inst-tables claim rests on `--inst-db` being set; what happens on
  the `--inst-db`-UNSET path with a seeded store that CONTAINS stale inst tables —
  does the congress-only build stay byte-identical to today's, per the workflow's
  R1/R18 comment?
- [ ] R44: adjudicated — the floor covers joined `(filing_id, bioguide_id)` pair
  identity (not counts), with the offset-roster refusal test; confirm the pair-set
  semantics read correctly.
- [ ] R45: with the constants re-measured on the restored no-ticker-map tree, is the
  existing ±1,000 tolerance far enough from routine corpus growth to avoid re-redding
  within a quarter?
- [ ] R46: is one completed scheduled run sufficient arming evidence, or should the
  runbook require N consecutive green nightlies?
- [ ] Sequencing: does anything in M1/M2 (e.g. R8's period-keyed directory over
  serving rows) have a hidden data dependency on the restored corpus that the plan
  fails to sequence, the way R31 explicitly does?
- [ ] Is an approval scoped to M0b–M2, with round-3 F3/F4/F5/F7 held as owner stop
  points at their milestones, acceptable — or must those be resolved on paper first?

## Open Questions

1. Round 1 F8 was answered by formally narrowing the executable scope to
   Preconditions + M0b + M1 + M2, with M3/M4 marked CONDITIONAL and gated (F4 + F7
   decisions + the R18 signature in writing; R31's `T_*` are measurements). Does that
   narrowing plus the gates make the artifact approvable for its stated executable
   scope?
2. Is the per-run floor baseline (reset to each run's seed) an acceptable guarantee,
   given the journal watermarks cover the quiet-source case — or should floor history
   persist across runs from the start? (Declared as debt item 2.)
3. R42 states the honest I/O behavior (`read_asset` returns whole `bytes`; ~0.9 GiB
   transient for the bootstrap seed on a 32 GiB-floor machine). Is stating it
   sufficient, or should the plan require a streaming read path before the bootstrap?

## Constraints & Context

- The site is LIVE and attested end-to-end as of run 31874606690; every M0b workflow
  change executes in production on its next dispatch. Rollback of the loop is removing
  two steps (documented as degraded).
- The publish job runs on the owner's Mac (self-hosted `populus-ops`);
  deploy/sign/assert-signed hold credentials on hosted runners — new steps must not
  cross that §14 boundary.
- Library code performs no network access; `seed.py` must reach the network only
  through the injected backend.
- GitHub repository variables arrive as EMPTY STRINGS when unset (cost one 2h11m run
  this week — run 31861037053; PLAN.md Constraint 13 encodes the rule).
- Banned-wording scanner covers `dist/` with word-boundary regexes; `sold` and
  "fund size" are banned outright; `grep -a` always (deliberate NUL byte in
  `derive.ts`).
- Owner actions inside M0b: provisioning the two bootstrap variables and witnessing
  the R43 dispatch; setting `POPULUS_SELFHOSTED_VALIDATED` (R46).
- No timeline constraint; correctness-first ordering (corpus before calibration) is
  binding.

## Previous Review Feedback

### Rounds 1–2 (Revisions 1–2; 19 → 11 blockers)
Stale-base survey errors (the plan specified rebuilding landed code), missing parity
identity, unspecified aggregate schemas, budget errors. Addressed by Revision 3's
rebaseline; closures recorded in the repository's `.codex-review/RESOLUTION-NOTES.md`
and accepted by round 3 ("Round-2 F4, F5, F8, F9, and F10 are genuinely closed").

### Round 3 (Revision 3; 8 blockers, 1 nit) — disposition against Revision 4
- **F1 (stale 15,000-cap / plain `astro build` claims):** closed — Revision 4 carries
  `GLOBAL_FILE_CAP = 18_000` and the `build:bounded` chain with the 32 GiB precondition
  (Constraints 8–9).
- **F2 (full-data mechanism unproven/infeasible):** **closed by execution + owner
  decision** — R34 ran 2026-08-14 against the real serving projection (five filers over
  the byte cap; worst 21,449 rows / 7.78 MiB; bytes bind), and the owner locked the
  capped embed + honest terminus (Locked Decision 5). No truncated set is ever called
  "full data"; the terminus names the exact withheld count. R19's third parity path is
  the capped embed.
- **F3 (quantiles unassigned):** open by design — Open Question 1. Sequenced as R31,
  the M3 entry gate, on the restored corpus; the plan forbids inventing constants.
- **F4 (per-archetype section sets):** open — owner/product stop point at R19 (Open
  Question 2).
- **F5 (retention semantics):** open — stop point inside R36 (Open Question 3).
- **F6 (sector surfaces stay dark without a ticker map):** open — Revision 4 keeps M6
  **BLOCKED** and forbids entering it; no sector work is scheduled until the
  owner/counsel identity-mapping decision exists. Narrower than round 3's remediation
  asked (no mapping is proposed), but the plan no longer claims M6 is buildable.
- **F7 (notable predicates undefined):** open — stop point at R21/M3 (Open Question 2).
- **F8 (R29 sequenced last while `make check` runs unfiltered):** **closed by
  execution** — R29 done via PR #37; the CI deselect allowlist removed; the unfiltered
  tree is green (3,521 passed / 11 skipped) at the reviewed base.
- **F9 nit (test-file count mismatch):** superseded — Revision 4's Planned Files are
  grouped by milestone with no summary count to drift.

### New since round 3 (never reviewed)
The entire M0b milestone (R42–R46), the B24/B25 findings and their Current State
consequences, the F2 resolution's ripple into R19/R38, and the R31 data dependency.
These are this round's primary review surface.

### This loop, round 1 (Revision 4; 8 blockers, 1 nit) — remediations in this delta

- **F1 (Revision 3 archive absent from the bundle):** the archive is now STAGED at
  `docs/design/UX-OVERHAUL-PLAN.r3.md` beside the plan, and — more materially — the
  four contracts the EXECUTABLE scope depends on (R8 directory, R13 disclosure, R35
  harness, R36 analytics) are inlined in full into Revision 4 §Architecture; only the
  CONDITIONAL M3/M4 contracts remain carried by reference to the staged archive.
- **F2 (unauthenticated pointer→manifest):** R42 now reuses the complete landed chain
  — pointer validation, manifest bytes vs `manifest_sha256` (`build.py:3386`
  precedent), `validate_manifest`, `pointer_manifest_identity_error` — with the five
  negative tests enumerated (malformed pointer, manifest-hash mismatch, cross-build
  identity, missing module entry, malformed artifact entry).
- **F3 (seeded inst tables not inert):** conceded — the claim was wrong
  (`build.py:2777` derives an inst module from inline tables when `--inst-db` is
  unset). `seed-corpus` now DROPS inline `inst_*` tables from the seeded working
  copy; tests cover blank AND set `POPULUS_INST_DB` (blank ⇒ congress-only build).
- **F4 (default view is not a stable baseline):** conceded (`views.sql:23`). Floor
  baselines moved to RAW `filings`/`transactions` counts; a positive-control test
  proves legitimate amendment healing lowers the default view while passing the
  floor.
- **F5 (seed-forward defeats the B24 total-absence guard):** conceded. The sidecar
  now records joined counts AND the run start; the floor additionally requires a
  `job='members', status='ok'` `ingest_runs` row started within THIS run; a
  seeded-store test with the join step omitted must refuse.
- **F6 (rollback restores the corpus-loss path):** rollback rewritten as
  disarm-and-freeze — the nightly is unarmed, publishes stop, the site keeps serving
  the last attested release, and publishing resumes only with a verified seed. The
  fresh-DB path is not offered as a rollback.
- **F7 (retention unresolved inside the approval scope):** closed with facts, not a
  stop point — Cloudflare's published FAQ (fetched 2026-08-15) is locked into R36 and
  Locked Decision 14: 7-day unsampled retention, ~10% aggregation thereafter,
  six-month access window, no query strings logged. Delivery locked too: the site
  ships no CSP today (verified), so R36 introduces `dashboard/public/_headers` with
  both analytics origins; the beacon token is a public value in `Base.astro`.
- **F8 (open decisions inside an executable scope):** the plan formally narrows its
  executable scope to Preconditions + M0b + M1 + M2; M3 and M4 are CONDITIONAL
  milestones with written entry gates (F4, F7, R18), the same standing as M6/F6.
- **F9 nit (manifest called tracked):** wording corrected in both plan and brief —
  the local manifest is untracked; the plan text is the durable digest pin.

### This loop, round 2 (5 blockers) — remediations in this final delta

- **r2-F1 (archive on disk but untracked/excluded):** all three documents — plan,
  Revision 3 archive, brief — are now `git add`ed to the index (staged, uncommitted,
  per the bridge's owner-commits contract) and their local-exclude entries removed;
  `git ls-files --stage docs/design/` shows all three. A clone of the owner's next
  commit loses nothing.
- **r2-F2 (raw transactions not append-only):** conceded — `load_filing`
  DELETE-and-replaces a filing's parsed set (`load.py:513`). The floor is rebuilt on
  identities: seed `filing_id` superset (filings are never deleted; verified no
  deletion path exists), per-filing transaction counts with decreases requiring the
  named `corpus_floor_allow_reparse` authorization, positive test for an authorized
  corrective reparse.
- **r2-F3 (aggregate joined counts offsettable):** conceded — the join rewrites every
  filing (`members.py:651`). The sidecar now carries the joined
  `(filing_id, bioguide_id)` pair list; the floor requires pair-superset with only
  named corrections allowed; the requested truncated-but-nonempty-roster test (new
  joins holding aggregates level) is specified and must REFUSE.
- **r2-F4 (freeze switch gated schedule only):** conceded — `workflow_dispatch` is
  deliberately exempt from `POPULUS_SELFHOSTED_VALIDATED`. Freeze is now defined as
  unsetting the MASTER `POPULUS_PUBLISH_ARMED` (gates every event at
  `publish.yml:62`), with `tests/test_workflow_governance.py` additions pinning both
  event types and the documented disarm/resume variables.
- **r2-F5 (`_headers` conflicts with the deployment verifier):** conceded and
  scheduled — the plan now changes `inventory.py` (exclude `_headers` as a declared
  provider-control artifact with recorded digest), `verify.py`
  (`content-security-policy` added as a REQUIRED header equal to the locked policy;
  `/_headers` control probe unchanged), adds `tests/test_deploy_verify.py` negative
  tests for missing/altered policy, and the CSP carries a `'sha256-…'` allowance for
  the inline pre-paint theme script (`Base.astro:48`) rather than `'unsafe-inline'`.

### Prior loop, round 3 (final under cap; 2 blockers + 1 nit) — post-cap remediations

- **r3-F1 (envelope missing snapshot.py and consumers):** the plan's R36 now defines
  the control envelope end-to-end: `control_files` in the inventory document;
  `_require_copy_faithful` proves `files` ∪ `control_files` equals the copied tree
  (byte binding preserved, packaging cannot reject its own sealed copy); serving
  sweep and `site_file_count` cover `files` only; `snapshot.py` + snapshot/verify
  tests scheduled in Planned Files.
- **r3-F2 (CSP not actually locked):** the complete `_headers` rule is now in the
  plan verbatim — single `/*` block, full directive list, real pre-paint hash
  computed from emitted dist bytes; the hash constant changes in the same commit as
  any pre-paint edit, and a recompute-from-dist verifier test catches drift.
- **r3-F3 (stale brief paragraph; staged blob outdated):** fixed and restaged.

These edits were made AFTER the prior loop hit its cap and have not previously been
reviewed — they are this confirmation round's entire subject.

## Severity rubric

- **Critical:** correctness, data-loss, security, or deployment blockers
- **Major:** architectural risk, likely production bug, weak testability
- **Minor:** maintainability or clarity improvements

Each high-severity item must include impact, evidence location, and a concrete fix
direction.
