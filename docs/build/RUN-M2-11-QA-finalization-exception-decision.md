# RUN M2-11 — Exceptional QA/Docs Finalization Retry Owner Decision

**Date:** 2026-08-11
**Owner authorization:** “Authorize one exceptional owner-reviewed finalization retry
beyond the three-round cap.”

The owner authorizes exactly one fourth logical retry of the separate M2-11 QA/docs
finalization cycle. This exception exists only because finalization rounds 2 and 3
stopped at the focused recovery-tool gate after append-only evidence directories had
already been created; neither failure changed product code, T0-v11, or the accepted
snapshot.

The retry must use a new create-once `qa-v9-finalization-round-4` bundle, bind and
validate the failed round-3 gate bundle plus exact primary-authored resolution notes,
rerun all 15 repository gates, and receive an independent owner-requested QA review.
It may proceed to append-only docs-review attempts only after QA approval and without
any repository byte changing. Any round-4 gate failure, QA `CHANGES_REQUESTED`, or
post-QA repository repair is a hard stop requiring new owner authority; no fifth QA
round is authorized.

This decision does not authorize another product-QA round, another T0/full-corpus run,
evidence deletion or reuse, relaxed validation, self-signing, an unsafe current-user
runner, deployment before independent docs approval, or bypass of the secure
self-hosted-runner prerequisites. The controlling plan is
`docs/build/RUN-M2-11-QA-finalization-exception-plan.md`; prior plans, decisions,
bundles, reviews, logs, and snapshots remain immutable historical evidence.
