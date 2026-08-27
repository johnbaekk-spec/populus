# RUN M2-11 — Final QA Report (qa-report-v1)

## Detected Stack

- Python 3.12.13, pytest, uv, SQLite/JSON1, and Make-owned repository gates.
- TypeScript/Astro, Node 24.16.0, npm 11.13.0, static Pages publication.
- Dedicated worktree `codex/m2-11-t0-finalize` at fixed HEAD
  `7391d947f72cf408a173f1e7938102608b2269d4`.

## Summary

The cumulative RUN M2-11 institutional-publication candidate passed its single
append-only T0-v11 binding run and three independent read-only QA rounds. QA
round 3 approved the exact 57-path candidate with token
`sha256:7747af94f5100803543d822c06fd989033c7525a43f2da1e459e3f285ebcb8cb`.
No product blocker or hidden debt remains. PR, merge, and deployment were not
performed during product QA and are not claimed here. Exceptional finalization
round 4 completed all 15 gates, then independent QA returned exactly F1/F2 in the
evidence bridge. A separately owner-authorized and independently plan-reviewed
F1/F2-only repair then completed logical round 5 and all 15 gates. Independent QA
resolved F1/F2 and returned a sealed F3-only rejection. The separately authorized
F3-only repair completed logical round 6 and all 15 gates. Independent QA
resolved F3 and returned an unsealed rejection for exactly F4/F5. The separately
authorized and independently plan-reviewed F4/F5-only repair plus logical round
7 completed all 15 gates and independent QA approved. Docs attempt 2 approved
the same exact 70-path tree. Release then stopped before commit when the
mandatory staged check found exactly 13 Markdown trailing-space errors. The
index was restored empty. The separately owner-authorized release-hygiene repair
then completed all 15 round-8 gates without product drift. Independent QA sealed
`CHANGES_REQUESTED` for exactly F1: the plan-required hermetic verification
matrix was incomplete. The separately owner-authorized F1-only repair is a
74-path round-9 candidate whose complete focused file passes 870 tests, including
all 136 refusal and 9 happy-path IDs. The create-once round-9 run passed gate 1
and stopped at gate 2 because one stale evidence assertion still demanded the
historical round-8 command. That assertion is corrected and the complete focused
file passes locally. The failed bundle is immutable and independent QA was not
entered. The owner then authorized one approval-only consolidated round 10 and
forbade round 11. Its independently approved 76-path closeout binds the exact
failed gate, proves an exact six-path governance/test delta from the reconstructed
round-9 candidate, adds two-digit docs/release support, and covers the deployment
run-record lifecycle. Product and T0 remain frozen; the round-10 gates and
independent verdict remain pending in this pre-run report.

## Requirement Coverage

- The accepted 23,058,628,608-byte snapshot is mode `0444`, sidecar-free, and
  SHA-256 `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`.
- Aggregate and serving derivation, schema 1.1 compatibility, logical payload
  parity, v2 fragment/routing transport, v1 transition tombstone, file budgets,
  and bounded build resources are covered by focused and full-tree tests.
- Recovery requirements R1-R8 are covered by explicit current-tree adoption,
  complete diff/external-empty evidence, direct gates, exact trees/tokens, and
  candidate-bound review/docs handoffs.
- Exceptional F3 requirements R1-R7 completed through exact digest-scoped
  round-6 authority, the sealed known-invalid round-5 QA predecessor, exact F3
  resolution, 68-path equality, a strict 23-artifact schema map, exact private
  historical policies, honest custom-manifest labels, and cycle-aware evidence.
- Exceptional F4/F5 requirements R1-R8 are implemented through exact unsealed
  round-6 rejection identity, exact F4/F5 resolution, 70-path equality, exact
  current adoption/phase paths, test-local literal oracles, and 558 refusal plus
  23 happy cases. Round-7 gates and independent QA/docs review approved.
- Release-hygiene requirements R1-R8 are implemented through the exact 13-line
  round-7-tree comparison, strict clean-date owner schema, private staged
  whitespace gate, exact sealed round-7 QA/docs predecessor, 72-path equality,
  docs attempt 3, and a digest-scoped logical round 8.
