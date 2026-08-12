# RUN M2-11 — publish the institutional module from an accepted source snapshot via a self-hosted runner

**Artifact:** plan-v1 · **Revision: 6 — APPROVED at review round 6 (2026-08-08)**, one wording nit applied in place (LD-10; R22 binding) · **Scope class: L** ·
**Transport: interactive-disk** · **Date: 2026-08-08** · **Base: `origin/main` @
`a80812f`**.

**Execution record (2026-08-11):** implementation and the append-only T0-v11
binding run are complete. T0-v11 exited zero at SHA-256
`7078a42934484c9c5ba7f975654476e0788c385dbaf8108c0d429a58ba91a453`
(63,400 bytes / 171 lines); full aggregate/serving times were 156.725 s and
123.690 s, and the final tail projection was 14,553/18,000 files. The
tail-pagination delta is controlled by
`RUN-M2-11-T0-tail-pagination-delta-plan.md` at SHA-256
`068e7fc04edf61e0e3d25e40ff504b003faa0d0ab6d26fa65982a4899e119fad`.
Independent QA approved the exact candidate on round 3 with token
`sha256:7747af94f5100803543d822c06fd989033c7525a43f2da1e459e3f285ebcb8cb`.
Documentation review, PR/merge, and supervised deployment remain pending and
must not be inferred from this execution record.

**Naming note:** M2-9 and M2-10 are taken; this run is M2-11; withdrawn refresh scope
lives at `docs/build/RUN-M2-12-inst-refresh-stub.md` (T13), which now also carries the
snapshot-retention obligation (round-3 reviewer note).

**Owner decisions on the record:** Option 1 (self-hosted publish job). **OD-1 RESOLVED:
always-on.** **OD-4 RESOLVED — verbatim acceptance (2026-08-08):** *"Acknowledged. I
accept the residual risk of operating an ephemeral self-hosted runner associated with a
public repository. Public/untrusted PR execution is excluded by workflow governance;
however, a compromise of trusted workflow code, dependencies, or the runner during an
authorized job could expose the data-repository credential and read-accessible store
contents for the duration of that job."* **Broadened at revision 5 (owner decision, option (b), 2026-08-08 — "good with your
recommendations"):** the acceptance now explicitly includes **residual same-UID
persistence** beyond the reconstructed runner root (user-level launch agents, scheduled
tasks, writes outside the root), bounded by: non-admin account, no keychain access, OS
ACL read-only data access, and a PAT rotatable on suspicion. See TD-4.

### Review round 5 — finding-by-finding resolution

| Finding | Resolution in this revision |
|---|---|
| F1 outlier exception defeats the 1 MiB invariant; diagram still says ≤64 | **Exception removed:** a single filer payload exceeding 1 MiB triggers the **same architecture stop** as any irreconcilable budget — no oversized dedicated shards, no silent widening; a removal-fails test pins the single-payload-over-ceiling case. The diagram's stale "≤64" replaced with measured N. |
| F2 controller test descriptions still say "static invariants" | Both active sections (Planned Files, Testing Strategy) now make the **behavioral fake-root suite authoritative** — destructive-target refusals, ordering, locking, registration refusal — with static credential-environment assertions supplemental. |
| F3 payload contract named groups, not properties | R22 now carries the **literal FilerPayloadV1 type** built from the existing published contracts (ConcentrationRow, QoqDeltaRow, FilingWindow, FilerSurfacePayload), naming every property including the separate `topn: number` beside `topn_share_bps`, keyed period collections, and nullable fields. |
| F4 `classifyEntityResponse` does not exist | Row corrected to the real seams: `runEntityDriver` filer branch **extended**; `parseEntityKey` **reused unchanged**; no new classifier. |
| N1 one memory citation unprefixed | Cited as `feedback_qa_fail_batch_remediation.md` in the reviewer's canonical store. |

### Review round 4 — finding-by-finding resolution

| Finding | Resolution in this revision |
|---|---|
| F1 ≤64 shards optimizes the provider limit, not the reader | **LD-10 (owner-approved):** a **1 MiB client-response ceiling** per tail lookup, consistent with the existing 2 MiB-per-period holdings bound; shard count **derived from T0 measurement** of the serialized tail within the ~1,800-file headroom; T0 gains a client-response-size stop condition; hard stop for an architecture decision if byte and file budgets cannot both hold. The 64-shard cap is repealed. |
| F2 payload/link closure incomplete | R22 now locks the **exact FilerPayloadV1 field set** (both the aggregate body inputs and the holdings-surface inputs), **one filer-href primitive**, and the full propagation closure — `activity.ts`, `data.ts`, and the holders page added to Planned Files; boundary-CIK and period-switch tests enumerated. |
| F3 provenance | *Resolved by reviewer.* |
| F4 snapshot finalization | *Resolved by reviewer.* |
| F5 subtree reconstruction ≠ full same-UID cleanup | **Owner chose option (b), recorded below:** keep the dedicated-account + reconstruction design and **broaden the acceptance** to residual same-UID persistence (user launch agents, scheduled tasks, out-of-root writes), bounded by no-admin, no-keychain, ACL read-only data, rotatable PAT. The reviewer's **behavioral controller tests** are adopted regardless: disposable fake root, target allowlist, refusal of empty/root/home/symlink targets, process→log→wipe→verify→restore ordering, concurrency lock, refuse-register-unless-cleanup-verified. |
| F6 projection-as-gate wording | Planned-file description corrected: the post-build suite asserts the **measured tree** (incl. the new shard family); projection-term completeness tests live only in the budget test module; projections stay report-only. |
| F7 audit not at public-symbol level | Simplicity Audit gains a **public-symbol enumeration** (exported functions, types/schemas, constants); the closing rule now binds unplanned **public** abstractions; internal helpers stay implementation details. |
| N1 memory aliases unresolvable | Touch-points now cite **resolvable paths** in this project's memory directory. |
| N2 installer ambiguity | Locked: **no code change** to the installer; a coverage test exercises the generic path over the new artifact; the path is removed from Planned Files. |

### Review round 3 — finding-by-finding resolution

