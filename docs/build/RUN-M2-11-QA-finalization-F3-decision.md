# RUN M2-11 — Exceptional F3 Finalization Repair Owner Decision

**Date:** 2026-08-11
**Owner authorization:** “Authorize one exceptional owner-reviewed F3-only finalization
repair and QA round 6, with no product changes or T0 rerun.”

The owner authorizes one bounded repository repair and one sixth logical round of the
separate M2-11 QA/docs finalization cycle. The repair is limited to F3 in the sealed
round-5 QA review: make the current authority artifact genuinely satisfy the schema
declared by its manifests, make bundle creation and top-level validation execute that
declared schema, and add fail-if-removed coverage for both acceptance and rejection.

The round-5 bundle, its false schema assertion, its 15 successful gates, and its sealed
`CHANGES_REQUESTED` review remain immutable historical evidence. Round 6 must consume
that bundle only through an exact failed-QA-predecessor contract, bind the exact F3
resolution note, use a new create-once `qa-v9-finalization-round-6` output, rerun all 15
unchanged repository gates, and receive independent QA and docs reviews.

This decision does not authorize round 7, any product/schema/payload/build or
deployment-policy change, another T0/full-corpus run, snapshot mutation, validation
relaxation, evidence deletion or overwrite, self-approval, staging before both reviews
approve, or an insecure deployment shortcut. Any round-6 gate failure, QA
`CHANGES_REQUESTED`, or repository repair after round 6 is a hard stop requiring new
owner authority.

The controlling plan is
`docs/build/RUN-M2-11-QA-finalization-F3-plan.md`; all prior plans, decisions, bundles,
reviews, logs, T0-v11, and the snapshot remain immutable historical evidence.