- Release-hygiene F1 requirements R1-R7 are implemented through the exact sealed
  round-8 F1 rejection, independent 145-ID oracle, exact predecessor and
  docs-attempt-3 mutations, fresh-shell rollback-fence execution, 74-path
  equality, and a digest-scoped logical round 9.
- Consolidated-closeout requirements R1-R7 are implemented through the exact
  failed round-9 gate-2 bundle and resolution, exact 76-path inventory and
  six-path delta proof, approval-only round 10/no-round-11 authority, unchanged
  15 gates, multi-digit seal/release consumers, and fail-closed create-once
  deployment-record verification.

## Gate Evidence

Round 3 retained 15 direct commands, all exit 0, with identical pre/post
fingerprint `d1809dd007e1413d26f7210fdd834a7670dba1c83c0c9d951e20dbaad996f873`.
The canonical test/lint/typecheck/security surfaces all pass. The run includes
27 focused recovery tests, the expanded institutional/publication suites,
released-client compatibility, the complete `make check` site build/post-build
tree, security, and M1-B/M2-5/M2-6/M2-8/M2-11 acceptances.

Round 6 retained the same 15 direct command surfaces, all exit 0, with one
pre/post fingerprint
`1225aba74d91d4ab8f7854311233d1d577f26d868787d184ad76d0632a9781b8`
and token
`sha256:0a1a13d0e8a73f6981c03d4478b6e768b2dbf971809aa9572cbd3d95caf7b0b1`.
Round 7 retained all 15 direct command surfaces at exit 0 with token
`sha256:4254a0ef9a7093ee4168fdd210c9128e2c08193f8885ad461270e114bb4c2100`.
Independent QA and docs attempt 2 approved its exact 70-path tree. Round 8
retained all 15 direct commands at exit 0 with fingerprint
`327f0b589f75afd2fcf197d1835eaad22a23da4e1a60109e769a8d396ebceee5`
and token
`sha256:55fa7f2c5e939060805992004ce9b157939af348fda11383ad246d695e2473a2`.
Independent QA sealed exactly F1. Round 9 retained gate 1 at exit 0 and gate 2
at exit 1 with one shared fingerprint
`d1e54262f690a499f9e04b2babaf9ac4a374869b99b6b31e46f582f983f4faeb`.
The failure was the stale Dev Notes command assertion; subsequent gates and
independent QA did not run.

## Issues Found

Rounds 1 and 2 found three recovery-transport blockers each, all confined to the
post-QA docs-sealing bridge. The primary batched fixes, reran all gates, and
preserved exact review/resolution pairs. Round 3 verified every prior finding as
resolved and found no new blocker.

The first factual docs-seal invocation after QA then refused before creating its
output because it compared the historical 57-path QA fingerprint with the
intentionally updated 60-path docs tree. A phase-boundary evidence-only repair
now validates the already candidate-bound QA bundle offline and leaves the exact
60-path preflight as the live-tree authority. Its focused regression assertion
and all 27 recovery tests pass. Product code, T0-v11, retained QA gates, and the
approved round-3 review are unchanged; docs review receives this correction
explicitly rather than treating it as part of the sealed QA candidate.

Independent docs review rejected that handoff because the repair itself was not in
the approved product-QA candidate, the typed docs inputs remained historical, and
the proposed commit evidence lacked rationale. The separately owner-authorized
QA/docs finalization plan therefore requires a fresh exact-62-path bundle, all 15
gates, independent QA, current typed docs inputs, a multiline final message, sealed
docs approval, and pre/post-stage release validation. That finalization evidence is
append-only outside Git and is authoritative for the later release decision. This
repository report preserves the already-approved product/T0 QA result without
pre-claiming the pending finalization QA or docs verdict.