| Finding | Resolution in this revision |
|---|---|
| F1 validator + R14/R15 trace | *Resolved by reviewer.* No change. |
| F2 long tail not addressable; `/e/` driver hard-codes filers to S2; consumers unplanned | **R22 rewritten as an addressable topology:** a small versioned **CIK→shard routing index** + byte-bounded shard pages; a **shared server-side payload assembler** extracted from the holdings component; the driver's existing error taxonomy (`bad_payload`/version/network/server) preserved, not remapped to S2; the full transitive consumer closure (`entity-client.ts`, `derive.ts`, `ui.ts`, `HoldingsTable.astro`, paginator) planned. Verified: `entity-client.ts:272` currently routes every filer to S2 — that branch is in scope. |
| F3 identity | *Resolved by reviewer* (subject to F5 finalization, below). |
| F4 provenance not wired; `module_db_artifacts` is DB-only | **R24 rewritten:** snapshot metadata is written **into the snapshot itself** (a strict `inst_source_meta` table) *before* hashing, so stage-build reads version/created_at/view-digest from the hashed file and computes the SHA-256 itself. `inst_source.json` publishes as an **ordinary path-backed artifact** — verified: the `db_artifacts` tuple is DB-specific with logical digests and stays untouched; the generic installer path handles ordinary artifacts already. |
| F5 backup+checkpoint leaves WAL mode; ro open recreates sidecars | **Reproduced empirically this revision** (dest mode `wal` after backup and after checkpoint; `PRAGMA journal_mode=DELETE` returns `delete`). **R23 finalization corrected:** views + meta → checkpoint → `journal_mode=DELETE` asserted → close → assert no sidecars → reopen under final read-only permissions and re-verify (views + `integrity_check`) → hash → build at a temp sibling, fsync, refuse existing destination, atomic rename. `immutable=1` permitted only on the finalized copy. Hash-equality claims reworded as corroboration, not proof of zero physical writes to a live WAL family. |
| F6 rollout ordering | *Resolved by reviewer.* No change. |
| F7 fresh `_work`/HOME insufficient; same-UID persistence survives | **R7 rewritten:** the controller recreates the **entire writable runner root** per job from a controller-owned clean image (runner install, credentials, `_work`, HOME, caches, per-job `TMPDIR`), terminates residual runner-UID processes before destruction, preserves logs externally first; toolchain is root-owned read-only. The controller is **committed code with tests** (`ops/runner/`), not runbook prose. TD-4 restated. |
| F8 budget formula omits the committed M3 reservation (2,064) | **Verified against my own budget module** — the exact omitted-term defect it documents. New **R27:** `inst_budget.py` + its tests are in scope; the projection gains filer-shard and routing-index terms while **retaining every existing term including M3**; projections remain evidence, the measured post-build tree remains the enforcing gate. |
| F9 Simplicity Audit not exhaustive | **Rewritten as an exhaustive disposition table** — every new or materially extended abstraction, with forcing requirement and rejected simpler alternative. |

---

## Goal and Success Criteria

**Goal.** The nightly `data-publish` workflow produces a build whose institutional (13F)
module is **present**, derived at stage time from an **accepted, immutable, versioned
source snapshot** cut from the ops-local audit store (canonical store
`~/projects/Populus-ops/populus-m28.db`: main file 23,058,628,608 bytes, WAL, 16,922,879
holdings, 46,081 filings, 9,458 filers, 6 periods — verified 2026-08-08), published as
`inst_agg.db` + `inst_serving.db` + the `inst_source.json` provenance artifact, and
deployed to `publicfilings.org` under the bounded web-delivery contract (≤1,500
pre-rendered filer pages + the addressable `/e/` long tail) — replacing the
honest-withheld state.

**Success criteria:**

1. After the owner sets the validation variable (post-T11), a **scheduled** nightly
   completes end-to-end on the self-hosted runner, all jobs green.
2. `/institutional/` renders; a top-1,500 filer renders pre-rendered; a long-tail filer
   resolves through the routing index to its shard and renders its portfolio through the
   `/e/` driver with HTTP 200 (not S2); no institutional link 404s; withheld banner gone.
3. A spot-checked rendered row's accession resolves on EDGAR.
4. The canonical audit store receives **zero writes** from this run; snapshot creation
   opens it read-only via the backup API; main-file hash equality before/after is
   recorded as **corroboration** (WAL families cannot be byte-proven by main-file hash
   alone — the enforcement is the read-only open modes plus the OS ACL).
5. Congress artifacts byte-identical to a pre-change baseline build.
6. Measured `dist/` count ≤ 18,000 with the module present, with the projection formula
   carrying **every** committed term (incl. M3's 2,064).
7. Rollback demonstrated dry: `POPULUS_INST_DB` unset ⇒ congress-only; snapshot rollback
   = repoint the variable, never a restore.

## Requirements

IDs stable; R14/R15 retired, numbers not reused.

- **R1** — `stage-build --inst-db PATH` (the accepted snapshot): presence, coverage,
  aggregation, serving read from it; absent ⇒ byte-identical to today.
- **R2** — Snapshot opened read-only (`mode=ro`, and `immutable=1` permitted because the
  finalized copy is genuinely immutable — never on the live store); file `0444`,
  directory non-writable for the runner account; a write attempt is a hard
  `PublishError`.
- **R3** — stage-build verifies the snapshot's view definitions against the shipped SQL;
  mismatch/absence fails closed naming the view, pointing at the R23 snapshot-cut
  remediation.
- **R4** — Path via `vars.POPULUS_INST_DB`; unset ⇒ congress-only; no machine literal
  committed.
- **R5** — Publish job `runs-on: [self-hosted, macOS, populus-ops]`; `deploy`, `sign`,
  `assert-signed` stay `ubuntu-latest`.
- **R6** — Shape tests extended, never weakened (labels, three `ubuntu-latest` pins,
  `vars.` pin, R25 gate pin; TD-4 dispatch-input assertions untouched).
- **R7** — Runner isolation (round-3 model — one-job-clean is a *mechanism*, not a
  wish):
  (a) dedicated non-admin account; audit-store and snapshots directories ACL read-only
  for it; no access to the owner's home/keychain;
  (b) registration credential and the controller live in a separate privilege domain
  (owner-side launchd daemon); the runner account cannot read either;
  (c) **per-job clean environment by reconstruction:** before each registration the
  controller destroys the previous **entire writable runner root** — runner
  installation, credentials, `_work`, HOME, caches, and the job's dedicated `TMPDIR` —
  after terminating any residual runner-UID processes and copying logs to the owner
  domain; it then restores a pristine runner image owned by the controller. The
  toolchain (uv, node) is root-owned and read-only, checksummed at job start.
  (d) the controller is **committed, tested code** (`ops/runner/` script + plist),
  with **behavioral tests** (round-4 F5), not static grep-checks: run against a
  disposable fake root — wipe destroys exactly the allowlisted target; **refusal** of
  empty, `/`, `$HOME`, and symlinked targets; enforced ordering
  (terminate processes → export logs → wipe → verify-empty → restore image);
  a concurrency lock; and **registration refused unless cleanup verified**;
  (e) repo-wide governance test: no PR-like triggers anywhere; self-hosted labels in
  exactly one job;
  (f) owner setting: fork-PR approval for all outside collaborators;
  (g) what reconstruction cannot close — same-UID persistence outside the runner root
  (user launch agents, scheduled tasks, arbitrary UID-writable paths) — is **accepted,
  not claimed closed**, per the owner's option-(b) decision; enumerated in TD-4.
- **R8** — Runbook covers what code cannot: account/ACL creation, controller install,
  clean-image provisioning, always-on `pmset`, teardown. Everything executable is a
  script the runbook *invokes*, not describes.
- **R9** — Workspace lifecycle verified at T11: fresh-root reconstruction observed,
  post-job destruction verified empty, logs preserved; recorded.
- **R10** — uv step OS-tolerant + pinned, asserting `uv --version`.
- **R11** — T0 ladder (view gate → cardinality projection → resource snapshot →
  `EXPLAIN QUERY PLAN` + pilot with peak-RSS → bounded full run with abort thresholds),
  plus (round-4 F1) a **client-response measurement**: the serialized tail corpus and
  per-filer payload distribution, from which the LD-10 shard count is derived; a
  stop condition fires if the 1 MiB ceiling and the file headroom cannot both hold.
- **R12** — T0 decision gate unchanged (≤1.5 GiB ⇒ no-compression locked; else stop for
  a delta plan naming every consumer).
- **R13** — Index remedies only on R11(iv) evidence, applied while cutting a **new
  snapshot version**, via delta plan; Python-side bottlenecks route to a
  streaming/chunked delta plan.
- **R14** — *Withdrawn;* T13 verifies absence and maintains the stub.
- **R15** — *Withdrawn;* covered by T13.
- **R16** — Source identity = the finalized snapshot's whole-file SHA-256 (every
  derivation-relevant byte inside it) + the existing versioned logical digests of both
  derived artifacts. One explicit read transaction; interleaving test; identity-mutation
  suite (value / mapping / name / amendment / view DDL each change the hash).
