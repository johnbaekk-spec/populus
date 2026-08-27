# RUN M2-11 — QA/Docs Finalization Owner Decision

**Date:** 2026-08-11
**Owner authorization:** “You have authorization for EVERYTHING within this repo.
I'm going to bed. I want to wake up to being able to see the Institutional data on
publicfilings.org. … Let's get it completed please.”

The owner authorizes one separate evidence-only finalization cycle after the closed
three-round product-QA cycle. The finalization cycle may use at most three fresh QA
rounds and three append-only docs-review attempts. It must rerun all 15 repository
gates for any current repository source/docs repair, preserve T0-v11 and the accepted
snapshot byte-for-byte, and obtain independent QA and docs approval before release.

This decision authorizes current-tree adoption through the existing repo-local custom
schema validator and the new finalization plan. It does not reuse the recovery cycle's
same-run provisional-docs exception, waive freshness or substantive review, authorize
a fourth product-QA round, weaken self-hosted runner isolation, or permit deployment
before the exact reviewed release tree is merged.

The controlling plan is
`docs/build/RUN-M2-11-QA-finalization-delta-plan.md`. Historical recovery bundles,
reviews, T0 evidence, and snapshots remain immutable and retain their original
authority records.
