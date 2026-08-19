# plan-v1: UX Overhaul — publicfilings.org (corpus restoration, then translation, curation, and insight layers)

**Transport mode:** `interactive-disk`. **Scope class: L.**
**Revision 4 — 2026-08-15**, amended 2026-08-19 (R10: "near-universal" → "universal";
see R10 for the measurement and the reason). Re-pinned onto `origin/main` at
`b61188a` (merge of PR #39), which is **deployed and attested**: live serves build
`20260815.2` with `populus:code_sha b61188ac757812220e44b239f3e91d16477cf8ad`, and
`builds/20260815.2/deployments/1.json` records generation 1 for exactly that pair.
Revision 3 (archived at `docs/design/UX-OVERHAUL-PLAN.r3.md`) was executed through its
Preconditions on 2026-08-14/15; that execution **falsified two of its premises** (§Current
State) and surfaced a live outage whose fix shipped as PRs #37–#39. This revision records
what is now done, folds in the corpus restoration the outage investigation exposed (B25),
and carries the UX milestones forward against the tree that actually exists.

---

## Goal and Success Criteria

Unchanged in intent from Revision 3, with one addition (item 0), because the site cannot
be "a surface a retail investor stays on" while a decade of its data is silently missing.

Success =

0. **The published corpus is complete and cannot silently shrink again**: House history
   2014→present and Senate history 2012→present in one release, every nightly run seeded
   from the previous release, and a build refusal when any (source, chamber) count drops
   below its seed.
1. A visitor who has never read a 13F can open any filer page and learn what that manager
   reported holding, what changed, and whether that change means anything for this kind of
   manager, before scrolling past a caveat block.
2. No default view renders an internal identifier — `sid:` key, raw flag slug, schema or
   contract reference. Each remains reachable one interaction away, and printable.
3. `/institutional/` ranks by research-worthiness rather than size, with every filer one
   click away.
4. A filer page renders differently by archetype.
5. The sector panel that already exists on member pages actually renders (M6, still
   blocked on F6).
6. Every honesty feature still exists, relocated but never removed, and a test fails if
   any is dropped.
7. Nothing claims to know a congressional balance.
8. The pipeline ships it unattended: the nightly is armed, and it was armed **last**.

---

## Requirements

IDs R1–R41 are carried from Revisions 1–3 so review traceability survives; R42–R46 are
new. `[DONE <evidence>]` marks requirements satisfied during the Revision 3 execution —
they stay listed because the Verification Matrix still owns their proof. `[PIPELINE]`
marks `src/populus/`; `[FRONTEND]` marks `dashboard/`; `[OPS]` marks workflow/runner work.

### Preconditions — executed 2026-08-14/15

- **R32** The plan is baselined at `origin/main@b61188a`. Work happens in
  `<repo>/.claude/worktrees/ux-overhaul` (exists, currently at that base). If the base
  advances before a milestone starts, the survey is re-run for the affected claims.
- **R33** The 25-row audit disposition matrix (unchanged from Revision 3, reproduced
  below) covers every audit finding.
- **R29** `[DONE — PR #37]` The three permanently failing tests in
  `tests/test_m2_11_qa_bundle.py` were removed (unrepairable: they pinned mid-flight
  states of the completed M2-11 finalization against live owner evidence that had moved
  on); the CI deselect list and allowlist-accuracy step were deleted with them.
  Unfiltered `uv run pytest -q` = 3521 passed, 11 skipped at `b61188a`.
- **R34** `[DONE — measured 2026-08-14]` The full-data embed was measured with the real
  serving projection over the 2026-06-30 closed period, 998 filers: **five** filers
  exceed the landed 2 MiB per-period byte cap (worst: CIK 0001710537 at 21,449 serving
  rows / 7,78 MiB, the only one also over the 20,000-row cap; the "37,140-position
  filer" of prior revisions is a raw multi-filing count — its authoritative filing is
  12,241 rows / 4.47 MiB). Mean ≈383 B/row; bytes are the binding constraint. **F2 is
  resolved by owner decision 2026-08-14** (see Locked Decisions): capped list with an
  honest terminus, no full-data expansion mechanism.

### Milestone M0b — pipeline and corpus closeout (replaces Revision 3's M0)

- **R1** `[OPS]` `[PARTIALLY DONE]` The deploy closeout: the Cloudflare rollback to
  `2f3830b6` was performed 2026-08-15, the record gate passed without any override, run
  31874606690 deployed and verified, and generation 1 for `20260815.2` is attested.
  **Remaining: arm the nightly (R46), last.**
- **R2** `[OPS]` The runner controller lock is reboot-safe: it records its owning pid and
  treats a lock whose pid is dead as free.
- **R3** `[OPS]` Runner registration is idempotent (`--replace`).
- **R42** `[OPS]` `[PIPELINE]` **Seed-forward.** Every publish run seeds `populus.db`
  from the previous release's `congress.db` before ingest, through the **complete
  existing trust chain, not a bare pointer read**: load and validate the pointer,
  verify the fetched manifest bytes against the pointer's `manifest_sha256`, validate
  the manifest schema (`validate_manifest`), check pointer↔manifest build identity
  (`pointer_manifest_identity_error`), and only then read the `congress.db` module
  entry's `sha256`, fetch the asset through the existing release backend, and verify
  the digest byte-exactly. After verification the seeded working copy has its inline
  `inst_*` tables **removed** — `stage_build` with `--inst-db` unset derives the
  institutional module from inline tables (`_inst_data_present` branch,
  `src/populus/publish/build.py:2777`), so a seeded store would otherwise publish a
  stale institutional snapshot whenever `POPULUS_INST_DB` arrives blank. A bootstrap
  override (repository variable `POPULUS_CONGRESS_SEED_DB`, a machine-local path, same
  posture as `POPULUS_INST_DB`) exists for the one run where no published release
  carries the full corpus; it too is digest-verified against a recorded sha256 before
  use. An unset override plus no fetchable release is a refusal, not a fresh-DB
  fallback — the fresh-DB path is exactly what produced B24 and B25.
- **R43** `[OPS]` **One-time bootstrap backfill.** The first seeded run uses the local
  `data-20260802.2` `congress.db` (sha256
  `086c937ec290eefa85b104f30382c0a740745dcc7c3ba7e29f120f95b8139105` — pinned HERE as
  the authoritative record; the local `builds/20260802.2/manifest.json` that also
  records it is **untracked** in the data repository, so this plan text, not that
  file, is the durable pin) as the seed — it carries House 2014-01-02 →
  2026-07-20 (9,211 filings) — plus a one-time bounded Senate era ingest
  (`--submitted-start 01/01/2012 --submitted-end 04/30/2026`, overlapping the seed's
  2026-03-24 Senate floor; upserts make the overlap harmless) to fill the Senate history
  the seed lacks. The run then proceeds through the normal pipeline, and its release
  becomes the first published complete corpus — after which R42 needs no override ever
  again. Supervised dispatch, owner watching.
- **R44** `[PIPELINE]` **Corpus-preservation guard, identity-based.** The seed step
  records a JSON sidecar of **identity baselines, not bare counts**: per
  (source, chamber), the full sorted `filing_id` list from `filings` and the joined
  `(filing_id, bioguide_id)` pair list (filings grain — `apply_member_join` writes
  `filings.bioguide_id` and denormalizes), plus per-pair `transactions` counts and the
  run's start timestamp. Counts alone are rejected twice over: (a)
  `v_default_transactions` excludes the original of every actively superseded filing
  (`src/populus/views.sql:23`), so amendment healing lowers it without loss; (b) raw
  `transactions` are NOT append-only — `load_filing` atomically DELETEs and replaces a
  filing's whole parsed set (`src/populus/load.py:513`), so a corrective reparse
  legitimately lowers a raw count; and (c) aggregate joined counts can be offset — new
  joins can mask historical identities NULLed by a truncated-but-nonempty roster,
  because the join pass rewrites every filing (`src/populus/members.py:651`). After
  the ingests and member join, the guard refuses the build if **any** of these holds:
  any seed `filing_id` is absent from `filings` (filings are never deleted — no
  supported path removes one); any seed joined pair `(filing_id, bioguide_id)` is
  absent post-join; any per-pair `transactions` count decreased **without explicit
  authorization** — a `workflow_dispatch` input `corpus_floor_allow_reparse` naming
  the exact filing_ids whose corrective replacement is expected, so a legitimate
  reparse is a reviewed event, never a silent one, and the same input authorizes
  reviewed join corrections; there is no `ingest_runs` row with `job='members'` and
  `status='ok'` started at or after the sidecar's run timestamp (a seeded store keeps
  historical joins nonzero, so the landed total-absence refusal at
  `src/populus/publish/build.py:2658` can no longer prove THIS run's join executed);
  the sidecar is absent, unparseable, or records zero pairs (fail closed, never
  vacuous). Defense-in-depth upstream: the roster fetcher's floors already refuse a
  truncated roster document, and the identity floor here catches anything past them.
  A shrunken or identity-swapped corpus is indistinguishable from a quiet week to
  every existing gate; this makes it a loud refusal instead.
- **R45** `[PIPELINE]` `[FRONTEND]` **File-budget constants re-measured once, on the
  restored tree.** `M1_MEASURED_PAGES` and `SITE_CHROME_FILES`
  (`src/populus/inst_budget.py:134,140`) are re-measured against the first
  complete-corpus build **in the production configuration** (no ticker map —
  `publish.yml` deliberately points `POPULUS_TICKER_MAP` at a nonexistent path), per
  owner decision 2026-08-15: the constants describe what actually ships, and each
  docstring names the configuration and states that restoring per-stock pages (TD-7)
  would add the ticker-tree delta back. Deliberately **not** done before R43: measuring
  the B25-shrunken tree would have encoded the outage as the baseline (the exact error
  BACKLOG B18 warns against). Closes B18.1 and B18.2. B18.3 (the search index at 3.4×
  its 128 KiB budget) stays open and is expected to worsen with 321 members restored —
  recorded, not solved here.
- **R46** `[OPS]` **Arm the nightly, last.** The owner sets the repository variable
  `POPULUS_SELFHOSTED_VALIDATED='true'` (the workflow's own arming contract at
  `publish.yml:62-66`) only after witnessing the R43 supervised run publish, deploy,
  verify, and attest with the corpus guard green. Owner action; the plan only sequences
  it.

### Milestone M1 — P0 defects + baseline

- **R4** `[FRONTEND]` Remove the masthead build watermark (`Base.astro:97`; the footer at
  `:138` already prints the identifiers — a deletion, not a relocation). Add the missing
  intermediate breakpoint so nav, search, and brand cannot collide.
- **R5** `[FRONTEND]` No feed cell paints over its neighbour; each row renders its traded
  date exactly once.
- **R6** `[FRONTEND]` The changes table answers "added or trimmed?" without horizontal
  scrolling, with a scroll affordance at every width.
- **R7** `[FRONTEND]` Member names render legibly; no stat tile is clipped.
- **R8** `[PIPELINE]` `[FRONTEND]` The changes table identifies securities by issuer name
  plus ticker where admitted, never by key (`ui.ts:993` still prints `position_key`
  raw). A period-keyed projection joins over the already-denormalized `issuer_name` on
  serving rows. Unresolvable keys render a plain-English unknown.
- **R9** `[FRONTEND]` The stat strip renders exactly the tiles it has data for
  (`global.css:335` is `display: flex`; re-diagnose against rendered geometry).
- **R10** `[FRONTEND]` No raw flag slug reaches a default view, and fail-visible
  survives: an unknown flag still renders a visible generic warning, raw token in the
  provenance layer. **UNIVERSAL caveats state once at table level** — a flag carried by
  EVERY row of a table, not merely by most of them.

  **Amended 2026-08-19 (owner), from "near-universal" to "universal".** The original
  wording could not be implemented truthfully. At exactly 100% the hoist is
  information-preserving: "every row below carries X" is literally true, and dropping
  the per-row badge deletes nothing. Below 100% the rows that LACK the flag are the
  informative ones — suppressing the badge on the majority erases the only thing
  distinguishing them, and a note reading "every row" over a table where one row
  differs is simply false. Measured on the restored corpus at implementation time:
  **23 member tables carry `missing_ticker` on 50 of 50 rows** and hoist; **6 more sit
  in the 90–99% band** and keep their per-row badges deliberately. A truthful sub-100%
  form would need either different wording ("50 of the 51 rows below…") or a visible
  marker on the exceptions; both are editorial choices, and neither is required to
  remove the noise this requirement exists to remove.
- **R35** `[FRONTEND]` Layout defects verified by real browser geometry at five widths;
  `@playwright/test` (Chromium only) as a devDependency, provisioned in CI.
- **R36** `[FRONTEND]` Analytics fully specified, **and the published privacy promise
  rewritten in the same change** — `methodology/index.astro:206` and
  `scripts/search-client.ts:52` currently state the site collects nothing; both change
  in the same commit as the beacon, or neither changes. The retention contract is now
  LOCKED from Cloudflare's own published FAQ (fetched 2026-08-15): unsampled beacon
  data is retained for 7 days, then aggregated to roughly 10%; the previous six months
  are accessible; query strings are not logged. The methodology copy states exactly
  that, attributed and dated. Delivery is locked too: the site ships **no CSP today**
  (verified — no `_headers`, no `http-equiv`, nothing in the deploy path), so R36
  introduces `dashboard/public/_headers` whose complete, byte-exact rule is LOCKED
  here (round-3 F2; corrected after the confirmation round measured the WHOLE dist
  rather than one page's script elements): a single `/*` block carrying exactly
  `Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-l7z5mLHE3mvA5XUH9QJEiNRmReuFTfsBcWHAxRGvW3k=' 'sha256-MqA3PKuITCptalBQPnAhrxVICEdcFhUVx47/2VNIkDU=' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`
  Measured census, all 3,668 built pages: exactly TWO distinct inline script modules,
  each on every page — the 389-byte pre-paint theme script (`sha256-l7z5…`) and the
  933-byte theme-toggle module (`sha256-MqA3…`) — both hashes computed from emitted
  `dist` bytes; `style=` ATTRIBUTES on 3,642 pages carrying unbounded data-driven
  values (`barHtml`/`flowRibbon` widths), which no finite hash set can cover, so
  `style-src` carries `'unsafe-inline'` deliberately and WITHOUT any style hash
  (CSP2+ ignores `'unsafe-inline'` in a directive that also lists hashes — listing
  both would silently re-block every bar) — an authorized, documented posture:
  style injection is a rendering nuisance, not script execution, and honesty-bearing
  content never lives only in styling. The drift guard is a WHOLE-DIST sweep test:
  recompute the distinct inline-script hash set across every built page and assert
  set-equality with the locked pair — it fails on a changed pre-paint script, a
  changed toggle module, AND any unapproved new inline surface. If M1's own edits
  change either script, the locked hashes change in the same commit.
  **This deliberately changes a security posture the deploy pipeline enforces, so
  every consumer changes with it, in the same milestone — the provider-control
  envelope (round-3 F1):** the inventory document gains a `control_files` list
  (path, bytes, sha256) beside `files`; `_headers` moves there
  (`src/populus/publish/inventory.py:28`). Full-tree byte binding is preserved:
  `_require_copy_faithful` (`src/populus/deploy/snapshot.py:259`) compares the
  copied set against `files` ∪ `control_files`, so packaging still refuses any
  unaccounted byte, while the domain-serving sweep iterates `files` only. The
  verifier keeps every control-path probe (including `/_headers`) exactly as-is,
  adds `content-security-policy` to `ALLOWED_RESPONSE_HEADERS` as a REQUIRED header
  equal to the locked value above, and gains missing-policy, altered-policy, and
  hash-drift negative tests. Consumers scheduled: `snapshot.py`, `inventory.py`,
  `verify.py`, the served file-count sites (`site_file_count` counts `files` only;
  control files are named in the build record), and their tests. The beacon is one
  script tag in `Base.astro` carrying the site token (a public value, not a secret)
  via `data-cf-beacon`. Former open decision F5 is closed by this lock.
- **R28** `[FRONTEND]` The beacon ships with M1, so a pre-redesign baseline exists.

### Milestone M2 — translation layer

- **R11** `[FRONTEND]` One typed slug-to-microcopy map, exhaustive over every flag and
  footnote registry.
- **R12** `[FRONTEND]` One shared glossary component with a static no-JavaScript
  fallback; every definition also reachable as text (no tooltip-only honesty channel).
- **R13** `[FRONTEND]` Per-table footnotes collapse into one "About this data"
  disclosure after the table, generalizing `institutionalDataNoteHtml`
  (`holdings.ts:216`). Stable caveat IDs; ID-set equality asserted across the
  translation; the fold-test extension lands first.
- **R14** `[FRONTEND]` Contradictory-looking counts get one computed reconciling
  sentence; identical per-row metadata lifts above its table.
- **R15** `[FRONTEND]` No control that cannot act is clickable; the filer page defaults
  to the filer's latest period.
- **R16** `[FRONTEND]` Amount bars declare their scale; dates, filing lag, and owner
  codes render in plain English.

### Milestone M3 — filer intelligence and curation (CONDITIONAL — entry gated on owner decisions)

**M3 is not executable from this plan alone.** Entry requires, in writing: the F4
per-archetype section-set table, the F7 notable-section predicates, and the R18
registry signature process — plus R31's calibration run, whose `T_*` quantile outputs
are measured, never authored. Until those exist this milestone has the same standing
as M6: designed, sequenced, and blocked. The contracts below are carried as reviewed
design intent, not as build authorization.

- **R31** `[PIPELINE]` Calibration is the M3 **entry gate**: every threshold selected by
  the specified quantile algorithm over the full corpus on one closed quarter, with the
  stability check (±1 reportable unit moves no archetype's membership by more than 5%);
  measured outputs become the golden fixtures. **The full corpus now exists only after
  M0b** — calibration on the shrunken corpus would measure the outage, so M0b precedes
  M3 by data dependency, not just sequencing preference.
- **R17** `[PIPELINE]` Archetype classification from closed quarters only, by the exact
  predicates of Revision 3 (§Architecture), pinned by implementation-independent golden
  cases. Curated-only archetypes are never heuristically assigned.
- **R18** `[PIPELINE]` Identity-language claims only for research-confirmed filers with a
  citable source and an effective period; outside the interval, measured shape language.
  Registry requires owner signature before identity labels publish.
- **R37** `[PIPELINE]` `[FRONTEND]` Publicly identified principals render with name,
  role, as-of date, and source; stale loudly (>18 months warns); principals enter the
  shipped search index with a removal-failing fixture.
- **R19** `[PIPELINE]` `[FRONTEND]` The filer template renders per archetype; layout and
  suppression sets separated by confirmation state. Parity asserts multiset equality of
  the identity tuple `(period_of_report, cik, position_key, put_call, ssh_prnamt_type)`
  and field-level equality across the server render, the client period re-render, and
  **the capped embed** (the third path was "the full-data expansion" in Revision 3; F2's
  resolution replaces it — parity semantics unchanged, applied to the capped set).
- **R20** `[PIPELINE]` `[FRONTEND]` The published, formula-transparent follow score of
  Revision 3 (§Architecture), ranking by research-worthiness; `/institutional/` defaults
  to it at ~150 confirmed filers, complete table one click away.
- **R21** `[PIPELINE]` `[FRONTEND]` The notable-managers surface for the most recent
  closed quarter, JSON emitted through exactly one topology: a dist-only Astro route.

### Milestone M4 — insight layer (CONDITIONAL — follows M3, inherits its gate)

- **R22** `[FRONTEND]` A quarter digest with exact formulas; the summary sentence drops
  any clause whose input is missing.
- **R23** `[PIPELINE]` `[FRONTEND]` Four inline-SVG charts per filer page,
  dependency-free, each with a data-table fallback, gapping rather than interpolating.
- **R24** `[FRONTEND]` The archetype renders as a one-line context note under the filer
  name.
- **R25** `[PIPELINE]` `[FRONTEND]` Cross-navigation scoped to entity-keyed identities,
  conditional on measured coverage: below the 5% floor R25 defers and is recorded as
  deferred.
- **R26** `[FRONTEND]` A live institutional module on the homepage; feed rows make the
  member-profile link obvious.
- **R38** `[PIPELINE]` `[FRONTEND]` Reported-holdings composition above the changes,
  ranked by share of reported value, with the required scope statement; never
  "portfolio". Rows past the landed caps are withheld with the honest terminus (F2
  resolution), never silently.
- **R39** `[FRONTEND]` Congressional disclosed-trading views: surface the landed
  `memberV2Sections` from the feed and reconcile copy with the M2 map. **No new
  interval mathematics.**
- **R27** `[FRONTEND]` Site-wide: data precedes caveats, typography separates provenance
  from insight, wide tables behave on mobile without hiding honesty-bearing content.

### Milestone M6 — sector composition (BLOCKED on F6, unchanged)

- **R30** `[PIPELINE]` Wire the landed sector and committee ingests into `publish.yml`.
- **R40** `[PIPELINE]` The SIC snapshot producer (`scripts/`, network stays out of
  library code) and the owner-signed investor rollup with fund and unclassified buckets.
- **R41** `[FRONTEND]` `sectorMix` normalization: exact value shares on the
  institutional side, labeled count shares on the congressional side, no synthesized
  midpoints.
- **Blocker unchanged:** `sectorResolver` (`data.ts`) needs both `sectorData` and
  `tickerMap`, and `publish.yml` deliberately withholds the ticker map. Producing SIC
  data does not light the panel. Owner + counsel-adjacent decision required; do not wire
  around it.

### Audit disposition matrix (R33)

| # | Audit finding | Disposition |
|---|---|---|
| 1 | Header watermark overlaps nav | R4 |
| 2 | Feed asset/side overprint | R5 |
| 3 | Changes table clipping | R6 |
| 4 | Member names truncated | R7 |
| 5 | Empty seventh stat tile | R9 |
| 6 | Congress landing imbalance | R7 |
| 7 | Contradictory counts | R14 |
| 8 | Dead period tabs | R15 |
| 9 | Redundant per-row dates | R14 |
| 10 | Keys in the changes table | R8 |
| 11 | Flag slugs as UI text | R10, R11 |
| 12 | Universal badge carries no information | R10 |
| 13 | Footnote soup | R13 |
| 14 | Identifiers billed equally with names | R8, R11 |
| 15 | No tickers on the institutional side | R8, bounded by entity-keyed admission |
| 16 | Zero visualization | R23, R41 |
| 17 | No "so what" layer | R22, R38 |
| 18 | No relative context | R22, R38 |
| 19 | Dealer misread trap | R24, R19 |
| 20 | Unlabeled bars and owner codes | R16 |
| 21 | Cryptic dates and lag | R16 |
| 22 | No entity pages from the feed | R26, R39 |
| 23 | Homepage sells mission | R26 |
| 24 | Alarming truncation notices | R13 |
| 25 | Typography and hierarchy | R27 |

No finding is declined.

---

## Scope

| # | Milestone | Requirements | Exit gate |
|---|---|---|---|
| Pre | Preconditions | R32, R33, R29 ✅, R34 ✅ | Done except the standing R32 re-survey duty |
| M0b | Pipeline + corpus | R1(tail), R2, R3, R42, R43, R44, R45, R46 | A published complete-corpus release; guard green; constants re-measured; nightly armed last |
| M1 | P0 defects + baseline | R4–R10, R35, R36, R28 | Geometry green at five widths; unfiltered `make check` green |
| M2 | Translation | R11–R16 | No raw slug, key, or schema reference in any default view |
| M3 | Curation — **CONDITIONAL** | R31, R17, R18, R37, R19, R20, R21 | Entry gate: F4 + F7 decisions and the R18 signature exist in writing; then calibration precedes classification |
| M4 | Insight — **CONDITIONAL** | R22–R27, R38, R39 | Follows M3; composition precedes changes |
| M6 | Sectors — **BLOCKED** | R30, R40, R41 | F6 owner/counsel decision — do not enter |

**The executable scope of this plan is Preconditions + M0b + M1 + M2.** M3 and M4 are
designed and sequenced but conditional: their entry decisions (F4, F7, R18 — and R31's
measured constants, which cannot be authored) are owner-owned and recorded below, and
reaching either milestone without them is a stop, exactly as M6 is for F6. Dependency
spine: **M0b → M1 → M2 → [gate] → M3 → M4 → [gate] → M6.** Two hard data dependencies
underpin the ordering: R45 (and therefore a green unfiltered `make check`, and
therefore every later milestone's exit gate) requires the restored corpus, and R31's
calibration must run on that corpus or it measures the outage.

---

## Non-goals

- No price data, ever.
- No proprietary sector or identifier standard; no expansion of the identifier posture.
- No accounts, no server-side state.
- No rebuilding of landed work (interval algebra, sector ingest, member v2 sections,
  holdings tables, congress notable rail, banned-wording scanner).
- No claimed congressional balances; no "portfolio" claims for congressional data.
- No virtualization.
- **No full-data expansion mechanism** — superseded by F2's resolution (capped + honest
  terminus). Revision 3's static-shard alternative is not built.
- **No merge-by-SQL of two release databases** for the corpus bootstrap (rejected in
  Alternatives) — the bootstrap uses only supported ingest paths.
- No M6 work of any kind until the F6 decision exists.

---

## Constraints

1. **Banned wording is gate-enforced** by `dashboard/test/lib/banned-scan.ts`
   (word-boundary regexes over `dist/`, raw bytes, NUL-safe). `sold` is banned; say
   "sales", "exited". "between" and the noun "moves" are safe. New surfaces must enter
   the covered-file assertion. The scanner also bans "fund size" outright — the
   institutional footnote was reworded 2026-08-15 to keep the disclaimer inside the ban.
2. 13(f) value is not assets under management.
3. Closed quarters only for classification, scoring, aggregates.
4. Interval arithmetic only through the landed typed algebra (`sumRanges`,
   `NetInterval`); no parallel implementation.
5. Null is never zero and never satisfies a threshold.
6. Fail-visible stays fail-visible; nothing honesty-bearing hidden by a media query or
   tooltip-only.
7. **`grep -a` always** — `derive.ts` contains a deliberate NUL byte.
8. Budgets at the pinned base: `GLOBAL_FILE_CAP = 18_000` (`inst_budget.py:118`),
   ≤1,500 filer pages, 25 MiB per file, landed per-page holdings caps 20,000 rows /
   2 MiB (`holdings.ts:528,543`).
9. Gates: `make check` = `uv sync --frozen` + unfiltered `uv run pytest -q` +
   `cd dashboard && npm ci && npm run gates` (check → test → `build:bounded` →
   `test:post`; `build:bounded` refuses under 32 GiB RAM) + `make security`.
   **`test:post` never runs in CI** (hosted runners are under the RAM floor) — the
   authoritative post-build run is local; this is why B24 was invisible and why every
   milestone's gate evidence must include a local `make check`.
10. No new backend queries from the dashboard.
11. The publish job runs on the self-hosted `populus-ops` runner (owner's Mac); deploy /
    sign / assert-signed stay GitHub-hosted and hold the credentials (§14). New workflow
    steps must not move credentials across that boundary.
12. Library code performs no network access; network lives in `scripts/` or behind the
    injected transports of `publish/` backends.
13. An unset GitHub repository variable arrives as the **empty string**, not an absent
    env key. Every new workflow-fed knob must treat blank as unset (`.strip() or
    default`) and refuse rather than build a malformed value — re-learned at the cost of
    a 2h11m run (31861037053).

---

## Current State

Verified against `origin/main@b61188a` and the live site on 2026-08-15.

### What the Revision 3 execution changed

- **R29 done** (PR #37): the M2-11 trio removed; CI and `make test` now run the identical
  unfiltered set; 3,521 passed / 11 skipped at the base.
- **B24 found and fixed** (PRs #37, #38): `publish.yml` had never run `ingest members`,
  and `apply_member_join` (`members.py:645`) is the only writer of
  `transactions.bioguide_id`, so builds `20260807.1`–`20260814.1` published with zero
  member pages. Now: `scripts/fetch_legislators_cache.py` (CC0 roster, validation floors,
  fail-fast placement before the ingests), the "Ingest members (identity join)" step, and
  a `stage_build(expect_member_join=True)` refusal declared at both production CLI call
  sites and pinned by an AST test. Live proof: 176 members in the search index,
  `/congress/members/A000383/` and `P000197/` serve 200.
- **The deploy path works** (PR #39): `_resolve_serving_anchor` walks production
  deployments newest-first and anchors on the one serving the domain's marker;
  `_assert_anchor_is_serving` (R11c) is kept as the independent proof after resolution.
  Run 31874606690 completed publish → deploy → verify → attest end-to-end; generation 1
  for `20260815.2` is attested and matches the domain.
- **Two Revision 3 premises falsified.** (a) "No deploy has ever completed" — deploys had
  been completing daily since 20260807.1; the M0 framing was rebuilt around the marker
  mismatch instead. (b) "The three pytest nodes are why every gate is red" — the
  post-build suite carried four more genuine reds (B18.1/2, the fund-size wording
  contradiction since fixed, and B24's missing member tree).

### B25 — the corpus is still incomplete (the reason M0b exists)

The runner builds a fresh `populus.db` every run. Measured consequences, from the release
databases:

| Release | House rows | House window | Senate rows | Senate window |
|---|---|---|---|---|
| `20260802.2` (last local) | 57,068 | 2014→2026 | 991 | 2026 only |
| `20260812.1`+ (CI) | 2,857 | 2026 only | 14,198 | 2014→2026 |

Root causes, from code: House `default_years` (`src/populus/ingest/house.py:74`) is the
current year only (plus January's look-back), so a fresh store can never recover
2014–2025; Senate `_submitted_start_date` (`src/populus/ingest/senate.py:602`) backfills
from `01/01/2012` when the store is empty — which both explains CI's Senate history and
means every nightly on a fresh store re-fetches 14 years of Senate filings (the ingest
step measured 2h02m on run 31874606690).

Bootstrap constraints, verified: `data-20260802.2` was **never published** (GitHub
releases begin at `data-20260808.1` — `gh release view data-20260802.2` → not found), so
its 865 MB `congress.db` exists only locally; its digest is pinned in this plan (R43); the local
`builds/20260802.2/manifest.json` that also records it (`sha256 086c937e…`, plus a
`logical_digest`) is untracked in the data repository. The
release backend already exposes `verify_asset`/`read_asset`
(`src/populus/publish/build.py:182,190` and both backend implementations), and the
current release's `congress.db` asset is 52.6 MB. The Senate CLI already supports bounded
historical eras (`--submitted-start`/`--submitted-end`, `cli.py:136-151`). The
machine-local-path-via-repository-variable pattern is precedented by `POPULUS_INST_DB`
(`publish.yml`, stage-build step). The nightly arming switch is
`vars.POPULUS_SELFHOSTED_VALIDATED` (`publish.yml:62-66`), currently unset by design.

### Still broken at the pinned base (unchanged from Revision 3 where not noted)

- `Base.astro:97` masthead watermark (footer `:138` already prints the identifiers).
- `ui.ts:993` prints `esc(d.position_key)` raw.
- `global.css:335` `.tiles` is `display: flex`.
- `methodology/index.astro:206` and `scripts/search-client.ts:52` still promise
  no-analytics (R36 pairs the rewrite with the beacon).
- B18.3: the search index ships 451,932 B against a 128 KiB budget, worsening with the
  corpus restore.
- The three post-build file-budget tests are red at the base and stay red until R45 —
  deliberately, so the constants are measured on the restored tree, once.

### Landed and reused (unchanged)

Interval algebra (`derive.ts:117-322`, 5×5 table at `test/net-interval.test.ts:36`);
`sectorMix` (`derive.ts:724`); sector ingest (`sectors.py`, CLI `cli.py:417`);
`memberV2Sections` (`ui.ts:1606`); holdings tables with caps and terminus
(`HoldingsTable.astro`, `holdings.ts:373-489,528-594`); banned-wording scanner; congress
notable rail (`derive.ts:868`, `ui.ts:1512`).

---

## Detected Stack

- **Python ≥3.12** at the root — `pyproject.toml`, `uv.lock`, pytest
  (`testpaths=["tests"]`), producers in `src/populus/`, httpx + pyyaml available.
- **Node / TypeScript (Astro)** at `dashboard/` — `package.json` + lockfile,
  `astro check`, `node --test`.
- **Gates:** `make check` per Constraint 9; `make security` = `scripts/dep_guard.py`
  (which also greps owned source for network primitives — comments count, so avoid the
  bare word "requests" in `src/populus/`).
- **CI:** `.github/workflows/checks.yml` (python job now unfiltered; dashboard job runs
  check + unit only). `.github/workflows/publish.yml`: publish on self-hosted
  `populus-ops`, deploy/sign/assert-signed GitHub-hosted; schedule `17 6 * * *` gated by
  `POPULUS_PUBLISH_ARMED` and `POPULUS_SELFHOSTED_VALIDATED`.

---

## Reuse Map

| Need | Landed primitive | Disposition |
|---|---|---|
| Fetch + verify a release asset (R42) | backend `verify_asset`/`read_asset` (`publish/build.py:182,190`; LocalDir + gh-release impls) | **Reuse** — no new download code |
| Pointer/manifest authentication (R42) | pointer loader + `manifest_sha256` byte check (`publish/build.py:3386`), `validate_manifest` (`publish/manifest.py:513`), `pointer_manifest_identity_error` (`publish/manifest.py:659`) | **Reuse the complete chain** before any asset read |
| Asset identity (R42, R43) | `congress.db` `sha256` + `logical_digest` in each build's `manifest.json` | **Reuse** as the seed's integrity pin |
| Machine-local input via repo variable (R43) | `POPULUS_INST_DB` pattern in `publish.yml` stage-build step | **Follow the pattern** for `POPULUS_CONGRESS_SEED_DB` |
| Senate historical era (R43) | `ingest congress-senate --submitted-start/--submitted-end` (`cli.py:136-151`) | **Reuse** — no new fetch path |
| Declared-expectation refusal (R44) | `expect_member_join` / `expected_modules` in `stage_build` | **Follow the pattern**; guard is a workflow-step CLI check with the same fail-closed posture |
| Empty-env-var hygiene (R42–R44) | `fetch_legislators_cache.py` `.strip() or DEFAULT` + refusal | **Follow the pattern** for every new knob |
| Interval mathematics (R39) | `sumRanges`, `NetInterval` family (`derive.ts:117-322`) | Reuse wholesale |
| Sector grouping (R41) | `sectorMix` (`derive.ts:724`) | Extend with normalization only |
| Member disclosed-trading (R39) | `memberV2Sections` (`ui.ts:1606`) | Surface + copy-align |
| Holdings caps + terminus (R38, F2) | `capRows`, `HOLDINGS_EMBED_*` (`holdings.ts:528-594`), terminus row in `holdingsTableHtml` | **Reuse as-is** — F2's resolution is this mechanism |
| Issuer names for keys (R8) | denormalized `issuer_name` on serving rows | Join, not a resolver |
| Institutional data note (R13) | `institutionalDataNoteHtml` (`holdings.ts:216`) | Generalize |
| Flag rendering (R10) | `format.ts:246-301` | Extend, preserving fail-visible |
| Footnotes (R13) | `footnoteBlock` (`format.ts:644`) | Extend with stable IDs |
| Chart pattern (R23, R41) | `flowRibbon`, `barHtml` (`ui.ts:114-216`) | Follow the pattern |
| Concentration stats (R20, R23) | `agg_filer_concentration`, `filerTiles` (`ui.ts:874`) | Reuse as inputs |
| Notable rail pattern (R26) | `notableRecent` (`derive.ts:868`), `notableRailHtml` (`ui.ts:1512`) | Follow for the institutional twin |
| Search index (R37) | `searchIndexJson` producer in `data.ts` | Extend with principals |
| Owner-signed data files (R18, R40) | `sic_taxonomy.yaml`, `committee_jurisdiction.yaml` | Follow the pattern |
| Honesty-fold enforcement (R13) | `test/css-fold.test.ts` | Extend, never weaken |

---

## Architecture

### R42/R43/R44 — the corpus loop (new)

**Seed resolution (R42).** A new CLI command, `populus seed-corpus`, implemented in
`src/populus/publish/seed.py` and wired through `cli.py`:

1. **The full trust chain, reused, in order** — load the pointer (`latest.json`)
   through the existing pointer loader and validate its shape; fetch the manifest
   bytes and verify `sha256(manifest_bytes) == pointer.manifest_sha256` (the exact
   check the recovery path already performs at `src/populus/publish/build.py:3386`);
   `validate_manifest` on the parsed document; `pointer_manifest_identity_error`
   (`src/populus/publish/manifest.py:659`) to bind pointer build id to manifest build
   id. Only a manifest that survived all four steps may name the seed.
2. Read the validated manifest's `congress.db` module entry (`path`, `sha256`,
   `bytes`); fetch the asset through the injected release backend (`read_asset`) to a
   temp path and verify the sha256 byte-exactly; a mismatch deletes the partial file
   and refuses. Note the honest I/O statement: `read_asset` returns complete `bytes`
   in memory — for the 906,575,872-byte bootstrap seed that is a ~0.9 GiB transient
   allocation on a 32 GiB-floor machine, acceptable and stated rather than pretended
   to be streaming.
3. Bootstrap override: `--seed-db <path> --seed-sha256 <digest>` (fed by
   `POPULUS_CONGRESS_SEED_DB` / `POPULUS_CONGRESS_SEED_SHA256`; blank-as-unset per
   Constraint 13). The file is copied and digest-verified exactly like a fetched
   asset. Override and pointer path are mutually exclusive inputs to one run.
4. After verification: `ensure_views` + `ensure_subline_columns` reconcile an
   older-era store (idempotent, existing), then **inline `inst_*` tables are dropped
   from the seeded working copy** — with `--inst-db` unset, `stage_build` derives the
   institutional module from inline tables (`src/populus/publish/build.py:2777`), and
   the 20260802.2 seed carries 1,013 `inst_filings`; a blank `POPULUS_INST_DB` would
   otherwise publish that stale snapshot as current. Dropping on the copy is
   non-destructive to any source of truth (the accepted external snapshot remains the
   only institutional source), and it makes the unset-variable path degrade to
   exactly today's honest congress-only build.
5. The command then writes `seed-counts.json` — **identity baselines**:
   `{schema_version, seed_build_id, seed_sha256, run_started_at, pairs: [{source,
   chamber, filing_ids: [...], joined: [[filing_id, bioguide_id], ...],
   transactions_by_filing: {...}}]}` measured over the raw `filings` and
   `transactions` tables (see the R44 rationale: the default view shrinks under
   amendment healing, raw transaction counts shrink under corrective reparse, and
   aggregate joined counts can be offset — only identities are stable). At ~12k
   filings the sidecar is a few hundred KB of JSON; stated, not hidden. Zero pairs at
   write time is a refusal (an empty corpus is not a baseline).
6. No fetchable pointer **and** no override = refusal with remediation text. Never a
   fresh DB.

**The guard (R44).** `populus corpus-floor --db populus.db --counts seed-counts.json
[--allow-reparse <filing_id> ...]`, same module, runs after "Ingest members (identity
join)" and before "Stage build". It refuses when any of the following holds:

- any seed `filing_id` is absent from `filings` — filings are never deleted (no
  supported path removes one), so absence is always a broken pipeline;
- any seed joined pair `(filing_id, bioguide_id)` is absent post-join, unless that
  filing_id is named in the explicit authorization list — the join pass rewrites
  every filing (`members.py:651`), so a truncated-but-nonempty roster NULLs
  historical identities while NEW joins offset the aggregates; only pair identity
  catches that (round-2 F3);
- any filing's `transactions` count decreased without that filing_id being named in
  the authorization list — `load_filing` legitimately DELETE-and-replaces a filing's
  parsed set (`load.py:513`), so a corrective reparse is a reviewed, named event
  (`workflow_dispatch` input `corpus_floor_allow_reparse`), never a silent one;
- no `ingest_runs` row with `job='members'` and `status='ok'` exists with
  `started_at >= run_started_at` from the sidecar — on a seeded store the historical
  joins keep the landed total-absence guard (`build.py:2658`) permanently satisfied,
  so this clause is what proves THIS run's join actually executed;
- the sidecar is missing, unparseable, or records zero pairs (fail closed, never
  vacuous).

**Workflow order** (publish job): checkout → uv → gate → **Seed the corpus (R42)** →
Fetch legislators cache → Ingest house/senate → *(bootstrap only)* Senate era ingest →
Ingest members → **Corpus floor (R44)** → Stage build → …unchanged.

**Bootstrap (R43).** One supervised `workflow_dispatch` with a boolean input
`senate_era_backfill` adding the bounded era step
(`--submitted-start 01/01/2012 --submitted-end 04/30/2026`), and the seed override
variables pointing at the local `data-20260802.2` asset with the sha256 this plan
pins. The resulting release carries the complete corpus; the variables are then
cleared and the input never used again (it stays in the workflow as the documented
era-recovery tool). Institutional isolation during and after the bootstrap comes from
R42's inline-table drop, not from an assumption about the variable being set (see
step 4 above; the pre-remediation claim that seeded inst tables were "inert" was
wrong — `build.py:2777` derives an inst module from inline tables when `--inst-db` is
unset).

**Expected corpus after bootstrap:** House ≈57k rows (2014→present, seed + fresh 2026
ingest overlap upserted), Senate ≈15k (era fetch + seed overlap + fresh), members joined
by the landed R-B24 machinery (95.2% measured join rate on the shipped store; residual
name variants stay counted in `unresolved_names`).

### R45 — the measurement, once

After the bootstrap release deploys: build the dashboard locally against that release's
staged build in the production configuration (ticker map absent), run the file-budget
measurement the post-build suite already contains, and set `M1_MEASURED_PAGES` and
`SITE_CHROME_FILES` to the measured values with docstrings naming the configuration and
the TD-7 caveat (B18's instruction). The three red post-build tests then pass with their
existing ±1,000 drift tolerance; no test logic changes.

### R8 — the security directory, period-keyed (executable scope; inlined in full)

`agg_security_directory(period_of_report, position_key, issuer_key, issuer_name,
class_title, ticker NULL, cusip NULL, resolution_source)`, primary key
`(period_of_report, position_key)`. Period-keying is required: a single row per key
would stamp a present-day ticker onto a historical row. Deltas join on their reporting
period; exit rows join on the prior period. Where one key has several name or class
variants in one period, the representative is the highest reported value, then
lexicographic identity. `ticker` is non-null only for entity-keyed identities. Because
`issuer_name` is already denormalized onto serving rows, the projection is a join over
landed serving data, not a new resolution path. An empty resolved name is a build
error; an unresolvable key renders a plain-English unknown.

### R13 — the disclosure (executable scope; inlined in full)

One disclosure per table, after it, generalizing `institutionalDataNoteHtml`
(`holdings.ts:216`). Each caveat carries a stable ID; an authored old-to-new mapping is
the contract, and the test asserts ID-set equality with translated content checked
separately — sentence equality would forbid the translation the requirement exists to
perform. The in-table terminus row stays. Because the codebase forbids tooltip-only
honesty channels, every caveat is text inside the disclosure. The fold-test extension
and the `DESIGN-BRIEF.md` entry land first.

### R35 — the geometry harness (executable scope; inlined in full)

`@playwright/test`, Chromium only, as a devDependency in `dashboard/package.json` with
the corresponding lockfile entry; CI installs `npx playwright install --with-deps
chromium` before the post-build stage. Ships nothing to visitors. The suite loads real
`dist` output through the existing preview server at 360, 720, 964, 1080, and 1440
pixels and asserts bounding-box non-intersection for the masthead cluster and each
feed cell pair, absence of unintended overflow, visibility of the scroll affordance,
and zero unoccupied trailing area in the stat strip. It must fail on a deliberately
reintroduced overlap. It joins `test:post`, the only stage with a real `dist` — and
therefore runs locally, never in CI (Constraint 9).

### R36 — analytics plus the promise rewrite (executable scope; inlined in full)

Mechanism: Cloudflare Web Analytics — one script tag in `Base.astro` loading
`https://static.cloudflareinsights.com/beacon.min.js` with the site token (public
value) in `data-cf-beacon`. Collected: page URL (no query strings — Cloudflare's
stated behavior), referrer, coarse user-agent, viewport bucket, load timing, and a
server-derived country. No cookie, no local storage, no fingerprint, no cross-site
identifier. **Retention, locked from Cloudflare's published FAQ (fetched 2026-08-15):
unsampled beacon data is retained 7 days, then aggregated to roughly 10%; the previous
six months are accessible.** The methodology copy states the provider, the fields, and
exactly that retention, attributed and dated. Delivery: the site currently ships no
CSP at all (verified), so R36 introduces `dashboard/public/_headers` with a
Content-Security-Policy including `https://static.cloudflareinsights.com` (script-src)
and `https://cloudflareinsights.com` (connect-src) from its first version. The promise
rewrite replaces `methodology/index.astro:206` and reconciles
`scripts/search-client.ts:52` in the same commit as the beacon. Tests assert: no
cookie and no storage key written; the page functions with the beacon blocked; the
`_headers` policy names both origins; no absolute no-analytics claim remains anywhere
in copy.

### M3/M4 contracts — carried by reference to the staged archive (conditional scope)

The calibration algorithm and predicate order (R31/R17), curated registry fields
(R18/R37), recipe families and the parity tuple (R19), follow-score components and
caps (R20), the single publication topology (R21), the 5% coverage floor (R25), and
the composition statement (R38) carry forward verbatim from
`docs/design/UX-OVERHAUL-PLAN.r3.md` §Architecture — **added to the Git index
(`git add`, uncommitted) alongside this plan and its brief, so the owner's next
commit carries all three and a clone loses nothing**; the local-exclude entries that
previously hid them are removed. Two
amendments apply on top of the archived text:

1. **F2 resolution (owner, 2026-08-14):** there is no full-data expansion. Filer pages
   embed `capRows`' capped set; the terminus row names the exact withheld count and
   links the source filing. R19's third parity path is the capped embed. R34's
   measured figures (five filers over the byte cap; worst 21,449 rows / 7.78 MiB)
   become the terminus-copy fixtures.
2. **R31 runs on the restored corpus** (M0b exit is its data precondition), and its
   `T_*` outputs are measurements — this plan never authors them.

### New aggregate tables — unchanged from Revision 3

`agg_security_directory`, `agg_filer_profile`, `agg_notable_quarter`,
`agg_filer_optionsmix`, as specified in Revision 3; all additive.

---

## Locked Decisions

1. Identifier posture unchanged; counsel flag stays open.
2. Filer labeling — hybrid (heuristics classify; identity language needs confirmed,
   sourced, period-bounded entries).
3. Naming — "Notable managers."
4. Follow score — displayed publicly with formula and input transparency.
5. **Full-data mechanism — superseded (owner, 2026-08-14): capped list with an honest
   terminus** ("showing N of M positions — the rest are in the source filing, linked"),
   using the landed caps. No shard fallback, no expansion.
6. Launch bar — flip the institutional default at ~150 confirmed filers.
7. Analytics — add it, and rewrite the published privacy promise in the same change.
8. Congress framing — "disclosed trading," never a portfolio.
9. Sector composition — own milestone, last, blocked on F6.
10. Substrate interface — identity denormalized on serving rows; R8 is a join.
11. **File-budget constants describe what actually ships (owner, 2026-08-15)** — the
    production no-ticker-map configuration, with the other configuration recorded in the
    constant's docstring (B18's "do not just re-measure" instruction honored by
    sequencing the measurement after corpus restoration).
12. **Corpus restoration before overhaul (owner, 2026-08-15)** — "stop and fix the data
    pipeline first," extended by accepting the seed+backfill recommendation of
    2026-08-15: one-time bootstrap from the `20260802.2` seed plus a bounded Senate era
    fetch, then permanent seed-forward.
13. **Fund-size wording (owner, 2026-08-15):** the disclaimer was reworded; the scanner's
    ban stays absolute, no carve-outs.
14. **Analytics retention copy (locked 2026-08-15, from Cloudflare's published FAQ):**
    unsampled 7 days, aggregated to ~10% thereafter, six months accessible, query
    strings never logged; methodology copy states exactly this, attributed and dated.
    CSP delivered via a new `dashboard/public/_headers`. (Closes the former open
    decision F5.)

Open decisions (owner). None gate the executable scope (Preconditions + M0b + M1 +
M2). All of these gate the CONDITIONAL milestones, and reaching one without its
decision is a stop: **F4** per-archetype section sets and **F7** notable-managers
predicates and **R18** registry signature (gate M3/M4 entry; F3's `T_*` constants are
R31 measurements, not a paper decision), **F6** the sector identity mapping (blocks M6
entirely).

---

## Alternatives Considered

| Alternative | Why rejected |
|---|---|
| Backfill-only (re-fetch House 2014–2025 in CI, no seeding) | `default_years` fetches one year per `--year` invocation; ~13 PDF-heavy year fetches against a government server, hours per run, repeated on any future store loss. The data already exists locally with a recorded digest. |
| Seed-only (no Senate era fetch) | The seed's Senate floor is 2026-03-24 and the watermark rule (`MAX(filed)−90d`) means 2012→2026-03 would never be fetched. The corpus would stay incomplete forever. |
| SQL-merge `20260802.2` House tables into `20260815.2` | Hand surgery across FK-linked tables (filings, transactions, fingerprints, ingest_runs) with no supported path; the bounded era ingest is the code the pipeline already trusts. |
| Standalone upload of the old congress.db as a release asset | Bypasses manifest/attestation identity; R42 would seed from an asset no build manifest describes. |
| Permanent local-path seeding (always `POPULUS_CONGRESS_SEED_DB`) | Re-creates manual toil each run and breaks if the runner moves; the pointer→manifest→asset chain is self-verifying and already exists. The local path is bootstrap-only, digest-pinned. |
| Corpus guard inside `stage_build` (like `expect_member_join`) | The floor is relative to an extrinsic seed baseline `stage_build` has no business reading; the member guard is intrinsic (rows exist ∧ none joined). A CLI step with fail-closed sidecar handling keeps one mechanism per kind of invariant. |
| Re-measure the file-budget constants now | Encodes the B25 outage as the baseline — B18's named error. Sequenced after restoration instead. |
| Arm the nightly immediately (a supervised run has now succeeded) | The very next nightly would publish a shrunken corpus. Armed only after the corpus loop is closed (R46 last). |
| Full-data expansion via static shards (Revision 3's F2 option) | Owner chose the capped list; the shard mechanism's parity identity and budget machinery is complexity with no remaining requirement. |
| Proceeding with M1 before M0b | Every milestone's DoD includes an unfiltered green `make check`, which is impossible before R45, which must not run before R43. |

---

## Planned Files

New (M0b):

- `src/populus/publish/seed.py` (R42, R44)
- `tests/test_corpus_seed.py` (R42, R43, R44)

Modified (M0b):

- `src/populus/cli.py` — `seed-corpus` and `corpus-floor` commands (R42, R44)
- `.github/workflows/publish.yml` — seed step, era-backfill dispatch input,
  `corpus_floor_allow_reparse` dispatch input, corpus-floor step (R42, R43, R44)
- `tests/test_workflow_governance.py` — master-arm gates both event types; disarm and
  resume variables match the runbook (R42, R46)
- `src/populus/inst_budget.py` — re-measured constants + configuration docstrings (R45)
- `ops/runner/runner-controller.sh` (R2), `ops/runner/config.sh` invocation (R3)
- `BACKLOG.md` — close B25, B18.1, B18.2; keep B18.3 open with the corpus-growth note
- `docs/runbooks/deploy.md` — seed/bootstrap/era-recovery documentation (R42, R43)

New (M1–M4, carried verbatim from Revision 3):

- `dashboard/src/lib/microcopy.ts` (R11, R12)
- `dashboard/src/components/Term.astro` (R12)
- `dashboard/src/pages/institutional/all/index.astro` (R20)
- `dashboard/src/pages/institutional/notable/index.astro` (R21)
- `dashboard/src/pages/institutional/data/notable.v1.json.ts` (R21, R26)
- `src/populus/notable_filers.yaml` (R18, R37)
- `dashboard/test/microcopy.test.ts` (R11)
- `dashboard/test/archetype-render.test.ts` (R19)
- `dashboard/test/post/geometry.test.ts` (R35)
- `dashboard/public/_headers` (R36)
- `tests/test_filer_profile.py` (R17, R18, R31)
- `tests/test_notable_quarter.py` (R21)
- `tests/test_security_directory.py` (R8)

New (M6, blocked): `src/populus/sector_rollup.yaml`, `scripts/fetch_sic_snapshot.py`,
`tests/test_sector_rollup.py`, `tests/test_sic_snapshot.py` (R40)

Modified (M1–M4, carried from Revision 3):

- `dashboard/package.json`, `dashboard/package-lock.json` (R35)
- `dashboard/src/layouts/Base.astro` (R4, R28, R36)
- `dashboard/src/styles/global.css` (R4, R5, R6, R7, R9, R13, R27)
- `dashboard/src/lib/format.ts` (R5, R10, R16)
- `dashboard/src/lib/ui.ts` (R6, R9, R13, R14, R15, R19, R22, R23, R24, R25, R37, R38, R39)
- `dashboard/src/lib/derive.ts` (R8, R19, R41)
- `dashboard/src/lib/holdings.ts` (R13, R25, R38)
- `dashboard/src/lib/inst.ts` (R8, R17, R21, R23)
- `dashboard/src/lib/data.ts` (R37)
- `dashboard/src/pages/congress/index.astro` (R7, R11, R16, R39)
- `dashboard/src/pages/congress/members/[bioguide].astro` (R39, R41)
- `dashboard/src/pages/institutional/index.astro` (R20)
- `dashboard/src/pages/institutional/filers/[cik].astro` (R19, R22, R23, R24, R37, R38)
- `dashboard/src/pages/institutional/tickers/[t]/holders.astro` (R25)
- `dashboard/src/pages/index.astro` (R26)
- `dashboard/src/pages/methodology/index.astro` (R12, R20, R28, R36, R40)
- `dashboard/src/scripts/search-client.ts` (R36)
- `src/populus/publish/inventory.py` — `_headers` declared as a provider-control
  artifact, excluded from the serving inventory, digest recorded (R36)
- `src/populus/deploy/verify.py` — `content-security-policy` required with the exact
  locked value; control-path probes unchanged (R36)
- `src/populus/deploy/snapshot.py` — `_require_copy_faithful` compares against
  `files` ∪ `control_files`, preserving full-tree byte binding (R36)
- `tests/test_deploy_snapshot.py` — control-envelope faithfulness cases (R36)
- `tests/test_deploy_verify.py` — missing-policy and altered-policy negative tests
  (R36)
- `dashboard/test/css-fold.test.ts` (R13)
- `dashboard/test/pages-render.test.ts` (R8, R10, R22)
- `dashboard/test/search.test.ts` (R37)
- `dashboard/test/post/http-status.test.ts` (R21)
- `dashboard/test/post/banned-wording.test.ts` (coverage for new surfaces)
- `src/populus/inst_agg.sql`, `src/populus/inst_agg.py` (R8, R17, R21, R23)
- `src/populus/sic_taxonomy.yaml` (R40)
- `docs/build/M2-CONTRACT.md` (R8, R21)
- `DESIGN-BRIEF.md` (R13)

---

## Implementation Tasks

**Preconditions — executed 2026-08-14/15; record-keeping tasks only.**

0a. R32 — Keep the worktree pinned at `b61188a`; re-run the survey for affected claims
    if the base advances before a milestone starts.
0b. R33 — Keep the 25-row disposition matrix current as requirements are revised.
0c. R29 — Done (PR #37); no further work; its matrix row carries the evidence.
0d. R34 — Done (measured 2026-08-14); carry the measured figures into the F2 terminus
    copy fixtures in R38.

**M0b — pipeline and corpus closeout.**

1. R2 — Reboot-safe controller lock; test dead-pid and live-pid at shell level.
2. R3 — Idempotent runner registration (`--replace`); test the pre-existing case.
3. R42 — Implement `seed.py` + `seed-corpus`/`corpus-floor` CLI: the full
   pointer→manifest→asset chain (reusing the four landed validators), byte-exact
   digest verification, inline `inst_*` drop on the seeded copy, identity baselines
   (filing_ids, joined pairs, per-filing transaction counts) with the members-run
   proof and the `corpus_floor_allow_reparse` authorization path, blank-as-unset env
   handling, refusal paths.
   Unit tests: the five negative chain cases; sidecar-absent/zero-pair fail-closed;
   seeded-store inst behavior under blank AND set `POPULUS_INST_DB`; amendment
   healing lowers the default view yet passes the floor; the offset-roster case
   refuses (truncated-but-nonempty roster, aggregates held level by new joins); an
   unauthorized reparse refuses and an authorized one passes; a seeded run with the
   join step omitted refuses; and a mutation check that disabling the identity
   comparison fails a test.
4. R44 — Wire the seed and floor steps into `publish.yml` (order per Architecture), and
   add the `senate_era_backfill` dispatch input this task shares with R43.
5. R43 — Owner provisions `POPULUS_CONGRESS_SEED_DB`/`_SHA256`; one supervised dispatch
   with the era flag; witness gate → seed → ingests → era → members → floor → build →
   deploy → attest; confirm the release's per-chamber windows (House 2014→, Senate
   2012→) and clear the bootstrap variables.
6. R45 — Build against the bootstrap release in production configuration; re-measure;
   update the two constants + docstrings; prove the three post-build tests green and
   `make check` green, unfiltered, locally.
7. R46 — Owner sets `POPULUS_SELFHOSTED_VALIDATED='true'`; next morning, confirm the
   scheduled run ran (not skipped), its floor held, and its generation was attested.
   This closes the R1 tail — R1's deploy core is already done and evidenced in the
   matrix.
8. Close B25, B18.1, B18.2 in `BACKLOG.md`; document the seed loop in the deploy
   runbook.

**M1.** 9. R4 → 10. R5 → 11. R6 → 12. R7 → 13. R8 → 14. R9 → 15. R10 → 16. R35 →
17. R36 (mechanism + both privacy-copy files in one commit) → 18. R28.

**M2.** 19. R11 → 20. R12 → 21. R13 (fold-test extension, caveat IDs, mapping, brief
entry first; then the shared disclosure) → 22. R14 → 23. R15 → 24. R16.

**M3 — CONDITIONAL; do not enter without the F4 + F7 decisions and the R18 signature
process in writing.** 25. R31 (entry gate, restored corpus; `T_*` measured, never
authored) → 26. R17 → 27. R18 (**stop for owner signature**) → 28. R37 → 29. R19 →
30. R20 → 31. R21.

**M4 — CONDITIONAL; follows M3 and inherits its gate.** 32. R38 → 33. R39 → 34. R22 →
35. R23 → 36. R24 → 37. R25 (measure coverage; ship or defer at the 5% floor) →
38. R26 → 39. R27.

**M6.** 40. **STOP** — F6 is an owner/counsel decision. Only after it exists: 41. R30 —
wire both ingests into the publish workflow; 42. R40 — SIC snapshot producer plus the
signed investor rollup; 43. R41 — normalization and the ranked list with per-side share
semantics.

---

## Testing Strategy

- **Corpus loop (R42–R44):** unit tests over `seed.py` with a fake backend — the five
  negative chain cases (malformed pointer; manifest bytes vs `manifest_sha256`
  mismatch; cross-build identity; missing `congress.db` module entry; malformed
  artifact entry); asset digest mismatch refuses and deletes the partial;
  pointer-absent + override-absent refuses; blank env falls back (mutation: revert the
  `or`-fallback fails a test, per the 31861037053 regression class); inline `inst_*`
  drop proven under both blank and set `POPULUS_INST_DB` (blank ⇒ congress-only build,
  set ⇒ external snapshot authoritative); floor refuses on a vanished seed filing_id, a
  vanished joined pair — including the offset case: a truncated-but-nonempty roster
  that NULLs historical joins while enough new joins keep every aggregate level — an
  unauthorized per-filing transaction decrease, a missing THIS-run members
  `ingest_runs` row (seeded store, join step omitted — must refuse despite nonzero
  historical joins), a missing sidecar, and zero pairs (fail-closed, no vacuous
  pass); positive controls prove a grown corpus passes, amendment healing passes
  (default view shrinks, identities survive), and a corrective reparse passes when
  its filing_id is named in `corpus_floor_allow_reparse`. Bootstrap acceptance is operational: the R43 run's release is
  queried for per-chamber windows and counts, recorded in the PR.
- **Constants (R45):** the existing three post-build tests are the assertion; no new
  test logic, only measured values.
- **Geometry, not markup (R35):** Chromium against real `dist` at 360/720/964/1080/1440,
  bounding-box non-intersection, overflow, affordance visibility, zero trailing area;
  must fail on a reintroduced overlap.
- **Absence with presence (R8, R10, R11):** `grep -a`-negative for key prefixes and
  slugs in default views, paired with positive fail-visible assertions.
- **Stable-ID parity (R13);** multiset + field parity across the three render paths
  (R19, third path = capped embed); golden fixtures from the measured partition (R17,
  R20, R31) with boundary cases at/below/above every frozen constant; refusal tests on
  open-quarter input (R21, R31); privacy behavior (R36: no cookie, no storage key,
  functional with the beacon blocked, no absolute denial left in copy); coverage gating
  (R25); search principal fixture failing on removal (R37); reuse guards — the landed
  5×5 interval table and sector-mix tests stay green (R39, R41).
- **Runner behavior (R2, R3)** at shell level.
- Every milestone's gate evidence includes a **local** unfiltered `make check` (CI
  cannot run `test:post`, Constraint 9).

---

## Verification Matrix

| ID | Verification |
|---|---|
| R32 | Worktree base is `b61188a`; re-survey on advance |
| R33 | All 25 rows present, each pointing at a live requirement |
| R29 | ✅ CI and `make test` run the identical unfiltered set; 3,521 passed at base (PR #37) |
| R34 | ✅ Measured 2026-08-14: 5 filers over the byte cap, worst 21,449 rows / 7.78 MiB; figures feed the F2 terminus copy |
| R1 | ✅ deploy ran and verified (run 31874606690); generation 1 for `20260815.2` attested and matches the domain. Tail = R46 |
| R2 | Dead-pid lock permits a cycle; live-pid refuses |
| R3 | Registration succeeds against a pre-existing same-name runner |
| R42 | Full pointer→manifest chain enforced (pointer validated; manifest bytes vs `manifest_sha256`; `validate_manifest`; identity binding) with negative tests for a malformed pointer, manifest-hash mismatch, cross-build identity, missing module entry, malformed artifact entry; seeded store equals the release asset by sha256; inline `inst_*` tables dropped — a seeded store with blank `POPULUS_INST_DB` builds congress-only, and with it set the external snapshot is authoritative (both tested); no fresh-DB fallback exists in the workflow |
| R43 | The bootstrap release's `congress.db` shows House filings 2014→present and Senate filings 2012→present; counts recorded; bootstrap variables cleared after; the era ingest's amendment healing demonstrably passes the raw-table floor while lowering the default view |
| R44 | Floor refuses a vanished seed filing_id, a vanished joined pair (tested: truncated-but-nonempty roster with enough NEW joins to keep aggregates level — must refuse), an unauthorized per-filing transaction decrease, a missing THIS-run members `ingest_runs` row (tested: seeded store with the join step omitted refuses despite nonzero historical joins), a missing sidecar, and an empty baseline; passes a grown corpus, passes amendment healing, and passes a corrective reparse WHEN its filing_id is named in `corpus_floor_allow_reparse` (positive control) |
| R45 | Both constants match a measurement of the restored-tree production build; docstrings name the configuration; the three post-build tests and full `make check` green locally |
| R46 | A **scheduled** (not dispatched) run completed with floor green and an attested generation; variable set only after the witnessed R43 run; governance tests pin `POPULUS_PUBLISH_ARMED` as the master freeze over both event types |
| R4 | Geometry: no masthead intersection at five widths; exactly one watermark per page, in the footer |
| R5 | Geometry: 40-char ticker does not intersect the side cell; one date per row |
| R6 | Column order asserted; decisive columns inside 1024px; cue at all widths |
| R7 | Geometry: 20-char member name not truncated at 964px; no clipped tile from 360px |
| R8 | Period-correct join on a historical row; deterministic representative; grep-negative for key prefixes; unresolvable renders plain English |
| R9 | Rendered geometry shows zero unoccupied trailing area; tile count equals data |
| R10 | Known slug never raw; unknown still visibly warned; raw token exactly once, in provenance; a flag on EVERY row of a table stated once above it and suppressed from the rows, including a chip DERIVED from row values rather than read from the flag list |
| R35 | Harness fails on a reintroduced overlap and a removed cue; Chromium installs from the committed lockfile |
| R36 | No cookie or storage key; page functional with the beacon blocked; `_headers` carries the byte-exact locked policy from this plan (single `/*` block; real pre-paint hash, recomputable from dist); the inventory lists it under `control_files` with digest; `_require_copy_faithful` proves `files` ∪ `control_files` equals the copied tree; the serving sweep iterates `files` only; the verifier REQUIRES `content-security-policy` equal to the locked value with missing/altered negative tests, and the whole-dist inline-surface sweep asserts the emitted inline-script hash set equals the locked pair (fails on drift or any new inline surface); control-path probes unchanged; `site_file_count` counts `files` only; methodology copy states the locked retention (7-day unsampled, ~10% aggregate, six-month window), attributed and dated; both copy files changed in the beacon's commit; no absolute denial remains |
| R28 | Beacon present on every page |
| R11 | Map key set is a superset of all registries; source sweep clean (`grep -a`) |
| R12 | Keyboard focus reveals definitions; every used term resolves; definitions exist as text |
| R13 | Caveat ID-set equality; content matches the mapping; print and anchor open it; fold extension green first |
| R14 | Reconciliation sentence from divergent fixtures; no repeated per-row metadata |
| R15 | Unavailable periods disabled with reason; default equals latest period |
| R16 | Legend present; bar title matches range text; codes and lag never untranslated |
| R31 | Every constant traced to a measured quantile + stability check, computed on the post-R43 corpus; golden fixtures emitted |
| R17 | Boundary tests per constant; null fallthrough to unclassified; curated-only archetypes never heuristically assigned |
| R18 | Override, contradiction, and out-of-interval fallback; every confirmed entry has a dated source and effective period; owner signature precedes publish |
| R37 | Principal renders with role and as-of; stale warning beyond 18 months; search fixture fails on removal |
| R19 | Section-set parity per confirmation state; multiset + field parity across server render, client re-render, capped embed |
| R20 | Components unit-tested; cap enforced; missing count published; ties deterministic |
| R21 | Closed-quarter refusal; four sections render; JSON only as a dist route, within budget |
| R22 | Digest renders; missing input drops its clause |
| R23 | Charts at one, two, five quarters; gaps not interpolated; fallback present |
| R24 | Note matches confirmation state and links to provenance |
| R25 | Coverage measured against the 5% floor; ship-or-defer recorded |
| R26 | Module renders from the dist route and links through; member affordance present |
| R38 | Composition above changes; shares sum to reported total; scope statement present; "portfolio" absent; over-cap filers show the terminus with the exact withheld count |
| R39 | Landed member sections reachable from the feed; copy aligned; landed interval tests green; no new interval mathematics |
| R27 | Ordering assertion per page; nothing honesty-bearing hidden; no body overflow |
| R30/R40/R41 | Deferred behind F6; on entry: publish invokes both ingests, panel renders real data, shares per the R41 semantics |

---

## Rollout / Rollback

M0b first, alone: R42/R44 code merges through CI, the R43 bootstrap is one supervised
dispatch, R45 is a follow-up commit, R46 is a variable flip. **Rollback of the seed
loop is publication freeze, never fresh-DB reversion — and the freeze switch is the
MASTER arm, `POPULUS_PUBLISH_ARMED`:** the workflow's job condition
(`publish.yml:62-66`) gates every event on that variable, while
`POPULUS_SELFHOSTED_VALIDATED` gates only `schedule` and deliberately exempts
`workflow_dispatch` — so unsetting the latter would stop nightlies yet leave a manual
dispatch able to publish fresh-DB. Freeze therefore = unset `POPULUS_PUBLISH_ARMED`
(all events stop); resume = restore it (and `POPULUS_SELFHOSTED_VALIDATED` for the
nightly) only with a verified seed in place. The governance suite
(`tests/test_workflow_governance.py`) gains assertions that the master arm gates both
event types and that the exact disarm/resume variables are the ones documented in the
runbook. The site keeps serving the last complete attested release throughout. The
fresh-database path is the proven cause of B24 and B25 — it is not offered as a
rollback at all. A bad bootstrap **release** rolls back exactly like any release: the
deploy path's serving-anchor resolution (PR #39) tolerates provider-side rollbacks,
and the record gate holds the attested pair.

Then one milestone per publish cycle, each gated on a local unfiltered `make check` plus
its acceptance list. Carried deploy hazards: a skipped deploy job reports success —
confirm it ran; the settle precedes the first sweep (R11b); a body-hash mismatch is never
waited out; the rollback anchor is resolved by serving marker and proved independently
(R11c/R11d).

---

## Simplicity Audit

M0b adds: one library module (`seed.py`), two CLI subcommands, two workflow steps, one
dispatch input, one test file, two re-measured constants, zero new tables, zero frontend
changes. Deliberately not added: a new download client (backends exist), a stage_build
parameter for the floor (extrinsic baseline stays in a step), any DB-merge tooling, any
scheduler beyond the existing cron.

Complete unit inventory for new M0b code:

| Unit | File | Responsibility | Reuse target | Removal-failing test |
|---|---|---|---|---|
| `resolve_seed` | `src/populus/publish/seed.py` | pointer→manifest→asset identity | backend `read_asset`/`verify_asset` | `tests/test_corpus_seed.py` |
| `verify_and_place` | `src/populus/publish/seed.py` | digest check + atomic placement | `fetch_legislators_cache` atomicity pattern | digest-mismatch test |
| `write_seed_counts` | `src/populus/publish/seed.py` | identity-baseline sidecar (filing_ids, joined pairs, per-filing txn counts) | raw `filings`/`transactions` | zero-pair refusal test |
| `assert_corpus_floor` | `src/populus/publish/seed.py` | fail-closed identity-preservation check + reviewed-reparse authorization | — | vanished-id, offset-roster, unauthorized-reparse, missing-sidecar tests |
| `seed-corpus`, `corpus-floor` | `src/populus/cli.py` | CLI wiring, blank-as-unset env | Click patterns in file | CLI-level tests |

M1–M6 unit inventory carries from Revision 3 §Simplicity Audit unchanged, minus the
full-data expansion machinery F2's resolution deleted.

---

## Tech Debt Introduced

1. **The bootstrap depends on one machine-local file** until the R43 release publishes;
   removal condition: R43 complete and variables cleared (verified in R43's checklist).
2. **`seed-counts.json` is a per-run artifact, not a published one** — the floor
   baseline resets each run to the seed, and the identity lists make it a few
   hundred KB per run. The `corpus_floor_allow_reparse` input is a human-reviewed
   escape hatch; every use is visible in the dispatch log. A slow leak (one chamber stalling at its seed
   count while the source publishes) is not caught; the freshness watermarks in the
   journal remain the detection surface for that. Owner: pipeline; impact: low;
   removal: fold floor history into the journal if it ever bites.
3. **B18.3 stays open and worsens** (search index over budget, more members incoming).
   Owner: frontend; impact: user-facing weight; removal condition: its own fix, out of
   scope here, re-raised in BACKLOG.
4. Carried from Revision 3: curated registry needs periodic human re-verification;
   frozen calibration constants have no scheduled re-measurement; the SIC snapshot is
   point-in-time; `ui.ts` keeps growing; the privacy promise becomes a maintained claim.

---

## Memory Touch-Points

- `memory-select.sh` returned "unreadable index" on this machine — noted; the loaded
  memory index supplied the applicable lessons instead:
- *plan-v1 authoring gotchas* — 21 headings once each, literal R-ids, backticked paths.
- *always `bash -c` the validator* — zsh word-splitting makes traceability pass
  vacuously.
- *verify-against-a-frozen-tree / measure-the-mechanism* — every new M0b claim above is
  cited to a file:line or a command output from this session; the two falsified
  Revision 3 premises are recorded rather than papered over.
- *a GREEN gate can be green because checks were SKIPPED* — Constraint 9 records that CI
  never runs `test:post`; local `make check` is the authoritative evidence everywhere.
- *negative control must isolate ONE guard / assert the code was REACHED* — R44's
  fail-closed tests require the zero-pair and missing-sidecar branches to refuse, so an
  empty baseline can never pass vacuously.
- *a `pgrep`-style probe matching your own run* — R46's verification requires a
  **scheduled** run, not the dispatch that armed it.
- *green gates and self-authored oracles both lied* — R43's acceptance queries the
  released database's actual windows rather than trusting the run's green steps.

New memory candidates after execution: an unset repository variable is an empty string
(cost: one 2h11m run); a refusal guard without a resolution path converts the documented
escape hatch into a deadlock (R11c→R11d).

---

## Failure-Mode Sweep

- **F0 full-set:** the corpus guard covers every (source, chamber) pair, not just house;
  the privacy copy exists in two files, both in R36's single commit; the wording scanner
  covered-set grows with every new surface; the seed's env knobs all get blank-as-unset
  handling (Constraint 13).
- **F0 secrets:** the seed path handles no credentials (public release assets via the
  already-authenticated backend); bootstrap variables carry a local path and a digest,
  not a secret; §14 credential boundaries untouched (Constraint 11).
- **F0 verify-don't-assume:** house/senate window semantics, release availability,
  backend affordances, arming switch, and seed digests are all cited to code lines or
  command output above; nothing in M0b rests on Revision 3 prose.
- **F1 route/consumer enumeration:** M0b touches no routes; its consumers are the two
  workflow steps and the two CLI commands, all in Planned Files. Gate list is exact
  (Constraint 9).
- **F1 units/NULL:** floor baselines are raw `filings`/`transactions` row counts plus
  joined counts (the default view is rejected — `views.sql:23`); an absent sidecar is
  a refusal, never zero.
- **F1 re-baseline:** done — this revision re-pins to `b61188a`; R32 keeps it honest.
- **F2 full-tree gates:** new Python enters the unfiltered pytest tree and dep_guard's
  network-primitive sweep (avoid the bare word "requests" in owned source — bitten this
  session).
- **F2 removal-failing tests:** enumerated per unit in the Simplicity Audit table.
- **F3 function-not-liveness:** R43 verified by querying the released DB's windows; R46
  by a scheduled run's artifacts, not by the variable being set.
- **F4 propagation:** closing B25/B18.1/B18.2 sweeps `BACKLOG.md` for every stale count
  (17,065-row claims, 5,290-file measurements) in the same commit.
- **F5 transport:** this plan validates as plan-v1 before review; the Revision 3
  artifact is archived, not overwritten.
- Not applicable: connection-pooler read-only (no PG), bulk-SQL backfill (ingest is the
  existing upsert path), RLS simulation (no RLS), dead-CSS (M0b touches no CSS).

---

## Definition of Done

- R32 — based on `b61188a`; survey re-run on advance. R33 — matrix complete.
- R29 ✅, R34 ✅, R1(core) ✅ — evidence recorded in the Verification Matrix.
- R2 — dead-pid locks no longer brick cycles. R3 — registration idempotent.
- R42 — every publish run starts from a seed authenticated through the full
  pointer→manifest chain and verified byte-exactly, with inline `inst_*` tables
  dropped; the fresh-DB path no longer exists in the workflow.
- R43 — a published, attested release carries House 2014→present and Senate
  2012→present; bootstrap variables cleared.
- R44 — a vanished filing identity, a vanished join identity, an unauthorized
  per-filing replacement, or a skipped THIS-run member join is a loud build refusal,
  proven by fail-closed tests including the offset-roster case; amendment healing
  and an AUTHORIZED corrective reparse are proven NOT to trip it.
- R45 — the file-budget constants describe the restored production tree; `make check`
  green, unfiltered, locally.
- R46 — a scheduled nightly completed unattended with floor green and an attested
  generation, armed only after all of the above.

Every M1–M4 requirement additionally closes with a removal-failing test, a local
unfiltered green `make check`, no banned string in `dist`, and no raw internal
identifier in any default view:

- R4 — exactly one build watermark per page, in the footer, with no masthead collision.
- R5 — no cell intersects its neighbour; one date per row.
- R6 — added-or-trimmed readable without horizontal scrolling, with a cue everywhere.
- R7 — ordinary member names render in full; no tile clipped.
- R8 — no key in a default view; every changed position resolves period-correctly or to
  a plain-English unknown.
- R9 — no unoccupied trailing area, proven by geometry.
- R10 — no raw slug in a default view, unknown conditions still visibly warned, and a
  caveat true of every row stated once rather than repeated on each.
- R35 — the harness fails on a reintroduced overlap and installs reproducibly.
- R36 — the mechanism is named and asserted with the locked retention copy (7-day
  unsampled / ~10% aggregate / six-month window, attributed and dated) and the
  `_headers` CSP delivered through updated inventory + verifier contracts (exact
  policy required, control probes unchanged, negative tests), and no shipped build
  misstates what the site collects.
- R28 — a baseline exists before M2 lands.
- R11 — one map, exhaustive over every registry.
- R12 — every term defined once, reachable by keyboard, without JavaScript, and as text.
- R13 — one disclosure per table with caveat-ID parity, opened by print and anchor.
- R14 — no unexplained count pair; no repeated per-row metadata.
- R15 — no dead-end control; latest period by default.
- R16 — scale, lag, and owner codes in plain English.
- R31 — every constant traced to a measured quantile with a stability check, computed
  on the restored corpus, before R17.
- R17 — every filer classified by specified predicates with declared null behavior.
- R18 — no identity claim without a dated, period-bounded, owner-signed source.
- R37 — principals render with role, date, and source, are searchable, and go stale
  loudly.
- R19 — identity-grounded omissions occur only for confirmed filers; parity holds by
  multiset and field across all three render paths.
- R20 — ranking by research-worthiness with a published formula and inspectable inputs.
- R21 — the notable surface reports a closed quarter through one publication topology.
- R22 — the digest leads and never invents a clause.
- R23 — four charts without a shipped dependency, gapping rather than interpolating.
- R24 — a dealer's page cannot be misread as directional exposure.
- R25 — shipped against a measured coverage floor, or recorded as deferred.
- R26 — the homepage shows something live and links into it.
- R38 — composition precedes changes, shares reconcile, scope limits stated, no
  portfolio claim, and over-cap books carry the honest terminus.
- R39 — the landed member sections are reachable and consistent, with no new interval
  mathematics.
- R27 — data precedes caveats everywhere; nothing honesty-bearing hidden.
- R30 — deferred behind F6; on entry, the publish workflow produces the data that
  lights up the sector panel.
- R40 — deferred behind F6; on entry, a real build ships populated sector data with
  investor-legible buckets.
- R41 — deferred behind F6; on entry, value shares on the institutional side, labeled
  count shares on the congressional side, no synthesized midpoints.
