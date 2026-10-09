# Identity registry refresh on a seeded store

Status: the guard (§3) and option A (`--rebuild-registry`, §6) are IMPLEMENTED
(owner decision 2026-10-09: build option A). Running it in PRODUCTION still needs
the publish-workflow step described in §6.3, which is not built.

## 1. The situation (measured 2026-10-09 on the published data-20261007.1)

- The nightly seeds its working store from the previous release's `congress.db`
  (`populus seed-corpus`, publish.yml). That copy is the PUBLISHED one, so every
  withheld CUSIP is already opaque: `security_list_intervals.value = withheld:<n>`,
  `security_id = sec:withheld:<n>`.
- The registry in production holds ONE SEC 13(f) list quarter, **2026q2**
  (22,521 rows, 9,690 withheld). It was seeded once, 2026-07-30
  (`security_list_seed_ledger`). No workflow, script or runbook refreshes it
  (inventory: audit diagnostic Q3, 2026-10-04). `security_identifiers` is empty.
- `run_identity_bootstrap` on such a store does not recognize the opaque rows. It
  re-inserts the raw list rows as new securities and supersedes every
  `sec:withheld:<n>` id (diagnostic: securities 15 → 30, 14/14 opaque ids lost,
  29/29 interval bindings changed). Published output stays leak-free, but
  identities duplicate and every withheld id changes.

So the registry is frozen at 2026q2, and the only tool that could move it forward
corrupts it.

## 2. What depends on the registry being current

- `plan_cusip_redaction` reads its SEC-list issuer gate from the accepted
  INSTITUTIONAL SNAPSHOT, not from `congress.db`, so withholding of the
  institutional artifacts does not depend on this table's freshness.
- `plan_registry_redaction` withholds `congress.db`'s republished list using
  `filed_cusips` (from the snapshot) together with the list's own naming. A stale
  list only means the republished list is stale.
- Identity resolution in `congress.db` (`resolve_cusip` as-of intervals) cannot
  see securities first listed after 2026q2.

The cost of staying frozen is staleness, not a privacy leak.

## 3. Guard (implemented with this note)

`run_identity_bootstrap` now refuses, before any write, on a store that carries
published-withheld registry values (`security_list_intervals.value LIKE
'withheld:%'` or `securities.security_id LIKE 'sec:withheld:%'`). The refusal
names both counts and points here. Plain bootstrap can no longer silently corrupt
a seeded store. A store holding real CUSIPs (a fresh store, or the owner's
private corpus) is unaffected.

## 4. Options for refreshing (owner decision)

| | Mechanism | Cost |
|---|---|---|
| **A. Rebuild the registry from cached sources (recommended)** | A dedicated `populus identity bootstrap --rebuild-registry`. Inside the bootstrap's single transaction, it empties the registry tables (`securities`, `security_identifiers`, `security_list_intervals`, `security_supersessions`, `security_list_seed_ledger` and the entity links bootstrap owns), then seeds every list quarter from the cached raw SEC files (`data-cache/13flist`, cross-format-checked as today) plus the ticker and FTD sources. The next publish re-withholds from scratch. | Published `withheld:<n>` / `sec:withheld:<n>` ordinals are re-allocated at each refresh (once per quarter). Nothing outside the registry references them in production. Verify the dashboard and MCP first. Needs every historical quarter's raw list cached (6 present today: 2025q1–2026q2). |
| B. Re-bind opaque rows from a CUSIP-bearing source | Map each `withheld:<n>` back to its CUSIP before bootstrapping. | The ordinal→CUSIP map is deliberately recorded nowhere; it could only be reconstructed by re-running the allocation history exactly. Fragile. Rejected. |
| C. Keep a private unredacted registry | Seed the registry from a private store instead of the published release. | A second source of truth beside the release seed, which is exactly what R42 removed. Large change. |
| D. Stay frozen at 2026q2 | Nothing (the guard prevents corruption). | The republished list and as-of resolution go stale quarter by quarter. |

**Recommendation: A**, run once per quarter by the owner when the new SEC list is
published. Acceptance:
- the rebuild runs on a release-seeded copy, then publishes with zero probe pairs;
- integrity and foreign-key checks are clean;
- no duplicate securities;
- every list quarter present;
- the dashboard's registry pages build.