Before finalization round-1 bundle creation, the cycle-aware evidence runner
passed 39 focused success/refusal tests. Round 1 then passed all 15 gates but
independent QA requested six evidence-transport changes and found no product/T0
regression. The batched repair expands the focused suite to 53 passing tests,
covering dynamic prior-review findings, global docs-attempt transitions, exact
QA/docs predecessor graphs, refusal-atomic review sealing, shell-safe validator
paths, append-only attempt namespaces, and pre/post-stage release refusal paths.
Round 2 then stopped append-only at focused gate 2 because a transition test
observed the outer runner's already-created round-2 directory and mistook it for
premature output from its mocked inner invocation. The partial ledger is retained;
the assertion was narrowed to the actual pre-output boundary, and the failed-gate
bundle is now bound as an exact predecessor. Those focused results do not replace
full QA. Round 3 then stopped at the same focused gate because the new round-3
predecessor test repeated the active outer-directory assertion. The assertion is
removed. The owner then authorized exactly one exceptional finalization retry beyond
the cap. Its plan was independently approved in two rounds at SHA-256
`71ca0c1f4eaadb165d49655de4dd838cbbb3ed9b681df815bd170d03f018faf3`.
The digest-scoped implementation accepts only logical round 4, requires the exact
failed round-3 gate graph and resolution, emits cap 4 with explicit owner override,
and rejects every other round. Its 62 focused tests pass, including a hermetic synthetic-outer
round-4 regression, exact generated-report TD1..TD5 assertions, and 64-path QA/
release equality. Those statements describe the pre-run checkpoint; the retained
round-4 outcome follows.

Round 4 subsequently ran once and all 15 direct gates passed with token
`sha256:a1f39ef2a6c5bba9c3b63ee7f516896a923808ed9499b24af51c2e5684c25eaa`.
Independent QA returned `CHANGES_REQUESTED` for exactly F1/F2. F1 required the
failed round-3 predecessor to pin the ledger, fingerprint, exact two gate/log
identities, plan/decision, and cross-artifact graph while schema-validating all
13 declared artifacts. F2 required a real hermetic round-4 `seal-review` to
`seal-docs --attempt 1` success/refusal test. The canonical rejection is retained
at SHA-256
`37fa8805ea04e5df674d6cb5539c4a85e33c76735cc5f80f5bc88419004615df`
and its manifest at
`745571baaf94cab87e2b22f7e4fdd8355e9a1666f6b5092c67aef932a5ef7a62`.
The owner-authorized repair implements only F1/F2, expands the exact candidate to
66 governance-inclusive paths, and passed 116 focused success/refusal tests. Round
5 then completed all 15 direct gates with token
`sha256:574c6df63bb7c348a3fd38579d238781c0be9d465e40da0787f3375d52b77682`.
Independent QA resolved F1/F2 and returned `CHANGES_REQUESTED` for exactly F3:
the declared `owner-decision-v1` was not actually schema-validated by the
top-level bundle validator and its content lacked the required controlling-plan
clause. That rejection, its manifest, and the 66-path bundle remain immutable.

The owner then authorized exactly one F3-only repair and logical QA round 6, with
no product change or T0 rerun. The F3 plan was independently approved in three
rounds at SHA-256
`105f5c4966d8d50d9f2737b779ff378b841198c74819c3597f71e9454ecd01d6`.
The implementation expands the exact tree to 68 governance-inclusive paths,
executes a strict schema route for all 23 adoption artifacts and every phase
record, labels custom manifests honestly, publicly rejects six immutable invalid
bundles, and permits only exact pinned private `known-invalid-*` evidence paths.
The round-5 predecessor additionally requires its exact token, adoption, decision,
sealed review/manifest, open F3, and exact resolution. Round 6 completed all 15
direct gates at token
`sha256:0a1a13d0e8a73f6981c03d4478b6e768b2dbf971809aa9572cbd3d95caf7b0b1`.
Independent QA resolved F3 and returned `CHANGES_REQUESTED` for exactly F4/F5:
adoption and phase records were not bound to exact authoritative paths, and the
plan-required mutation/refusal matrix was not implemented. The canonical
unsealed review remains immutable at SHA-256
`05e24c59d9dd95bb3a7becf04c33f291d2286363f73b838cffb8cb20a2c34cd3`.

