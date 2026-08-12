# RUN M2-11 — Exceptional Finalization Repair / QA Round 5 Owner Decision

**Date:** 2026-08-11
**Owner authorization:** “Authorize one exceptional owner-reviewed finalization repair
and QA round 5, strictly limited to QA findings F1 and F2, with no T0 rerun or product
changes.”

The owner authorizes one bounded repository repair and one fifth logical round of the
separate M2-11 QA/docs finalization cycle. The repair is limited to the two open blockers
in the sealed round-4 QA review:

1. enforce the exact pinned round-3 failed-gate predecessor identities and validate every
   declared predecessor artifact and resolution note before output creation; and
2. add a hermetic fail-if-removed test that carries the exceptional round-4 candidate
   through candidate-bound QA sealing and docs attempt A1, including manifest/tree
   equality and substitution/collision refusals.

The new cycle must use a distinct digest-scoped decision/plan, exact create-once
`qa-v9-finalization-round-5` output, the sealed round-4 `CHANGES_REQUESTED` review and
exact F1/F2 resolution notes, all 15 unchanged repository gates, and independent QA and
docs reviews. It may update only the run-specific evidence bridge, its focused test, the
two factual repository reports, and this decision/its controlling plan.

This decision does not authorize a sixth QA round, any product/schema/payload/build or
deployment-policy change, another T0/full-corpus run, snapshot mutation, threshold or
validator relaxation, evidence deletion/overwrite, self-approval, staging before both
reviews approve, or an insecure deployment shortcut. Any round-5 gate failure, QA
`CHANGES_REQUESTED`, or repository repair after round 5 is a hard stop requiring new
owner authority. Existing plans, decisions, bundles, logs, reviews, T0-v11, and the
snapshot remain immutable historical evidence.
