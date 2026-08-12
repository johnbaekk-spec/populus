# RUN M2-11 — Dev Notes (dev-notes-v1)

This is the cumulative implementation record for the approved M2-11 parent
delivery and its owner-reviewed T0 deltas through the successful append-only
T0-v11 run. The controlling final delta is
`docs/build/RUN-M2-11-T0-tail-pagination-delta-plan.md`, approved after three
independent read-only rounds at SHA-256
`068e7fc04edf61e0e3d25e40ff504b003faa0d0ab6d26fa65982a4899e119fad`.
The owner-authorized QA-origin recovery is controlled by
`docs/build/RUN-M2-11-QA-origin-recovery-delta-plan.md`, independently approved
after three read-only rounds at SHA-256
`2df62fa4dd2a54bfac932238e0b8fcd16a6386d3b6c75dabe038eacf714297ba`.
The separately owner-authorized QA/docs finalization is controlled by
`docs/build/RUN-M2-11-QA-finalization-delta-plan.md`, independently approved
after three read-only rounds at SHA-256
`82509b7c41e890dab69920abe8b26daac0104fad0c657a5e22aca4864161f742`.
The singular owner-authorized finalization retry is controlled by
`docs/build/RUN-M2-11-QA-finalization-exception-plan.md`, independently approved
after two read-only rounds at SHA-256
`71ca0c1f4eaadb165d49655de4dd838cbbb3ed9b681df815bd170d03f018faf3`;
its decision SHA-256 is
`8222a145ddba5a9101c4f851c4aa3f7eca1fe68e7eb9dffd116f51123b7747c0`.
The owner-authorized F1/F2-only finalization repair is controlled by
`docs/build/RUN-M2-11-QA-finalization-repair-plan.md`, independently approved
after two read-only rounds at SHA-256
`5cdd1fef209331f779f3fb28fb718891c2371319d49ef7be2928382623a264e5`;
its decision SHA-256 is
`ba8c1653144d683e70c497ad1d7e899bf9c21cba9b3b870897f891fa0c5fe4f8`.
The owner-authorized F3-only finalization repair is controlled by
`docs/build/RUN-M2-11-QA-finalization-F3-plan.md`, independently approved after
three read-only rounds at SHA-256
`105f5c4966d8d50d9f2737b779ff378b841198c74819c3597f71e9454ecd01d6`;
its decision SHA-256 is
`148a522d1e4d153744469004c88fd109e4469a30826c344f0fa63ebdf26e72fa`.
The current owner-authorized F4/F5-only finalization repair is controlled by
`docs/build/RUN-M2-11-QA-finalization-F4-F5-plan.md`, independently approved
after three read-only rounds at SHA-256
`44763fb1a35eb13fca4f580278863dc3f53c76959c38fead97221c0161bcd55b`;
its decision SHA-256 is
`d2a4a0f3b80f23f3851f28ce71f203078d29f83c639f72e05ca1eecb5c3f6b09`.
The current owner-authorized release-hygiene repair is controlled by
`docs/build/RUN-M2-11-QA-finalization-release-hygiene-plan.md`, independently
approved after three read-only rounds at SHA-256
`338c81697acf31c26ecf76b797febdadc7e293e1f3dbef315cf27c7e450e3289`;
its decision SHA-256 is
`59f4a3c9804e0af1dbc4dfede922a21e98d6394393e8dbed286f2cae754dba85`.
The current owner-authorized F1-only release-hygiene verification repair is
controlled by
`docs/build/RUN-M2-11-QA-finalization-release-hygiene-F1-plan.md`, independently
approved after two read-only rounds at SHA-256
`da6f13b9968468c4c49506bcff4ca70e75d87c17b2d39d71fa490373f7c52213`;
its decision SHA-256 is
`fa564bcafa0b1f9991ee9468fecd6ae57b982ad64e6ec2fee629c8587a246fe6`.
The owner-authorized consolidated closeout is controlled by
`docs/build/RUN-M2-11-QA-finalization-closeout-plan.md`, independently approved
after the final fail-closed shell amendment at SHA-256
`27d2e5c67267b2c1cf9081141c61d707fa726c15f1ee98c368427860c61d3b26`;
its decision SHA-256 is
`13c7d290e9d11db9cb405e2d8fefb15e774a862ea9f466ff56b4d951eb04f83b`.

## Detected Stack

- **Languages:** Python 3.12.13 at the repository root; TypeScript/Astro under
  `dashboard/`.
- **Python runner:** repository `.venv/bin/python` with a frozen `uv.lock`;
  repository commands are owned by `Makefile`.
- **Node runner:** Node 24.16.0 and npm 11.13.0 with
  `dashboard/package-lock.json`.
- **Storage/publication:** SQLite/JSON1 immutable institutional source snapshot,
  derived SQLite aggregate, static Astro routes, signed manifests/pointers.
- **Tests:** pytest plus Node's native test runner and Astro check/build.
- **Canonical gates:** `make check`, `make accept-m1-b`, `make accept-m2-5`,
  `make accept-m2-6`, `make accept-m2-8`, and `make accept-m2-11`.
- **Stack cache:** no `CLAUDE.md` cache exists in this worktree; detection was
  performed from manifests. No out-of-scope cache file was added.