- **R17** — Open-quarter honesty unchanged; fixture-proven.
- **R18** — Congress byte-identity in acceptance.
- **R19** — ARCHITECTURE amended (host model incl. R7 limits, snapshot source design,
  both variables, revision row).
- **R20** — Attestation verified at T11; divergence blocks.
- **R21** — `make accept-m2-11`: fixture-snapshot end-to-end, refusal paths, congress
  byte-identity, governance sweep, R22 topology tests, R24 compat, R27 formula guards.
- **R22** — **Bounded delivery, addressable (round-3 F2):**
  *Selection:* top 1,500 filers by descending latest-period reported total value, ties
  ascending CIK (LD-7), recorded in the projection.
  *Topology:* a **versioned routing index** `/institutional/data/filers/index.v1.json`
  mapping every published tail CIK → its shard file, plus byte-bounded shard pages
  `/institutional/data/filers/<shard>.v1.json`. Shards are cut by a generalized
  byte-bounded paginator (extracted from the activity paginator, which is
  activity-specific and truncates — verified) parameterized to **fail, never truncate**.
  **Geometry (LD-10, round-4 F1):** the binding bound is the **reader's**, not the
  provider's — each shard ≤ **1 MiB** serialized (the client-response ceiling,
  consistent with the existing 2 MiB-per-period holdings bound), so a tail lookup never
  downloads more than 1 MiB to render one filer. Shard **count is derived at T0** from
  the measured serialized tail corpus, within the measured file headroom (~1,800 files
  under the 18,000 cap at the current tree); `MAX_SHARD_BYTES` remains only the provider
  hard ceiling. If the byte and file budgets cannot both hold, the build **stops for an
  architecture decision** — never truncates, never silently widens either bound —
  **and a single filer whose payload alone exceeds 1 MiB is the same stop**, not an
  exception: the ceiling is the owner's invariant, and an oversized dedicated shard
  would silently break it. If T0 finds such a filer, the choice (raise the ceiling vs
  a separately reviewed intra-filer pagination contract) returns to review. A
  removal-fails test pins the over-ceiling case.
  *Payload:* one composite **FilerPayloadV1** schema, version-tagged, strict-validated,
  serving both renderers — stated literally (round-5 F3), composed from the existing
  published contracts rather than invented shapes:

  ```ts
  interface FilerPayloadV1 {
    v: 1;                                   // version discriminator, strict-checked
    kind: "filer";
    cik: string;
    filerName: string;
    latestPeriod: string;
    periods: string[];                      // published periods, ascending
    current: string;
    prior: string | null;
    filings: FilingDict;                    // referenced-only entries
    rowsByPeriod: Record<string, FilerHoldingRow[]>;   // display-ordered, embed-capped
    totalsByPeriod: Record<string, number>;            // pre-cap true totals
    // aggregate body inputs (ui.ts filerBody signature — verified):
    concByPeriod: Record<string, ConcentrationRow | null>;  // topn_share_bps: number|null
    deltasByPeriod: Record<string, QoqDeltaRow[]>;          // nullable prev/curr/delta fields
    latestFiled: string | null;
    topn: number;                           // the N of top-N — SEPARATE from topn_share_bps
    window: FilingWindow | null;            // { open, quarterEnd, deadline }
  }
  ```

  Nullable semantics are exactly the source contracts' (NULL-honest, never a fabricated
  zero); `ConcentrationRow`, `QoqDeltaRow`, `FilingWindow`, `FilingDict`, and
  `FilerHoldingRow` are the existing exported types, reused byte-for-byte. Payload
  parity tests assert exact structural equality against this shape. Assembled by **one
  shared server-side assembler** extracted from the holdings component — the component
  and the shard endpoint both import it; no duplicated SQL.
  *Driver:* `entity-client.ts` gains the in-extract filer path (currently every filer
  hard-routes to S2 at line 272 — verified): resolve CIK via the routing index, fetch the
  shard, render; the driver's existing error taxonomy (`bad_payload`, version mismatch,
  network, server) is preserved exactly — a malformed shard is `bad_payload`, not S2.
  *Link producers:* **one filer-href decision primitive** (single exported function:
  CIK + budget state → canonical page href or `/e/` href) that every producer calls; the
  complete closure — `institutional/index.astro`, the two holder renderers in `ui.ts`
  (510, 827 — verified unconditional today), the holdings-lib filer-link helper, **the
  browser ticker payloads in `data.ts` (which carry holder CIKs with no top/tail
  target — verified), the holders-page client payload seam (`holders.astro` →
  `entity-client.ts`), and the activity surface** — become budget-aware through it; a
  sweep test enumerates producers and fails on any unconditional filer-page link; tests
  cover SSR ticker links, generic ticker links, activity links, holders period
  switching, holdings paging, and the top/tail boundary CIKs (rank 1,500 and 1,501).
  *Failure behaviour:* missing shard/index entries for a published filer are a **build
  failure** (the index is generated from the same projection that selected the 1,500);
  at runtime the driver's taxonomy governs.
