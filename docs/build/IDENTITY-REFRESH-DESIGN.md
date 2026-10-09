# Identity registry refresh on a seeded store

Status: DESIGN, for owner decision. The guard described in §3 is implemented
alongside this note. The refresh path in §4 is NOT implemented.

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