## Requirement and Task Completion

| Requirement | Status | Implementation and evidence |
|---|---|---|
| R1 logical payload invariance | complete | `assembleFilerPayload` remains the logical producer; `fragmentFilerPayload` cuts only after assembly and `reassembleFilerPayload` returns the unchanged logical payload before `parseFilerPayload`. Shared fixture parity and T0 report zero reassembly mismatches. |
| R2 exact fragment contract | complete | `dashboard/src/lib/filer-payload.ts` and `scripts/measure_inst_derive.py` implement the exact v2 fields, section ordering, offsets, map ordering, and metadata coverage. |
| R3 deterministic bounded cutting | complete | Python source constants pin 786,432 bytes, 64 parts, and sentinel 99,999; TypeScript mirrors them. Boundary, oversized-record, 65-part, and removal-fails tests pass. |
| R4 one filler and measured reservation | complete | Existing `paginateByBytes`/`fillShardsByBytes` is reused; reservation is 4,096; the separately named v1 transition term is imported, summed, asserted, and printed by both acceptance consumers. T0 measured 2,714 physical shards. |
| R5 versioned routing/routes | complete | v1 shard route removed; exact v1 upgrade tombstone retained; v2 range-index and shard routes added. T0 index is 209,223 bytes and the largest shard is 1,048,574 bytes. |
| R6 strict browser reconstruction | complete | Entity client validates ranges and exact keys, caps fan-out before requests, concurrently fetches the inclusive range, rejects transport/fragment contradictions, reassembles, then calls the unchanged strict parser. Entity orchestration tests pass 24/24. |
| R7 bounded build resources | complete | `build:bounded` refuses physical RAM below 32 GiB and scopes a 24 GiB heap only to `astro build`; package gates and the publish build step reuse it. Governance tests prove no broader `NODE_OPTIONS` authority. |
| R8 T0/production parity and stops | complete | The T0 mirror uses the same shapes/order/cutting/routing/shard envelope, reconstructs every tail filer, and emits every required metric and STOP. T0-v11 has zero route/reassembly/ceiling failures. |
| R9 complete verification | product candidate complete; consolidated QA pending | Round 8 reran all 15 gates without product drift, but independent QA found one verification-only F1. The 74-path repair passes all 145 locked F1 cases. Round 9 was consumed when gate 2 found one stale Dev Notes command assertion. The owner authorized one approval-only round 10; the exact 76-path repair passes the complete focused preflight and preserves product/T0 bytes. |
| R10 one append-only binding | complete | `T0-v11.log` was absent immediately before one exact invocation and now exists once at SHA-256 `7078a42934484c9c5ba7f975654476e0788c385dbaf8108c0d429a58ba91a453`, 63,400 bytes / 171 lines, direct exit 0. Findings were appended; no retry occurred. |
| R11 QA discipline | complete | Three independent read-only QA rounds were used. Rounds 1 and 2 found only recovery-transport handoff blockers; the primary batched/fixed them and reran all 15 gates each time. Round 3 approved token `sha256:7747af94f5100803543d822c06fd989033c7525a43f2da1e459e3f285ebcb8cb` with no open finding. |
| R12 documentation/release scope | pending round-10 approval | Round-8 QA is sealed `CHANGES_REQUESTED` for exactly F1. Round 9 stopped at focused gate 2 before independent QA. The exact failed evidence is preserved and bound into the one owner-authorized round 10; only its independent approval permits docs attempt 3, staging, commit, PR, and merge. |
| R13 supervised functional deployment | pending merge | The reviewed runbook/workflow contract is implemented; runner provisioning, merged-main dispatch, functional v2/tombstone/signature verification, and arming remain post-merge actions. |
| R14 immutability/stop discipline | complete through T0 | Snapshot remains 23,058,628,608 bytes, mode 0444, SHA-256 `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`, sidecar-free; the log records `snapshot_immutability: PASS`. No bound was relaxed and all historical logs were preserved. |

QA-origin recovery requirements R1-R8 are implemented by the explicit owner
decision, one repo-local stdlib runner, one focused test file, complete
current-tree adoption/external-empty evidence, 15 direct gates, a private-index
approved tree, and digest-bound candidate/token/phase manifests. This records a
new adopted origin and never claims reconstructed pre-build provenance.
QA round 1 validated the complete product candidate and all 15 gates but found
three blockers in the recovery runner's later docs-sealing bridge. The primary
batched them: final sealing now validates the exact 60-path release inventory,
requires and binds a separate final `docs-commit-v1` artifact, and requires the
candidate-bound sealed QA-review manifest/output. These evidence-only fixes do
not touch product code or rerun T0-v11; all gates are rerun in round 2.