The owner then authorized exactly one F4/F5-only repair and logical QA round 7,
with no product change or T0 rerun. Its plan was independently approved after
three rounds at SHA-256
`44763fb1a35eb13fca4f580278863dc3f53c76959c38fead97221c0161bcd55b`.
The implementation expands the exact tree to 70 governance-inclusive paths,
binds every current adoption and phase record to the exact authoritative path,
validates the exact unsealed round-6 predecessor, and uses test-local literal
oracles for 558 refusal cases plus 23 happy paths. The complete focused file
passed 714 tests. Round 7 then completed all 15 gates, independent QA approved,
and docs attempt 2 approved the exact same repository tree. During release
staging, `git diff --cached --check` found exactly 13 two-space line endings in
eight governance Markdown files. Release stopped before commit; the index was
restored empty and the candidate fingerprint was revalidated.

The owner then authorized exactly one release-hygiene repair and logical QA round
8, with no product change or T0 rerun. Its plan was independently approved after
three rounds at SHA-256
`338c81697acf31c26ecf76b797febdadc7e293e1f3dbef315cf27c7e450e3289`.
The implementation removes only those 13 suffixes, expands the exact tree to 72
governance-inclusive paths, validates the immutable round-7 tree/archive and
sealed QA/docs predecessor, adds a clean `owner-decision-v2` route, and runs the
unmodified staged whitespace check in a private index before evidence output is
created. The focused release-hygiene file passed 723 tests. Round 8 completed all
15 gates at token
`sha256:55fa7f2c5e939060805992004ce9b157939af348fda11383ad246d695e2473a2`.
Independent QA sealed `CHANGES_REQUESTED` for exactly F1 because the approved
hermetic verification matrix was incomplete; the sealed review SHA-256 is
`622fd3c483958765001b2576946e6f112bd3f4c3a22ff17441dc1374ee54ebce`.
The separately authorized F1-only plan was independently approved after two
rounds at SHA-256
`da6f13b9968468c4c49506bcff4ca70e75d87c17b2d39d71fa490373f7c52213`.
Its 74-path implementation adds the exact sealed round-8 predecessor, 136
refusal plus 9 happy-path literal IDs, real docs-attempt-3 coverage, and fresh-
shell execution of both rollback fences. The complete focused file passes 870
tests in local verification. The create-once round-9 runner then passed gate 1
and stopped at gate 2 because an older test still asserted that the Dev Notes
must publish the historical round-8 command. The assertion is corrected and all
870 focused tests pass again and the failed round-9 bundle is preserved. The
owner then authorized the consolidated closeout plan, which was independently
approved after a hermetic deployment-record test exposed and corrected one zsh
`errexit` assumption before binding. The current 76-path tree changes only the
closeout decision/plan, runner, focused tests, Dev Notes, and this report relative
to the reconstructed round-9 candidate. Independent QA, docs attempt 3, PR,
merge, and deployment remain pending; no round 11 is authorized.

## New vs Pre-existing

Product changes are the approved cumulative M2-11 implementation. The
M2-11-specific QA adoption runner/schema bridge is new, owner-authorized, and
declared. Three npm high-severity audit findings remain pre-existing in the
unchanged lockfile; the dependency guard passes and no finding is reclassified
as fixed.

## Test Coverage Gaps

