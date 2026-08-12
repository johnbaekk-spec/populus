# RUN M2-11 — Release-Hygiene F1 Verification Owner Decision

**Date:** 2026-08-11
**Owner authorization:** “Authorize one exceptional owner-reviewed F1-only release-hygiene verification repair and QA round 9, limited to the missing hermetic tests and evidence updates, with no product changes or T0 rerun.”

This decision authorizes only the open F1 in the sealed round-8 QA review:
complete the missing hermetic release-hygiene refusal matrix and exact docs
attempt-3 transition coverage, propagate the factual evidence state, and execute
one create-once logical QA round 9. The repair may extend only the existing
M2-11 evidence runner and its focused test module; it may not change any product
behavior or rerun T0-v11.

The round-8 bundle, all 15 passing gate records, its canonical
`CHANGES_REQUESTED` review, and its sealed review manifest remain immutable.
Round 9 must consume that exact sealed rejection and an exact F1 resolution,
rerun the same 15 gates, and receive fresh independent QA before docs attempt 3.

This decision does not authorize edits to the thirteen completed Markdown
suffix repairs, product/dashboard/database/serving/aggregate/payload/build/
workflow/runbook/acceptance files, T0-v11, the source snapshot, prior evidence,
validation policy, security controls, or deployment behavior. It does not
authorize evidence deletion or overwrite, self-approval, logical round 10,
docs attempt 4, or release before new independent QA and docs approvals.

The controlling plan is
`docs/build/RUN-M2-11-QA-finalization-release-hygiene-F1-plan.md`.