The exceptional round-4 bundle completed all 15 gates with token
`sha256:a1f39ef2a6c5bba9c3b63ee7f516896a923808ed9499b24af51c2e5684c25eaa`.
Independent QA returned `CHANGES_REQUESTED` for exactly F1 and F2: the failed-gate
predecessor validator needed exact critical identities plus schema validation of
every declared artifact, and the real round-4 QA-seal-to-docs bridge lacked an
end-to-end hermetic behavioral test. The canonical rejection and candidate-bound
manifest are retained at SHA-256
`37fa8805ea04e5df674d6cb5539c4a85e33c76735cc5f80f5bc88419004615df`
and `745571baaf94cab87e2b22f7e4fdd8355e9a1666f6b5092c67aef932a5ef7a62`.
The approved F1/F2 repair completed round 5 and all 15 gates, after which
independent QA resolved F1/F2 and found F3 in the authority-artifact schema
route. The separately approved F3 repair completed round 6 and all 15 gates at
token
`sha256:0a1a13d0e8a73f6981c03d4478b6e768b2dbf971809aa9572cbd3d95caf7b0b1`.
Independent QA resolved F3 and returned `CHANGES_REQUESTED` for exactly F4/F5;
its canonical unsealed review is retained at SHA-256
`05e24c59d9dd95bb3a7becf04c33f291d2286363f73b838cffb8cb20a2c34cd3`.
The F4/F5 repair completed all 15 round-7 gates and its independent 581-case
refusal/happy-path matrix passed. Independent QA approved token
`sha256:4254a0ef9a7093ee4168fdd210c9128e2c08193f8885ad461270e114bb4c2100`;
docs attempt 2 then approved the same exact 70-path tree. Release validation
stopped before commit because `git diff --cached --check` found exactly 13
two-space Markdown endings across eight governance files. The real index was
restored empty and the round-7 fingerprint revalidated. The owner-authorized
72-path release-hygiene repair completed all 15 round-8 gates at token
`sha256:55fa7f2c5e939060805992004ce9b157939af348fda11383ad246d695e2473a2`.
Independent QA returned a sealed `CHANGES_REQUESTED` for exactly F1: the full
hermetic release-hygiene mutation, predecessor, and rollback matrix required by
the approved plan was not executable. The sealed review SHA-256 is
`622fd3c483958765001b2576946e6f112bd3f4c3a22ff17441dc1374ee54ebce` and
its manifest SHA-256 is
`d4da3465b133d361fae90afa6c02f3c2e96885b1f72a4d19147d6cd70f625dbf`.
The separately authorized 74-path F1-only repair implements an independent
136-refusal plus 9-happy-path oracle, exact round-8 predecessor validation, real
docs-attempt-3 transition coverage, and fresh-shell rollback-fence execution.
The first complete focused run passed 870 tests. The create-once round-9 runner
then passed gate 1 and stopped at gate 2 because a pre-existing command assertion
still required the now-historical round-8 operator command after this note was
updated to round 9. The assertion is corrected and the complete focused file
passes 870 tests again, and the failed round-9 directory remains immutable.
The owner then authorized exactly one consolidated approval-only round 10 and
forbade round 11. The independently approved closeout expands the exact tree to
76 governance-inclusive paths, reconstructs the pinned round-9 baseline to prove
an exact six-path governance/test delta, executes the same 15 gates, supports
two-digit review/docs/release namespaces, and covers the create-once deployment
record lifecycle hermetically. Product, snapshot, T0, payload, publication, and
security bytes remain frozen. Independent round-10 QA/docs verdicts are not
claimed in this pre-run record.

## Changed Files

The consolidated closeout candidate reconciles to exactly 76 cumulative paths, equal to
the reviewed release allowlist. External T0/QA/docs-review evidence remains
outside Git and is never included in that count.

Tail-transport/runtime/test paths:

- `.github/workflows/publish.yml`
- `dashboard/package.json`
- `dashboard/src/lib/data.ts`
- `dashboard/src/lib/filer-payload.ts`
- `dashboard/src/lib/holdings.ts`
- `dashboard/src/lib/shards.ts`
- `dashboard/src/pages/institutional/data/filers/[shard].v1.json.ts` (deleted)
- `dashboard/src/pages/institutional/data/filers/[shard].v2.json.ts` (new)
- `dashboard/src/pages/institutional/data/filers/index.v1.json.ts`
- `dashboard/src/pages/institutional/data/filers/index.v2.json.ts` (new)
- `dashboard/src/scripts/entity-client.ts`
- `dashboard/test/filer-payload.test.ts`
- `dashboard/test/post/entity-orchestration.test.ts`
- `dashboard/test/post/file-budget.test.ts`
- `scripts/accept_m2_8.py`
- `scripts/accept_m2_11.py`
- `scripts/measure_inst_derive.py`
- `src/populus/inst_budget.py`
- `tests/fixtures/filer_payload_parity.v1.json`
- `tests/test_inst_shard_budget.py`
- `tests/test_inst_snapshot_script.py`
- `tests/test_workflow_governance.py`

Cumulative approved M2-11 implementation and compatibility paths:

- `Makefile`
- `dashboard/test/post/fixture-preview.test.ts`
- `docs/runbooks/self-hosted-runner.md`
- `src/populus/amendments.py`
- `src/populus/ingest/inst13f.py`
- `src/populus/inst_agg.py`
- `src/populus/inst_agg.sql`
- `src/populus/inst_serving.py`
- `src/populus/publish/build.py`
- `src/populus/publish/digests.py`
- `src/populus/publish/manifest.py`
- `tests/test_cover_tolerance.py`
- `tests/test_digests.py`
- `tests/test_inst_agg.py`
- `tests/test_inst_external_store.py`
- `tests/test_inst_serving.py`
- `tests/test_pointer_state.py`
- `tests/test_publish.py`