The round-8 F1 coverage gap is resolved by an independent literal 145-ID oracle;
the terminal test proves exact executed-set equality to 136 refusal and 9 happy
IDs. The
docs-sealing fixture covers exact inventory success, missing/extra refusal, no consumed
output on preflight failure, final commit-message binding, duplicate/noncanonical
JSON, stale inputs, changed review, wrong candidate, relabeling, extra input,
missing manifest, and cross-path substitution. The exceptional repair tests also
cover exact round-3 critical identities and every declared schema, owner-decision
malformations/substitution, a real hermetic round-4 handoff, both collision
directions, exact round-5 QA predecessor/cap/report, historical validation, wrong
predecessors/rounds, and the historical round-6 refusal that governed that cycle.
The F3 suite additionally covers the exact 23-record map, real current schema
routes, five public historical refusals/private pinned markers, the exact
four-defect round-5 public refusal/private F3 predecessor, pin mutation, honest
custom-manifest generation, cap-6 manifests/report, the exact 68-path inventory,
the round-6 QA-only transition, wrong-round/wrong-predecessor refusal, and universal
round-7 refusal. The F4/F5 suite adds independent literal adoption, phase,
historical, defect-set, predecessor-record, review-field, and happy-path oracles;
all 581 locked IDs execute, and expected-ID equality cannot derive from the
production schema/policy maps. It covers path, parent/name, digest, duplicate,
missing, extra, content-stale, digest-only, and predecessor-shape mutations.
The F1-only suite additionally covers all 52 byte mutations, 12 owner-schema
refusals, all 36 round-7 and 24 round-8 predecessor refusals, eight docs-attempt
refusals, four private/release refusals, nine happy paths, actual attempt-3
sealing, and both standalone rollback fences in fresh hermetic shells.
The closeout suite additionally covers exact round-9 pins and resolution,
round10/no11 authority, 76-path equality, generated TD1–TD11 reporting,
multi-digit review/docs/release namespaces, exact six-path reconstruction, and
deployment-record pre-existence, collision, partial creation, malformed/extra/
wrong-type/wrong-run/wrong-URL/wrong-merge refusal plus exact watched-run status,
conclusion, URL, and merge readback.
T0-v11 is verification-only after its one permitted successful run.

## Security

Evidence is create-once/mode-0600 outside Git; credential values/private-key
blocks are scrubbed; secret-looking candidate paths refuse; the complete diff is
disk-only. The real Git index is hash-equal before/after private-tree creation.
Runner isolation, accepted residuals, hosted credential separation, and exact
workflow governance remain documented and tested.

## Tech Debt Introduced

Declared debt is limited to the retained eager-build resource requirement and
`TD-QA-ORIGIN-1` through `TD-QA-ORIGIN-11` for the run-specific recovery runner,
custom adoption schemas, bounded private-index overlap, and separately authorized
finalization-cycle overlap. TD5 is the exact digest-scoped fourth-finalization
retry after two create-once rounds were consumed by self-observing tests. TD6 is
the F1/F2-only bridge repair and fifth finalization round. TD7 is the exact
five-policy historical compatibility surface, the known-invalid round-5 F3
predecessor, and sixth finalization round. TD8 is the exact F4/F5 path-provenance
and independent 581-case mutation-oracle surface plus seventh finalization round;
it cannot authorize round 8. TD9 is the exact 13-line release-hygiene comparison,
clean owner schema, pre-output staged gate, sealed release predecessor, and eighth
finalization round; it cannot authorize round 9. TD10 is the independent
145-case F1 oracle, exact sealed round-8 predecessor, and ninth finalization
round; it cannot authorize round 10. TD11 is the approval-only consolidated
round-10 closeout, exact failed-gate transport, two-digit consumer bridge,
six-path delta reconstruction, and create-once deploy-record verifier; it cannot
authorize round 11 or docs attempt 4. TD7–TD11 are removed with TD1..6 when the
generic harness natively owns strict typed-artifact validation and failed-QA
transport. No hidden product,
security, test, or release debt is known.

## Memory Touch-Points

Deterministic memory selections and the shared failure-mode catalog drove exact
inventories, complete gates, create-once evidence, batched remediation,
candidate/tree identity, stale-review rejection, and `git commit -F` release
discipline. The final independent review rechecked these touch-points.

## Failure-Mode Sweep

Complete consumers and paths, secret handling, functional reconstruction,
cross-artifact numeric identity, exact record-path identity, source-repair
invalidation, immutable approval handoff, append-only retry discipline, and
output non-creation on preflight failure all have retained executable evidence.
Independent frozen test-ID oracles prevent a common-mode shrink of the F4/F5
mutation matrix.

## Verdict

PASS