- **R23** — **Accepted snapshot, finalization corrected (round-3 F5, reproduced):**
  `scripts/inst_snapshot.py`, owner-run: free-space preflight → backup-API copy to a
  **unique temp sibling** → apply shipped views to the copy → write the R24
  `inst_source_meta` table → `PRAGMA wal_checkpoint(TRUNCATE)` → **`PRAGMA
  journal_mode=DELETE` with the returned mode asserted** → close → **assert no `-wal` /
  `-shm` sidecars exist** → reopen under the final permissions (`0444` file,
  non-writable directory) and re-run `verify_views` + `PRAGMA integrity_check` → SHA-256
  → fsync → **refuse an existing destination** → atomic rename to
  `~/projects/Populus-ops/snapshots/inst-source-v<N>.db`. Tests: crash/interruption
  mid-cut leaves no destination; non-writable-directory reopen works; no-sidecar
  assertion kills a mutant that skips the mode switch. Canonical store opened read-only
  throughout; pre/post main-file hash recorded as corroboration.
- **R24** — **Provenance, wired (round-3 F4):** `inst_snapshot.py` writes a strict
  single-row `inst_source_meta` table into the copy **before hashing** (schema_version,
  snapshot_version, created_at_utc, view_definition_digest). Stage-build computes the
  file SHA-256 itself and reads the remaining fields from the hashed file — no filename
  parsing, no filesystem timestamps. It emits `inst_source.json` (strict `inst_source/v1`
  schema, canonical rendering) enumerated as an **ordinary path-backed artifact** — not
  in `module_db_artifacts`, which is DB-only with logical digests (verified). Producer
  guard: a new build with `--inst-db` must emit it or fail; old manifests without it
  still validate and install (tested). The generic installer is reused **with zero code change** (locked, round-4 N2); a
  coverage test in the acceptance composition proves it installs, verifies, and rolls
  back the new artifact through the existing ordinary-artifact path.
- **R25** — Scheduled runs require `vars.POPULUS_SELFHOSTED_VALIDATED == 'true'`
  (dispatch exempt); owner sets it only after T11; pinned by shape test.
- **R26** — The five stale 15,000-cap citations in ARCHITECTURE updated.
- **R27** — **Budget model integrity (round-3 F8):** `src/populus/inst_budget.py` and
  `tests/test_inst_shard_budget.py` are in scope. `worst_case_file_count` gains
  filer-shard and routing-index terms while retaining **every** existing term —
  measured M1, site chrome, M2 filer pages, activity shards, and **M3's committed
  2,064** — with a test asserting the new terms are real parameters (the C5/N1 defect
  class this module documents). Projections remain reported evidence; the measured
  post-build tree remains the enforcing gate; no policy reversal.

## Scope

Backend seam (ro snapshot, one transaction, verify, identity, provenance emit);
snapshot-cut tooling with corrected finalization; T0 probe; addressable bounded delivery
(routing index, shards, shared assembler, driver filer path, link-producer closure);
budget-model extension; workflow move + R25 gate + governance tests; committed runner
controller; runbook; ARCHITECTURE (R19+R26); acceptance; STATUS; refresh stub (now
carrying snapshot retention).

## Non-goals

Nightly refresh (stub only) · compression (delta plan) · M2-9/M2-10 · the M14 flag ·
pre-2025 backfill · exchange prices (permanent) · moving deploy/sign to the Mac · runner
groups · **any write to the canonical audit store** · snapshot retention policy
(recorded as an M2-12 obligation in the stub before any v2 is cut).

## Constraints

- Canonical store read-only in every path (backup-API read, `mode=ro`, OS ACL).
- Public repo + self-hosted runner: accepted per OD-4 (verbatim above), bounded by R7,
  residue in TD-4.
- Shape tests never weakened; no secrets in run bodies.
- Concurrent work: P3-3c may touch `publish.yml`; re-baseline if main moves.
- Mac always-on (OD-1); LD-5 covers outages.

## Current State

Verified at `a80812f`, 2026-08-08 (revision 3 pass; deltas re-verified at revision 4).

- Checkout == `origin/main` == `a80812f`; live site `20260808.1`, module withheld.
- Canonical store as in Goal; two M2-8 reported views absent; WAL sidecars present.
- **Snapshot finalization behaviour (measured this revision, SQLite via repo `uv`):**
  backup-API destination inherits `wal`; checkpoint does not change it;
  `PRAGMA journal_mode=DELETE` returns `delete`; only then is a sidecar-free read-only
  copy possible.
- `/e/` shell delegates to `scripts/entity-client.ts`, which hard-routes filer keys to
  S2 (line 272); filer key classification in `lib/derive.ts` (465); unconditional holder
  filer links in `lib/ui.ts` (510, 827); the only server-side filer payload assembler is
  `components/HoldingsTable.astro` (70); the activity paginator is activity-specific and
  truncates (activity.ts 493); `inst_budget.py:30` records that no spill implementation
  exists. All verified — the R22 consumer closure is built from these.
- `module_db_artifacts` / `db_artifacts` is DB-only (manifest.py 100–108) driving
  Release-DB handling; the generic installer installs ordinary artifacts
  (client/snapshot.py) — the R24 design rides the latter.
- `worst_case_file_count` includes `m3_reserved = 2,064` and documents the omitted-term
  defect class (verified) — revision 3's formula omitted it; corrected in R27.
- Coverage unmeasured (sole probe >10 min, killed). ARCHITECTURE stale-cap lines as
  before. Variables/secrets as before; no runner registered; 221 GiB free.

## Detected Stack

- Backend: Python 3.12, `uv` (0.7.13 pinned in CI), Click, SQLite/WAL/JSON1, pytest,
  sigstore.
- Dashboard: TypeScript, Astro 7, Node 24.16.0, `node --test`, `node:sqlite`.
- CI/CD: GitHub Actions (SHA-pinned), GitHub Releases, Cloudflare Pages Direct Upload,
  reusable signer.
- Ops host: macOS Darwin 25.3.0, Apple Silicon; store + snapshots under
  `~/projects/Populus-ops/`.

## Reuse Map