Reviewed plan/evidence paths:

- `ARCHITECTURE.md` (final factual M2-11 outcome; no deployment claim)
- `STATUS.md` (factual M2-11 state; no deployment claim)
- `docs/build/RUN-M2-11-plan.md`
- `docs/build/RUN-M2-11-T0-affiliation-index-delta-plan.md`
- `docs/build/RUN-M2-11-T0-aggregate-performance-delta-plan.md`
- `docs/build/RUN-M2-11-T0-aggregate-throughput-delta-plan.md`
- `docs/build/RUN-M2-11-T0-coverage-delta-plan.md`
- `docs/build/RUN-M2-11-T0-coverage-totals-delta-plan.md`
- `docs/build/RUN-M2-11-T0-findings.md`
- `docs/build/RUN-M2-11-T0-materialization-reuse-delta-plan.md`
- `docs/build/RUN-M2-11-T0-prepared-compact-aggregate-delta-plan.md`
- `docs/build/RUN-M2-11-T0-serving-materialization-delta-plan.md`
- `docs/build/RUN-M2-11-T0-serving-performance-delta-plan.md`
- `docs/build/RUN-M2-11-T0-tail-pagination-delta-plan.md`
- `docs/build/RUN-M2-11-devnotes.md` (this artifact)
- `docs/build/RUN-M2-11-qa-report.md`
- `docs/build/RUN-M2-11-QA-finalization-decision.md`
- `docs/build/RUN-M2-11-QA-finalization-delta-plan.md`
- `docs/build/RUN-M2-11-QA-finalization-exception-decision.md`
- `docs/build/RUN-M2-11-QA-finalization-exception-plan.md`
- `docs/build/RUN-M2-11-QA-finalization-repair-decision.md`
- `docs/build/RUN-M2-11-QA-finalization-repair-plan.md`
- `docs/build/RUN-M2-11-QA-finalization-F3-decision.md`
- `docs/build/RUN-M2-11-QA-finalization-F3-plan.md`
- `docs/build/RUN-M2-11-QA-finalization-F4-F5-decision.md`
- `docs/build/RUN-M2-11-QA-finalization-F4-F5-plan.md`
- `docs/build/RUN-M2-11-QA-finalization-release-hygiene-decision.md`
- `docs/build/RUN-M2-11-QA-finalization-release-hygiene-plan.md`
- `docs/build/RUN-M2-11-QA-finalization-release-hygiene-F1-decision.md`
- `docs/build/RUN-M2-11-QA-finalization-release-hygiene-F1-plan.md`
- `docs/build/RUN-M2-11-QA-finalization-closeout-decision.md`
- `docs/build/RUN-M2-11-QA-finalization-closeout-plan.md`
- `docs/build/RUN-M2-11-QA-origin-decision.md`
- `docs/build/RUN-M2-11-QA-origin-recovery-delta-plan.md`

QA-origin recovery implementation paths:

- `scripts/build_m2_11_qa_bundle.py`
- `tests/test_m2_11_qa_bundle.py`

External append-only evidence under
`/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/` is deliberately
not a repository path and will never be staged.

## Reuse / Duplication Check

- Reused `assembleFilerPayload`, `parseFilerPayload`, the logical
  `FilerPayloadV1`, existing entity-client state taxonomy/watchdog, and
  `paginateByBytes`/`fillShardsByBytes`; no second logical producer, parser,
  state machine, or shard filler was introduced.
- Reused `inst_budget.worst_case_file_count` as the authoritative global budget;
  both acceptance scripts remain explicit consumers rather than inventing a
  competing formula.
- Reused the single shared cross-runtime parity fixture and extended it with a
  v2 fragment summary.
- Reused the package-owned bounded build command from local gates and the publish
  workflow, keeping one executable resource contract.
- Repository overlap scans during planning/review covered payload, shard, route,
  budget, build, and acceptance consumers, including comments and Markdown.
- The recovery runner reuses the pinned external worktree fingerprint, complete
  diff/redaction functions, existing artifact schemas, and repository-owned
  gates. Only the owner-adoption schemas and inspectable private-index wrapper
  are local because the historical-source premises of the generic helpers are
  false for this run.

## Simplicity Audit

The only new production abstractions are the v2 fragment/index types and pure
fragment/reassembly helpers in `filer-payload.ts`, the two minimal v2 Astro route
modules, and three budget constants. Production sharding still flows through one
existing filler. Browser behavior remains one state machine and one strict
logical parser. The v1 transition is a constant one-object tombstone, not a
parallel compatibility service. No new dependency, database, persistent table,
schema migration, configuration family, queue, worker, or compression layer was
added.

## Tech Debt Introduced

No hidden or newly introduced tech debt is known.

Two visible carried boundaries are explicitly classified:

1. The eager full-corpus payload/cache design remains resource-heavy. This was a
   locked retained design, not introduced by this delta; the delta makes its
   32-GiB/24-GiB requirement executable and fail-closed. T0's logged peak RSS is
   12,130,123,776 bytes.
2. `npm ci` reports three high-severity audit findings from the unchanged
   pre-existing lockfile. This delta changes neither dependencies nor
   `package-lock.json`; the repository's dependency guard passes. They are not
   silently claimed fixed or reclassified as delta debt.

