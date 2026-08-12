# RUN M2-11 — QA Origin Adoption Decision

**Decision date:** 2026-08-11
**Scope:** RUN M2-11 only
**Status:** authorized for implementation; independent QA remains required

The repository's installed QA-only harness predates the current qa-review v9
origin/provenance contract and cannot emit the required source-preservation,
isolated-feature, external-state, approved-tree, candidate-state, and combined
token artifacts. No earlier `.orchestrate` origin bundle exists for this
interactively built dedicated worktree.

The owner authorized all work within this Populus repository and directed the
team to complete publication of Institutional data. For this run only, that
authorization permits adopting the exact current candidate as a new QA origin.
The adoption is explicitly **not pre-build provenance** and makes no claim about
historical overlap or a reconstructed source checkout.

The exception supersedes only these generic transport preconditions:

1. a historical pre-build origin;
2. an earlier-run docs origin (a same-run provisional docs artifact is used);
3. generic-validator ownership for the new Populus-specific adoption schemas.

It does not waive freshness, complete changed-file/diff evidence, secret
redaction, the 15 approved product and repository gates, immutable T0-v11 and
snapshot verification, independent QA, final docs review, exact release scope,
or supervised functional deployment.

The controlling recovery plan is
`docs/build/RUN-M2-11-QA-origin-recovery-delta-plan.md`, SHA-256
`2df62fa4dd2a54bfac932238e0b8fcd16a6386d3b6c75dabe038eacf714297ba`.
It passed canonical plan-v1 validation and independent read-only plan review
after three rounds. The final reviewer found no open blocker and returned
`VERDICT: APPROVED`.

The adopted fixed Git identity is branch `codex/m2-11-t0-finalize`, HEAD
`7391d947f72cf408a173f1e7938102608b2269d4`, fetched `origin/main`
`21340330a0fad7e9e39c1a9cec67656643621b05`. T0-v11 remains append-only and
may not be rerun under its existing filename.