## 5. Not covered

The identity of congressional transactions (A1-05) is unrelated. The
institutional snapshot's own list refresh is the owner's existing inst pipeline.

## 6. `--rebuild-registry` (implemented)

### 6.1 Behaviour

`populus identity bootstrap --rebuild-registry` runs inside the bootstrap's
single `BEGIN IMMEDIATE` transaction:

- It empties the eight registry tables, child-first:
  `security_list_intervals`, `security_identifiers`, `security_supersessions`,
  `security_list_seed_ledger`, `securities`, `entity_tickers`, `entity_names`,
  `entities`.
- It then re-seeds them from the ticker, FTD and 13(f)-list sources and the
  identity-registry YAML. A failure anywhere rolls the reset back with
  everything else.

It refuses before any write if `inst_filers` or `inst_holdings` hold rows (they
reference the registry). It refuses if no list quarter is selected, so a
rebuild can never empty the SEC list. Without the flag, a release-seeded store
is still refused, and the refusal names the flag.

### 6.2 Measured on the published data-20261009.1 (2026-10-09)

The rebuild was run on a copy with the cached `company_tickers.json`
(10,426 rows, the file of the 2026-07-31 production run), the cached SEC lists,
`--list13f-start-quarter 2026q2` and `--as-of 2026-07-31`. Result:

- 20 s.
- `entities`, `entity_names` and `entity_tickers` are row-for-row identical to
  the live release (8,017 / 8,017 / 10,426).
- The list has the same 22,521 rows. All 12,831 non-withheld rows are
  unchanged, and the 9,690 withheld rows carry their real CUSIPs again.
- Zero duplicate securities (the incremental bootstrap would have doubled them).
- Integrity and foreign-key checks are clean. The seed ledger carries the same
  2026q2 list sha256.

Publishing the rebuilt store, with the real `apply_registry_redaction` against
the 23 GB institutional snapshot, took 91 s. Integrity and foreign-key checks are
clean, and it **withholds 7,926 list rows where the live release withholds
9,690**:

- **Nothing new is exposed:** every row the rebuild withholds is also withheld
  live (0 rows only-rebuilt).
- **The 1,212 distinct rows withheld only live** are fund-family share-class
  siblings (iShares, Direxion, Invesco, First Trust, VanEck blocks). None is
  itself a reviewed-ticker (issuer, class).
- **Why they are only live:** production has only ever added to the withheld
  set (prior `withheld:<n>` rows are kept forever). These rows match the
  over-withholding that #117's SEC-list seeding gate fixed: mis-filed CUSIPs
  dragging whole issuer blocks in.
- **So a rebuild applies today's reviewed rules and REPUBLISHES those CUSIPs.**
  By #117's own reasoning that is the correct result, but it is a visible change
  to published data, and the owner should accept it before the first
  production rebuild.

This run also found a W2 defect, fixed alongside the flag. The locator guard's
bare `name.ext` branch ran through the SEC list's `*` "added" marker
(`08975P108*COMMERCE.COM INC`) and refused to publish ANY store still holding
real list rows: a fresh build, a rebuild, or a disaster recovery. Published
releases never hit it, because those cells were already swept.

**Pass `--as-of` with the date the `company_tickers.json` was fetched.** Without
it, the ticker snapshot is stamped "today", and as-of resolution between the
real fetch date and today loses those entities.

### 6.3 Reaching production (NOT built)

The nightly seeds its store from the previous published release
(`populus seed-corpus`), so a rebuild run on a workstation never reaches the
site. Production use needs a `workflow_dispatch`-only input on `publish.yml`
(for example `rebuild_registry_from_quarter`). After the seed and the existing
`fetch_ticker_registry.py` step, that input must:

1. fetch the SEC 13(f) list files with provenance sidecars. No script does this
   today; `ingest/list13f.py:_LiveSource` exists but nothing calls it;
2. run `populus identity bootstrap --rebuild-registry --as-of "$(date -u +%F)"
   --list13f-cache <fetched> --list13f-start-quarter <input>` before
   `stage-build`.

Publishing re-allocates the opaque withheld ordinals once, at that run.