No TODO, stub, skipped new test, disabled gate, timeout relaxation, payload-limit
relaxation, compatibility waiver, or deployment bypass was added.

Eleven bounded recovery/finalization debts are declared: TD-QA-ORIGIN-1 is the run-specific
runner/test, TD-QA-ORIGIN-2 is the Populus-owned custom adoption schema family,
and TD-QA-ORIGIN-3 is the small private-index/adoption overlap with the external
harness. TD-QA-ORIGIN-4 is the separately authorized finalization-cycle overlap:
one additional decision/namespace and retry-state surface were required because
the original product-QA cycle closed before the docs handoff defect was found.
TD-QA-ORIGIN-5 is the digest-scoped exceptional fourth-finalization retry required
after rounds 2 and 3 were consumed by self-observing focused tests. It accepts only
logical round 4 and declares the cap override in generated manifests/reports.
TD-QA-ORIGIN-6 is the exact F1/F2 bridge repair and owner-authorized fifth
finalization round. It accepts only the sealed round-4 QA rejection, exact F1/F2
resolution, and logical round 5. TD-QA-ORIGIN-7 is
the exact immutable-schema exception bridge and separately owner-authorized
F3-only sixth finalization round. Public validation rejects all six immutable
bundles with false current-schema assertions; five digest-scoped historical
policies and one exact failed-round-5 predecessor path validate only their locked
defect sets and return explicit `known-invalid-*` markers. Round 6 uses a strict
23-artifact map, honest custom-manifest labels, exact F3 resolution, cap 6 with
owner override, and produced the exact unsealed F4/F5 QA rejection. TD-QA-ORIGIN-8
is the exact path-provenance and independent mutation-oracle repair plus the
owner-authorized seventh finalization round. It binds every current adoption and
phase record to its exact authoritative path, validates the exact unsealed
round-6 predecessor, and locks 558 refusal cases plus 23 happy cases (581 total)
against test-local literal oracles. It accepts only F4/F5 resolution and cannot
authorize round 8. TD-QA-ORIGIN-9 is the exact 13-line release-hygiene
comparison, clean `owner-decision-v2` route, pre-output private staged whitespace
gate, exact sealed round-7 QA/docs predecessor, and owner-authorized eighth
finalization round. It accepts only docs attempt 3, cannot authorize round 9,
and is removed with TD1–TD8 when the generic harness natively supports this
post-approval release-gate repair. TD-QA-ORIGIN-10 is the independent 145-case
F1 oracle, exact sealed round-8 predecessor, and owner-authorized ninth
finalization round. It accepts only the sealed F1 rejection and exact resolution,
cannot authorize round 10, and shares the same generic-harness removal condition.
TD-QA-ORIGIN-11 is the approval-only consolidated closeout: the exact failed
round-9 gate transport, two-digit round-10 consumers, six-path delta proof, and
create-once deploy-run record verification. It accepts only round 10, cannot
authorize round 11 or docs attempt 4, and is removed with TD1–TD10 under the same
generic-harness cleanup condition.
These debts have no
production import and share one removal condition: a later reviewed
cleanup after the generic harness natively emits and qa-review accepts this
complete QA-only adoption bundle with typed post-QA docs sealing.

## Memory Touch-Points

The deterministic selector used keywords `payload shard pagination build
deployment qa workflow transport` and returned ten records:

- `feedback_build_in_worktree_not_live_dir.md` — kept all builds/gates in this
  dedicated worktree, never a served checkout.
- `feedback_orchestrate_workflow.md` — retained the approved feature branch and
  explicit owner gate.
- `feedback_qa_fail_batch_remediation.md` and
  `feedback_qa_remediation_discipline.md` — any QA findings will be batched,
  retested, and independently re-reviewed; no self-signing.
- `project_workflow_calibration.md` — preserved exact scope and current-state
  derivation rather than using cached inventories.
- `feedback_frontend_env_bake.md` — checked relevance; this Astro static publish
  uses signed snapshot variables rather than a Next.js `.env.local` bake, so no
  foreign Next-specific mechanism was copied.
- `feedback_supervised_deployment_dry_run_inspection.md` — shaped the mandatory
  post-merge real payload/page inspection before arming schedules.
- `feedback_bash_exit_codes.md` — the binding command captured the Python exit
  directly with no pipeline.
- `feedback_deploy_main_checkout_pattern.md` — checked relevance; deployment is
  by the repository's supervised GitHub workflow, not a Compass live checkout.
- `feedback_diagnostic_gated_separation.md` — kept pilot metrics diagnostic while
  the full result alone controls binding success.

The complete shared failure-mode catalog was also loaded.

The QA-origin plan separately used the deterministic keywords `qa origin
recovery provenance docs commit candidate token approved tree external state`.
Its ten selected records reinforced `git commit -F`, batched remediation,
create-once evidence, multi-source identity checks, complete gate scope,
tree-identity proof, dedicated-worktree isolation, and truthful persisted plans.