| Existing symbol/path | Decision | Why |
|---|---|---|
| `stage_build` + `_seal_build` | Extend (ro snapshot handle) | Input handle changes only. |
| Aggregation/coverage/serving builders | Reuse unchanged | Connection-parameterized. |
| `ensure_views` | Extend module with `verify_views` | Shipped SQL is the comparison source. |
| `/e/` shell + `entity-client.ts` driver | **Extend** (in-extract filer path) | Prerendered shell ⇒ no 404; error taxonomy already exists — extend the driver, don't fork it. |
| `lib/derive.ts` filer classification | Extend | It already owns key parsing; the routing decision belongs beside it. |
| `HoldingsTable.astro` payload assembly | **Extract** to a shared lib module | Two consumers (component + shard endpoint); duplication is the declared risk. |
| Activity paginator (`activity.ts`) | **Generalize** into a shared byte-bounded paginator | It truncates and is activity-specific; R22 needs fail-not-truncate. |
| `digests.py` versioned projections | Reuse | Derived-artifact digests already versioned. |
| Ordinary-artifact enumeration + generic installer | Reuse for `inst_source.json` | `db_artifacts` is DB-only; the generic path already installs path-backed artifacts. |
| `inst_budget.py` `worst_case_file_count` | **Extend with new terms, all old terms retained** | The module exists to prevent omitted-term counts (R27). |
| Shape tests; `accept_m2_8.py` pattern | Extend / reuse pattern | As before. |

## Architecture

**One sentence:** the owner cuts an immutable, metadata-carrying, sidecar-free snapshot;
stage-build derives read-only from it in one transaction and publishes two databases plus
a provenance artifact whose fields come from inside the hashed file; the site serves
1,500 pre-rendered pages plus an index-addressed shard tail through the existing `/e/`
driver; a per-job-reconstructed runner on the Mac runs publish; deploy/sign stay hosted.

```
 canonical store (23 GB WAL) ──backup API (ro)──► temp sibling
   └─ views + inst_source_meta → checkpoint → journal_mode=DELETE (asserted)
      → close → no-sidecar assert → reopen 0444 + reverify → sha256 → atomic rename
                    accepted snapshot v<N>  (immutable)
                              │  POPULUS_INST_DB
                              ▼
  Mac · dedicated account · controller-rebuilt runner root per job (populus-ops)
   publish job (schedule gated on POPULUS_SELFHOSTED_VALIDATED)
    ├─ congress ingest → fresh populus.db
    ├─ stage-build --inst-db <snapshot>  (mode=ro, immutable=1, ONE read txn)
    │    verify_views → coverage ≥95% → inst_agg.db → inst_serving.db
    │    └─ inst_source.json ← sha256(file) + fields read from inst_source_meta
    ├─ site build: 1,500 filer pages + routing index + N measured shards (LD-10) + /e/ tail links
    ├─ finalize / publish / verify
    └─ site artifact ──► hosted: deploy → sign → assert-signed
```

**Load-bearing details:** `journal_mode=DELETE` is asserted because backup+checkpoint
provably leave WAL mode (measured); metadata lives *inside* the hashed file so provenance
cannot drift from identity; the routing index exists because a client holding only a CIK
cannot compute a byte-spilled shard address; the runner root is reconstructed per job
because fresh `_work`/HOME alone leaves same-UID persistence (runner install, caches,
`/tmp`).

## Locked Decisions

- **LD-1** — Labels `[self-hosted, macOS, populus-ops]`; pinned by test.
- **LD-2** — Snapshot addressed only via `vars.POPULUS_INST_DB`.
- **LD-5** — Queued-past-24h nightly = accepted visible failure (fallback under
  always-on).
- **LD-6** — Source = accepted snapshot cut from `populus-m28.db`; the stale
  `Populus-ops/populus.db` never opened.
- **LD-7** — Filer selection: descending latest-period reported total value, ties
  ascending CIK, cut 1,500; recorded in the projection.
- **LD-8** — Snapshots immutable + versioned; new corpus state ⇒ new version; retention
  policy is an M2-12 obligation recorded in the stub before v2.
- **LD-10** — Tail-shard geometry serves the reader: **≤1 MiB serialized per shard**
  (client-response ceiling; owner-approved 2026-08-08), count derived from T0
  measurement within the file headroom; the provider's 25 MiB remains only a hard
  ceiling; large payloads **within** the ceiling may occupy a shard alone, while a
  payload **over** the ceiling stops the build (round-6 N1 wording; R22 binding);
  irreconcilable budgets stop the build.
- **LD-9** — Long-tail addressing is **routing-index-based** (index + shards), not a
  computable bucket rule: byte-bounded spill makes shard membership data-dependent, so
  only an index generated from the same projection can be both bounded and complete.
- *(LD-3 retired; LD-4 repealed — see revision history.)*

## Alternatives Considered

Prior rounds' rejections stand (ops-side sidecar derive; incremental cloud; 21 GB in the
published snapshot; bigger hosted runners; ATTACH; all-filers pre-render; persistent
runner; trigger-relay controller; in-place store repair). New this round:
- **Computable CIK→bucket rule with no spill** — rejected (LD-9): fixed buckets with a
  25 MiB bound either over-provision shard count or reintroduce truncation; the index
  costs one small file and makes membership exact.
- **Extending `module_db_artifacts` for `inst_source.json`** — rejected: the tuple is
  DB-only with logical-digest semantics; a JSON there would misclassify it through five
  consumers (verified) — the ordinary-artifact path already does everything needed.