The F4/F5 plan used the exact canonical selector keywords `path provenance
manifest validator mutation QA remediation review`. Its returned top ten, in
order, were `feedback_qa_fail_batch_remediation.md`,
`feedback_qa_remediation_discipline.md`,
`feedback_api_path_scope_includes_components.md`,
`feedback_manifest_columns_by_name_not_index.md`,
`feedback_model_validator_config_constraints.md`,
`feedback_shared_validator_rejection_required.md`,
`feedback_stale_review_snapshot_detection.md`,
`feedback_comprehensive_decision_path_test_coverage.md`,
`feedback_convergent_review.md`, and `feedback_orchestrate_workflow.md`. They
shaped batch remediation, semantic record comparison, exact path/provenance
binding, stale-snapshot refusal, and the independent literal test-ID oracle.

## Failure-Mode Sweep

- **F0 complete-set/secrets/function:** all route, budget, acceptance, client,
  comment, and workflow consumers were swept; evidence contains no credentials;
  the forced-cut build and T0 exercised real reconstruction rather than liveness.
- **F1 plan-time:** all routes/consumers and the complete standing gate list are
  explicit in the approved plan; plan review converged in three rounds.
- **F2 dev-time:** full-tree gates ran in the isolated worktree; shared validators
  reject degenerate ranges/fragments; removal-fails tests cover fragmentation,
  tombstone, budget terms, and resource scope; stale single-shard comments were
  updated.
- **F3 QA-time:** byte sizes/counts/timings are reconciled across code, tests, the
  retained T0 log, and this record; deployment requires a real v2 index, shard,
  filer reassembly, page render, signatures, and bindings.
- **F4 handoff:** findings were appended without rewriting history; any QA FAIL
  will be remediated as one batch and resubmitted, never self-approved.
- **F5 transport:** fresh Dev Notes and QA artifacts are schema-validated and
  content-bound; any later source repair invalidates all downstream evidence and
  cannot reuse the one-shot T0-v11 filename.
- **Recovery transport:** exact current 70-path QA inventory, complete disk-only
  redacted diff, empty external-state forms, direct gate logs, real-index
  equality, acyclic token/manifest bindings, and round-to-round evidence pairs
  are all fail-closed. Exact current paths are authoritative, and the 581-case
  F4/F5 matrix cannot derive its expected IDs from production maps. The
  exception changes provenance labels, not QA content.

## Tests Run

All commands below ran after the final source edit and before T0-v11 unless
identified as the binding run itself:

| Gate | Result |
|---|---|
| focused dashboard payload suite | 36/36 passed |
| entity orchestration suite, including real forced-cut build | 24/24 passed |
| emitted-tree file-budget suite | 8/8 passed |
| focused Python budget/snapshot/governance set | 83 passed |
| expanded targeted Python set | 805 passed, 2 skipped |
| exact prior-client schema compatibility | 1 passed |
| full dashboard unit suite | 267/267 passed |
| `git diff --check` | exit 0 |
| `make check` | exit 0; 2,542 Python passed, 9 skipped; Astro check; 267 dashboard unit tests; 8,106-page bounded build; 52 post-build tests; dependency guard OK |
| `make accept-m1-b` | exit 0, acceptance passed |
| `make accept-m2-5` | exit 0, real-corpus acceptance passed |
| `make accept-m2-6` | exit 0, acceptance passed |
| `make accept-m2-8` | exit 0, acceptance passed and transition term printed |
| `make accept-m2-11` | exit 0, acceptance passed and transition term printed |
| append-only T0-v11 | direct exit 0; materialization 158.950 s, aggregate 156.725 s, serving 123.690 s; D1 PASS |

The recovery runner focused suite is added before the binding QA bundle. The
fresh bundle itself reruns all 15 literal recovery gates and retains their exact
results externally; those results supersede this paragraph for QA freshness.
Round 1's focused recovery suite passed 11 tests and all 15 retained gates,
but independent QA returned `CHANGES_REQUESTED` for F1-F3 in the post-QA docs
bridge. Round 2 passed 14 focused tests and all 15 retained gates; convergence
review found residual preflight ordering, command propagation, exact-manifest,
and behavioral-coverage gaps in the same bridge. The final batched repair moves
all preflights before output creation, publishes the exact command below,
compares the sealed review manifest canonically and exactly, and expands the
focused suite to 27 executable success/refusal tests. Round 3 passed all 15
retained gates and independent QA returned `VERDICT: APPROVED` with no open
finding.