- **Fresh `_work`/HOME only (revision 3's R7)** — rejected: measured GitHub guidance +
  same-UID writable surfaces; replaced by whole-root reconstruction.

## Planned Files

One backticked path per line; descriptions avoid inline code.

- `src/populus/publish/build.py` — snapshot handle; ro+immutable open; one transaction;
  view verify; identity; reads snapshot metadata; emits the provenance artifact with
  producer guard.
- `src/populus/publish/manifest.py` — provenance artifact name constant and validation
  as an ordinary path-backed artifact; old-manifest acceptance preserved.
- `src/populus/cli.py` — the stage-build flag pass-through.
- `src/populus/amendments.py` — read-only view verification.
- `src/populus/inst_budget.py` — filer-shard and routing-index terms added to the
  projection, all existing terms retained.
- `tests/test_inst_shard_budget.py` — new-term parameter guards beside the existing
  omitted-term tests.
- `dashboard/src/pages/institutional/filers/[cik].astro` — cut to the 1,500 budget.
- `dashboard/src/pages/e/index.astro` — shell adjustments for the filer path if needed.
- `dashboard/src/scripts/entity-client.ts` — in-extract filer path: routing-index
  resolve, shard fetch, render; existing error taxonomy preserved.
- `dashboard/src/lib/derive.ts` — filer key routing decision beside the existing
  classification.
- `dashboard/src/lib/ui.ts` — both holder renderers route through the href primitive.
- `dashboard/src/lib/activity.ts` — activity links route through the href primitive;
  its paginator internals move to the shared module.
- `dashboard/src/lib/data.ts` — browser ticker payloads carry the top/tail target;
  shard addressing exposure.
- `dashboard/src/pages/institutional/tickers/[t]/holders.astro` — the holder-period
  client payload carries budget state through the entity-client seam.
- `dashboard/src/lib/holdings.ts` — budget-aware filer-link helper.
- `dashboard/src/lib/filer-payload.ts` — new shared server-side payload assembler
  extracted from the holdings component; both consumers import it.
- `dashboard/src/lib/shards.ts` — new generalized byte-bounded paginator
  (fail-not-truncate), used by activity and filer shards.
- `dashboard/src/components/HoldingsTable.astro` — consumes the extracted assembler.
- `dashboard/src/pages/institutional/index.astro` — budget-aware links.
- `dashboard/src/pages/institutional/data/filers/index.v1.json.ts` — the routing index.
- `dashboard/src/pages/institutional/data/filers/[shard].v1.json.ts` — shard pages.
- `dashboard/test/post/file-budget.test.ts` — **measured post-build tree** assertions
  extended to the new shard family (index present, every shard ≤ the LD-10 ceiling,
  family count, total tree vs the cap); projections are asserted nowhere here.
- `dashboard/test/holdings.test.ts` — selection determinism, link-producer sweep, shard
  geometry/refusal, payload parity tests.
- `.github/workflows/publish.yml` — labels; pass-through; validation gate; uv step.
- `tests/test_publish.py` — shape assertions incl. the validation gate.
- `tests/test_workflow_governance.py` — repo-wide trigger and label sweep.
- `tests/test_inst_external_store.py` — seam, interleaving, identity mutations,
  refusals, congress byte-identity, manifest compat, snapshot finalization tests.
- `tests/test_runner_controller.py` — the **behavioral fake-root suite** (authoritative,
  R7d): wipe destroys exactly the allowlisted target; refusal of empty, root, home, and
  symlinked targets; enforced terminate→export→wipe→verify→restore ordering; concurrency
  lock; registration refused unless cleanup verified — plus supplemental static
  assertions that the credential never reaches the runner environment.
- `ops/runner/runner-controller.sh` — new: per-job root destruction/reconstruction,
  process termination, log export, ephemeral re-registration.
- `ops/runner/com.populus.runner-controller.plist` — the controller's launchd unit.
- `scripts/measure_inst_derive.py` — T0 ladder with stop conditions and monitors.
- `scripts/inst_snapshot.py` — snapshot cut with the corrected finalization sequence.
- `scripts/accept_m2_11.py` — acceptance composition.
- `Makefile` — the accept-m2-11 target.
- `docs/runbooks/self-hosted-runner.md` — account/ACL/controller install/clean image/
  always-on/teardown; invokes scripts, never describes-in-place.
- `ARCHITECTURE.md` — R19 amendment plus R26 corrections.
- `STATUS.md` — run entry at docs-commit.
- `docs/build/RUN-M2-12-inst-refresh-stub.md` — withdrawn refresh scope + journal
  evidence + snapshot-retention obligation.
- `docs/build/RUN-M2-11-plan.md` — this plan.

## Implementation Tasks

**Phase A — implement inert:**
- **T1** — `verify_views`. *(R3)*
- **T2** — `stage_build` plumbing: ro+immutable open, one transaction, identity, meta
  read, provenance emit + producer guard. *(R1, R2, R16, R17, R24)*
- **T3** — CLI flag + refusals. *(R1, R2)*
- **T4** — `tests/test_inst_external_store.py`: fixture snapshot; ro mutation; view
  refusal; interleaving; identity mutations; congress byte-identity; manifest compat
  (old accepted, new round-trip); **snapshot finalization tests** (mode asserted,
  no-sidecar, crash-safety, non-writable reopen). *(R2, R3, R16, R17, R18, R23, R24)*
- **T5** — Bounded delivery per R22: routing index + shards via the generalized
  paginator; shared assembler extraction; driver filer path; link-producer closure +
  sweep test; geometry/refusal/parity tests; budget terms + guards per R27. *(R22, R27)*
- **T6** — `scripts/inst_snapshot.py` (corrected finalization) +
  `scripts/measure_inst_derive.py`, gated against disposable copies. *(R23, R11)*
- **T13** — R14/R15 absence verification + the M2-12 stub incl. retention obligation.
  *(R14, R15)*
- **T14** — `ops/runner/` controller + plist + `tests/test_runner_controller.py`.
  *(R7)*

**Phase B — review checkpoint** (QA on Phase A; proceed on PASS). *(T12)*

**Phase C — owner actions with proven tooling:**
- **T-1** — Owner cuts accepted snapshot v1; canonical pre/post hash corroboration
  recorded. *(R23)*
- **T0** — R11 ladder vs snapshot v1; R12 branch recorded; R13 only on evidence.
  *(R11, R12, R13)*

**Phase D — workflow + machine:**
- **T7** — `publish.yml` labels/pass-through/R25 gate/uv; shape + governance tests.
  *(R4, R5, R6, R10, R25, R7)*
- **T8** — Acceptance script + Makefile. *(R21, R18, R22, R24, R27)*
- **T9** — Runbook (invoking the committed scripts). *(R7, R8)*
- **T10** — ARCHITECTURE R19 + R26, revision row. *(R19, R26)*

**Phase E — supervised then armed:**
- **T11** — Owner installs controller + registers; supervised dispatch: canonical hash
  corroboration, runner-root lifecycle observed (R9), attestation (R20), bounded
  surfaces + tail render via index→shard + EDGAR spot-check; then owner sets
  `POPULUS_SELFHOSTED_VALIDATED=true`. *(R7, R8, R9, R16, R20, R25)*
- **T12** — QA loop at checkpoints; batch remediation; docs-commit; PR for owner merge.

## Testing Strategy

Exact executable gate set (exit statuses recorded):

```
make check
make accept-m1-b
make accept-m2-5
make accept-m2-6
make accept-m2-8
make accept-m2-11
```

- Unit/seam: hermetic fixture snapshot; removal-fails tests per branch; mutation list
  (drop `mode=ro`; skip verify; split the transaction; skip `journal_mode=DELETE`; break
  LD-7 ties; lift the 1,500 cut; drop a shard; drop the routing index; drop the M3 term;
  each identity mutation). `__pycache__` purged, `PYTHONDONTWRITEBYTECODE=1`.
- Snapshot tooling: disposable copies only. Controller: the **behavioral fake-root
  suite is authoritative** (destructive-target refusals, ordering, locking, registration
  refusal, all against a disposable fake root); static credential-environment checks are
  supplemental, never the primary evidence.
- Live (T11): canonical hash corroboration, attestation, EDGAR, index→shard tail
  render; evidence verbatim into Dev Notes.

## Verification Matrix

| Req | Verified by |
|---|---|
| R1 | T4 parity; acceptance; T11 |
| R2 | T4 ro mutation; 0444 + ACL at T11 |
| R3 | T4 refusal naming the view |
| R4 | T7 pin; unset-path test |
| R5 | T7 pins all four jobs |
| R6 | Existing assertions unmodified + new pins |
| R7 | T14 controller tests; governance sweep; lifecycle observed at T11; TD-4 declared |
| R8 | Runbook invokes committed scripts (QA check); teardown dry-read |
| R9 | T11 lifecycle evidence |
| R10 | Step assertion; T11 |
| R11 | Ladder outputs before Phase D |
| R12 | Sizes + branch recorded |
| R13 | Evidence-gated; new-version route; delta plan |
| R14 | T13 absence check |
| R15 | T13 absence check |
| R16 | T4 identity suite + interleaving; identity in provenance artifact at T11 |
| R17 | T4 open-quarter fixture |
| R18 | Byte-identity harness |
| R19 | QA doc sweep; revision row |
| R20 | T11 attestation |
| R21 | `make accept-m2-11` exit 0 |
| R22 | T5 topology/sweep/parity/geometry tests; T0(ii); post-build gate; T11 tail render |
| R23 | T4 finalization tests; T-1 record (mode asserted, no sidecars, reverify, hash) |
| R24 | T4 compat tests; producer-guard test; installer round-trip in acceptance |
| R25 | T7 pin; T11 ordering |
| R26 | QA grep |
| R27 | Budget-term parameter guards; post-build gate remains enforcing |

## Rollout / Rollback

**Rollout = phase order A→E** (implement → review → snapshot + T0 → workflow/machine →
supervised → arm). **Rollback:** unset `POPULUS_SELFHOSTED_VALIDATED`; revert `runs-on`
+ unset `POPULUS_INST_DB`; snapshot problems ⇒ repoint/unset the variable, never
restore; published bad build ⇒ existing P3-3 rollback runbook (both new artifacts are
ordinary module assets under it); runner ⇒ controller teardown per runbook.

## Simplicity Audit

Exhaustive disposition of every new or materially extended abstraction (round-3 F9).
Format: item — disposition — forcing requirement — rejected simpler alternative.

| Item | Disposition | Forced by | Rejected simpler alternative |
|---|---|---|---|
| `verify_views` | Create (read-only fn) | R2×R3 | Reusing the writer — writes the store |
| Snapshot handle in `stage_build` | Extend | R1 | Parallel derive path — forks the coverage gate |
| One-transaction derive | Extend | R16 | Per-phase implicit txns — snapshot instability |
| `inst_source_meta` table | Create (1 row, in-snapshot) | R24/F4 | Filename/timestamp parsing — provenance drift |
| `inst_source.json` artifact | Create (ordinary artifact) | R24 | New manifest field — breaks the allowlist; DB-tuple entry — misclassifies |
| `inst_snapshot.py` | Create (owner protocol) | R23/F5 | Ad-hoc SQL — unrepeatable, WAL-unsafe |
| `measure_inst_derive.py` | Create | R11 | Manual timing — not QA-runnable |
| Routing index endpoint | Create | R22/LD-9 | Computable buckets — spill makes membership data-dependent |
| Shard endpoint | Create | R22 | Serving from the filer route — 9,458 pages, F1 round 1 |
| `filer-payload.ts` shared assembler | Extract from the holdings component | R22/F2 | Duplicate SQL in the endpoint — the declared hidden debt |
| `shards.ts` generalized paginator | Generalize from activity paginator | R22 | Reusing it as-is — activity-specific and truncates (verified) |
| Driver filer path (`entity-client.ts`) | Extend | R22 | New tail route — duplicates the `/e/` shell and error taxonomy |
| Budget-aware links (`ui.ts`, `index.astro`, `holdings.ts`) | Extend (closure) | R22/F2 | Partial sweep — dead links from unlisted producers |
| Budget terms (`inst_budget.py` + tests) | Extend, all terms retained | R27/F8 | Prose arithmetic — the omitted-M3 defect this round |
| Governance test | Create | R7(e) | Settings-only — unenforced, unreviewable |
| Runner controller + plist + tests | Create (committed code) | R7/F7 | Runbook prose — security controls must execute, not describe |
| `verify_views` error surface in CLI | Extend | R3 | Silent fallback — derives from stale views |
| Workflow gate variable (R25) | Create (one `if` clause) | F9 round 2 | Calendar discipline — unenforceable |
| Runbook | Create (invokes scripts) | R8 | Inline doc snippets — drift from committed code |
| Acceptance script | Create | R21 | Relying on unit tests — no composed seam proof |
| M2-12 stub | Create | T13/DoD 7 | Silent scope disappearance |
| ARCHITECTURE amendment | Extend | R19/R26 | Silent spec edit — forbidden by project rule |

**Public-symbol enumeration (round-4 F7).** The exported surface each planned module
introduces — create/extend/reuse; internal helpers stay implementation details:

| Public symbol | Kind | Disposition | Home |
|---|---|---|---|
| FilerPayloadV1 | type/schema (locked field set in R22) | create | filer-payload lib |
| assembleFilerPayload | function (the one assembler) | create (extracted) | filer-payload lib |
| parseFilerPayload | function (strict client validator) | create | filer-payload lib |
| filerHref | function (the one href primitive: cik + budget state → href) | create | holdings lib |
| FilerBudgetState | type (top/tail marker carried by payload seams) | create | holdings lib |
| paginateByBytes | function (fail-not-truncate, byte-bounded) | create (generalized) | shards lib |
| ShardPlan / ShardEntry | types (index + shard geometry) | create | shards lib |
| SHARD_RESPONSE_CEILING_BYTES | constant (LD-10: 1 MiB) | create | shards lib |
| routing index payload v1 | schema (cik → shard file) | create | filers data endpoint |
| inst_source/v1 | schema (provenance artifact) | create | manifest module |
| INST_SOURCE_ARTIFACT | constant (artifact name) | create | manifest module |
| inst_source_meta | table schema (1 row, in-snapshot) | create | snapshot script |
| verify_views | function (read-only comparison) | create | amendments module |
| stage_build inst_db_path param | parameter | extend | publish build |
| worst_case_file_count shard/index params | parameters (all prior terms retained) | extend | inst budget |
| controller operations (destroy-root, restore-image, export-logs, verify-empty, register) | script commands | create | ops/runner controller |
| runEntityDriver filer branch | function branch (in-extract filer path) | extend | entity-client script |
| parseEntityKey | function | reuse unchanged | derive lib |

Nothing else new is introduced; any **public** abstraction not in this table is out of
scope and its appearance in dev is a review finding. Internal (non-exported) helpers are
the developer's to shape.

## Tech Debt Introduced

- **TD-1** — Standalone `inst-agg` CLI still opens `--db` writable (unchanged; the
  canonical store is additionally ACL-protected against the runner account).
- **TD-3** — Runner toolchain is machine state; root-owned read-only + checksummed;
  remediation manual.
- **TD-4** — **Accepted security debt (OD-4 verbatim + option-(b) broadening in
  header):** during an authorized job, compromise of trusted workflow code,
  dependencies, or the runner exposes `DATA_REPO_PAT`, the OIDC identity, and store
  read access. Whole-root reconstruction (R7c) closes persistence through the runner
  install, caches, and `TMPDIR`; **it does not close every same-UID surface** —
  user-level launch agents, scheduled tasks, and writes outside the reconstructed root
  can survive a job, and the owner has **explicitly accepted** that residue (bounded
  by: non-admin, no keychain, ACL read-only data, rotatable PAT; the runbook's teardown
  includes a same-UID persistence sweep to run on any suspicion). Also outside every
  control: kernel/root compromise, controller-domain compromise, malicious trusted
  merges. Removal: repo private, or publish returns to hosted runners.
- **TD-5** — Long-tail parity is shard-bounded; revisit when the shard schema next
  changes.
- **TD-6** — The `/e/` driver gains a filer entity branch; extract an entity-kind
  registry if a third module needs it.
- **TD-7** — Immutable 23 GB snapshot versions accumulate; retention is an **M2-12
  obligation recorded in the stub**, owed before v2 is cut.

## Memory Touch-Points

All names below resolve as files under this project's memory directory
`~/.claude/projects/-Users-johnbaek-projects-Populus/memory/` (round-4 N1: the reviewer's
canonical store is a different directory; these are the authoritative paths for the
citations in this plan).

- `plan-v1-literal-rid-tokens.md` — literal IDs; retired IDs preserved.
- `mockups-are-not-measurements.md` — every load-bearing behaviour this revision is
  *measured* (WAL-mode persistence, S2 hard-route, DB-only tuple, M3 term) before being
  planned against.
- `measure-the-mechanism.md` — the F5 reproduction changed the protocol; the coverage
  timeout still routes to query-plan diagnosis.
- `verify-against-a-frozen-tree.md` — base re-verified; the source itself is now frozen by
  design.
- `probe-dont-argue-from-silence.md` — round-2 F1 non-reproduction recorded with both
  invocations; round-3 F5 settled by running the experiment.
- `feedback_qa_fail_batch_remediation.md` (reviewer-side canonical store) — three rounds, each batch-remediated, nothing
  self-signed.
- `mutation-tests-pin-properties.md` — identity suite; finalization mutants; budget-term
  guards.
- `specify-before-rewriting.md` — R22/R24 are locked contracts; the Simplicity Audit now
  enumerates every abstraction before code exists.
- `measure-closed-quarters-only.md` — open-quarter honesty (R17) unchanged.
- `orchestrate-worktree-isolation.md` — dev in `<repo>/.claude/worktrees/<name>`.
- `review-scope-decides-the-verdict.md` / `plan-review-is-not-code-review.md` — Phase B/E QA
  rounds budgeted.

## Failure-Mode Sweep

- **F0 full-set sweep:** link-producer closure is a *test*; manifest consumers in R24
  scope; budget terms complete by R27 with parameter guards; all four jobs pinned.
  **F0 secrets:** registration credential isolated by domain; controller tests assert it
  never reaches runner env. **F0 verify-don't-assume:** WAL persistence, S2 routing,
  DB-tuple semantics, M3 term — all measured this revision, none assumed.
- **F1 gate-list completeness:** exact commands. **F1 prod writes:** zero
  canonical-store writes; snapshot cut owner-run, protocol-scripted. **F1 re-baseline:**
  standing rule.
- **F2 executable deploy steps:** controller and snapshot tools are committed, tested
  code; the runbook invokes them. **F2 behavioral tests:** removal-fails everywhere.
- **F3 function end-to-end:** T11 checks function (EDGAR, index→shard tail render).
  **F3 doc numbers:** R26; QA re-checks.
- **F4 propagation:** R19+R26 one pass; QA grep.
- **F5 transport:** validated both invocations pre-handoff; results recorded.
- **N/A (stated):** pooler; RLS; dead-CSS (sweep test covers new links); bulk-SQL
  backfill (none).

## Definition of Done

1. Every live requirement green per the matrix — R1, R2, R3, R4, R5, R6, R7, R8, R9,
   R10, R11, R12, R13, R16, R17, R18, R19, R20, R21, R22, R23, R24, R25, R26, R27 —
   each citing its artifact; R14/R15 verified absent by T13; the stub exists and
   carries the retention obligation.
2. Phase order held (tooling → review → snapshot + T0 → workflow → supervised →
   variable → first scheduled run).
3. Exact gate list green, including `accept-m2-11`.
4. Supervised dispatch passed, then one unattended scheduled nightly green; bounded
   surfaces live; a tail filer renders via index→shard through `/e/` with the driver's
   real taxonomy; no institutional 404s; withheld banner gone; EDGAR spot-check
   resolves.
5. Canonical store: zero writes (ro modes + ACL enforced; hash corroboration recorded);
   snapshot standalone (mode `delete`, no sidecars), read-only, hash published via
   `inst_source_meta` → `inst_source.json`.
6. ARCHITECTURE (R19 + five R26 corrections + revision row), runbook, STATUS landed;
   QA loops passed with written resolutions; PR merged by the owner.
7. T0's numbers recorded before Phase D; the R12 branch decision recorded either way.

---

### Open decisions for the owner

- **OD-3 (only if R11(iv) evidence triggers R13):** authorize index work via a new
  snapshot version + delta plan.
- *(OD-1 resolved: always-on. OD-2 retired. OD-4 resolved: verbatim acceptance in the
  header, now accurate under R7c's reconstruction model.)*