Exceptional round 4 then passed all 15 retained gates with one unchanged
fingerprint and token
`sha256:a1f39ef2a6c5bba9c3b63ee7f516896a923808ed9499b24af51c2e5684c25eaa`.
Independent QA returned exactly F1/F2 for predecessor-schema enforcement and
missing real handoff coverage. The F1 repair pins the exact round-3 ledger,
fingerprint, two gate identities/logs, plan/decision, and cross-artifact graph,
while structurally validating all 13 declared artifacts. The F2 repair executes
real `seal-review` and `seal-docs` commands under a temporary evidence root and
asserts manifest/tree equality plus substitution and both collision refusals.
The expanded focused suite passed 116 tests before the binding run. Round 5 then
completed all 15 direct gates with one fingerprint and token
`sha256:574c6df63bb7c348a3fd38579d238781c0be9d465e40da0787f3375d52b77682`.
Independent QA resolved F1/F2 and rejected the bundle on F3: `owner-decision.md`
was declared `owner-decision-v1` without satisfying its controlling-plan clause,
and the top-level validator did not execute that declared schema. The sealed
rejection and bundle remain immutable. The owner separately authorized only F3,
one logical round 6, no product change, and no T0 rerun. The approved F3 plan
expanded the candidate to exactly 68 paths. Its implementation uses one strict
23-artifact map, honest `m2-11-phase-manifest/v1` labels, exact pinned
known-invalid policies for immutable earlier bundles, and a schema-valid round-6
decision. Round 6 completed all 15 direct gates with one fingerprint and token
`sha256:0a1a13d0e8a73f6981c03d4478b6e768b2dbf971809aa9572cbd3d95caf7b0b1`.
Independent QA resolved F3 and rejected that bundle on exactly F4/F5: current
record paths were not bound to their authoritative bundle locations, and the
locked mutation matrix was absent. The owner separately authorized only those
two repairs and logical round 7. The current 70-path implementation binds exact
paths and its independent literal-oracle suite passes all 581 locked cases
(558 refusals and 23 happy paths); the complete focused file passes 714 tests.
Round 7 then completed all 15 gates, independent QA approved, and docs attempt 2
approved the same exact tree. The subsequent release gate alone found the 13
Markdown suffix errors; no product or T0 finding was introduced. Round 8 then
ran all 15 gates and independent QA sealed exactly F1. The F1-only verification
repair expands the complete focused file to 870 passing tests. Its independent
literal oracle executes 136 refusal IDs plus 9 happy IDs and proves exact set
equality; coverage includes every locked byte/schema/predecessor/docs/private-
release branch and both standalone rollback fences in fresh hermetic shells. The
create-once round 9 passed gate 1 and stopped at gate 2 on the stale Dev Notes
command assertion. After correcting that evidence-only assertion, the complete
focused round-9 file passes 870 tests locally. The failed bundle is preserved.
The consolidated round-10 preflight passes all 875 focused tests, including the
exact failed-gate, 76-path, multi-digit namespace, six-path delta, and deployment-
record lifecycle cases. Round 10 remains the one pending binding run; no round 11
is authorized.

T0-v11 additionally proves aggregate bytes 1,040,547,840; 7,951 tail filers;
2,520,035,802 logical tail bytes; 54,944 fragments; parts median/p90/max
7/9/18; 2,714 shards; 1,048,574-byte largest shard; zero route/reassembly/
ceiling mismatches; and a measured 14,553/18,000 file projection with 3,447
headroom.

## Plan Deviations

One bounded test-harness deviation is declared: the real forced-cut entity
orchestration test's process timeout was raised from 240 to 900 seconds after a
contention-affected run exceeded 240 seconds. The exercised build still uses the
same 32-GiB physical preflight and 24-GiB child heap; no production phase,
payload, watchdog, T0, or deployment timeout changed. The isolated rerun completed
and the suite passed 24/24.

No other locked payload, route, shard, resource, performance, compatibility,
scope, or release decision deviated from the approved plan. Factual parent,
architecture, status, and final QA report were updated only after QA approval as
R12 requires; they still state PR/deployment as pending.

The QA-origin recovery is one explicit owner exception caused by installed
harness/skill version skew. It adopts the exact current tree and does not invent
historical source preservation. No product, T0, payload, resource, security,
release, or deployment contract was changed by that recovery.
The reviewer-required round-1 strengthening adds one explicit
`--final-docs-commit` input to the planned `seal-docs` command and makes its
existing QA-review input candidate-bound through the sealed manifest. This is a
declared evidence-transport deviation, not a product or release-contract change.

The first post-QA factual docs-seal attempt refused before creating its output
because `seal-docs` revalidated the historical 57-path QA bundle against the
intentionally updated 60-path live docs tree. The phase-boundary repair validates
that already sealed candidate bundle offline, while the existing exact 60-path
preflight remains the sole live-tree authority before output creation. A focused
regression assertion proves the offline call. The 27-test recovery suite was
rerun successfully; no product file, T0 artifact, retained QA gate, approved QA
review, security boundary, or release contract changed. This evidence-only
post-QA correction is carried explicitly into docs review.

Independent docs review correctly rejected that post-QA repair: source/test bytes
had changed after the closed product-QA approval, typed docs inputs still named the
57-path bundle, and the final commit artifact remained one-line/provisional. The
owner-authorized QA/docs finalization delta supersedes that attempted handoff with a
separate decision and exact 62-path cycle. It reruns all 15 gates, requires fresh
independent QA, binds current typed inputs, seals docs-review verdicts, and validates
the exact live/cached tree immediately before release. Recovery and finalization
authority stay cycle-specific; retry findings are derived from the prior review,
not hard-coded. No product byte, T0-v11 artifact, snapshot, bound, or deployment
security rule changes. Fresh finalization bundle and review outcomes are retained
externally and remain authoritative; this repository note intentionally makes no
advance claim that those pending independent reviews approved.

Before creating the finalization round-1 bundle, the cycle-aware evidence runner
passed 39 focused success/refusal tests, including dynamic prior-finding
resolution, historical-bundle validation, exact docs-review sealing, pre/post-stage
release validation, and rejection when a docs manifest relabels its approved-tree
output. The round-1 bundle reran all 15 required gates and remains retained as
the exact predecessor evidence for its independent verdict.

Finalization QA round 1 then validated all 15 fresh gates and found six bounded
evidence-transport blockers, with no product/T0 regression. The batched repair
declares TD-QA-ORIGIN-4, replaces the stale operator command, derives the global
docs-attempt sequence, supports exact docs-originated QA predecessors, validates
complete predecessor graphs, preflights paired QA-review outputs, and passes all
validator paths as positional data. The expanded focused suite passes 53 tests.
Because those are repository edits, round-1 evidence is retained only as the
required predecessor. Round 2 then stopped create-once at focused gate 2 because
one transition test incorrectly asserted that the active bundle directory did not
exist while that same bundle was running. Its partial ledger and logs remain
append-only. The repaired test verifies the predecessor transition before output
creation without depending on the outer runner's already-created directory; an
exact failed-gate predecessor graph and resolution note now authorize round 3.
No product/T0 byte changed. Round 3 then stopped at the same focused gate because
its newly added failed-gate predecessor test repeated the outer-directory
assertion for the active round-3 path. That assertion is removed. The separately
authorized exception implementation now passes 62 focused tests, including
digest-scoped cap/override, generated-report TD1..TD5, exact 64-path inventory,
wrong-round/round-5 refusal, and a hermetic test whose inner temporary evidence
root remains independent while a synthetic outer round-4 directory already exists.
Both failed bundles remain append-only. The owner-authorized round-4 binding run
completed all 15 gates, but independent QA rejected the evidence bridge on F1/F2.
Its sealed rejection is immutable. The separately approved repair authorizes only
those two fixes and exactly one logical round 5; no product byte, T0-v11 artifact,
snapshot, bound, or deployment security rule changes, and no round 6 is authorized.

The following is the historical round-5 command that executed once and is now
superseded by the sealed F3 rejection and later owner authority. It must not be
invoked again:

```bash
root=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11
qa_bundle="$root/qa-v9-finalization-round-5"
final_message="$root/final-docs-commit.finalization-r5-a1.md"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py run \
  --cycle finalization-repair-exception --round 5 \
  --final-docs-commit "$final_message" \
  --prior-review "$root/qa-v9-finalization-round-4/qa-review.round-4.md" \
  --resolution-notes "$root/resolution-notes.finalization-r4-qa.md" \
  --output "$qa_bundle"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py validate \
  --bundle "$qa_bundle"
```

The exact round-9 command below is historical: it ran once and stopped
fail-closed at gate 2. Its output remains append-only and must not be invoked
again:

```bash
root=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11
qa_bundle="$root/qa-v9-finalization-round-9"
final_message="$root/final-docs-commit.finalization-r9-a3.md"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py run \
  --cycle finalization-release-hygiene-f1-exception --round 9 \
  --final-docs-commit "$final_message" \
  --prior-review "$root/qa-v9-finalization-round-8/qa-review.round-8.md" \
  --resolution-notes "$root/resolution-notes.finalization-r8-F1.md" \
  --output "$qa_bundle"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py validate \
  --bundle "$qa_bundle"
```

The following is the only authorized pending binding command. It may create
round 10 once and cannot create or authorize round 11:

```bash
root=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11
qa_bundle="$root/qa-v9-finalization-round-10"
final_message="$root/final-docs-commit.finalization-r10-a3.md"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py run \
  --cycle finalization-closeout-exception --round 10 \
  --final-docs-commit "$final_message" \
  --prior-gate-bundle "$root/qa-v9-finalization-round-9" \
  --resolution-notes "$root/resolution-notes.finalization-r9-gate2.md" \
  --output "$qa_bundle"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py validate \
  --bundle "$qa_bundle"
```

## Model Provenance

Implementation, gate coordination, T0 execution, and this artifact were produced
by the primary Codex GPT-5 agent in the owner-authorized task. The tail-pagination
plan was independently reviewed read-only by the separate `plan_reviewer` agent
for three rounds; the primary agent authored all remediations. The exceptional
finalization retry and F1/F2 repair plans were each independently approved by that
reviewer after two rounds. The F3-only round-6 and F4/F5-only round-7 plans were
each approved after three rounds; the primary fixed all plan findings. Product QA used the same separate
read-only reviewer for three rounds, with the primary retaining sole responsibility
for fixes; product round 3 approved. Exceptional finalization round-4 QA returned
a sealed F1/F2 rejection. Round-5 QA resolved those findings and returned a sealed
F3-only rejection. Round-6 QA resolved F3 and returned an unsealed F4/F5-only
rejection. Round-7 QA and docs attempt 2 independently approved; the release
gate then found only the 13 Markdown suffix errors. The release-hygiene plan was
independently approved after three rounds; round 8 ran all gates and independent
QA returned sealed F1. The F1-only plan was approved after two rounds; round-9
gate 2 stopped on one stale evidence assertion before independent QA. The failed
bundle is preserved and will not be self-signed or retried. The consolidated
closeout plan was independently approved after its final fail-closed shell
amendment; logical round 10 and its independent QA remain pending in this
pre-run record, and no round 11 is authorized.
No model staged, committed, pushed, opened a PR,
mutated release variables, or deployed during implementation/T0/QA.
