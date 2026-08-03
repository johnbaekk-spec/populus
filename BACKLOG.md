# Populus — backlog

**As of 2026-07-31**, on `main` @ `f78376e`. Consolidates the older `STATUS.md`
"Pending" list with everything carried open out of M2. Ordered by priority
*within* each section; sections are ordered by kind, not urgency.

**Shipped:** M1 (congressional trading, 6 runs) · M2 (institutional 13F, 6 runs
— identity coverage 0.9996, `inst` serving) · P3-2 (public dashboard frontend).
**In flight:** RUN M1-B (congressional 2013–2025 backfill).

---

## 1. Correctness — carried open from M2

Full detail, reproductions and file:line: [`docs/build/M2-KNOWN-ISSUES.md`](docs/build/M2-KNOWN-ISSUES.md).

- [x] **B1 · KI-4 — coverage is published above 100%.** An over-counting
      amendment composition makes an inflated filing *print* `coverage = 1.2`.
      The gate correctly fails closed; the **published number** is wrong.
      **Do this one first.** It is the only M2 finding that needs no malformed
      input — it sits on a live path — and a ratio above 100% directly
      contradicts the project's premise of calibrating trust in numbers.
      *Fix:* return `coverage = None` for an inflated population, keep
      numerator/denominator for diagnosis, assert corpus **and** per-period
      coverage never publish above 1.
      **DONE 2026-07-31** (branch `fix/b1-ki4-coverage-never-above-one`):
      `compute_coverage` / `compute_period_coverage` report a ratio only for a
      measurable population (`certifiable` AND integer
      `numerator <= denominator`); inflated, cover-failed, and over-run
      populations report `coverage = None` with raw sums retained; construction
      guards refuse any ratio above 1; all eight printing surfaces render
      `None` as `unmeasurable` through one validating renderer, which also
      refuses out-of-range values from pre-fix `.staging/` gate records.
      `certifiable`/`meets_threshold` byte-identical — no population's
      publishability moved. See `docs/build/M2-KNOWN-ISSUES.md` §4.

- [ ] **B1a · (follow-up, owner decision) Should `numerator > denominator`
      de-certify?** Deliberately NOT changed in B1 (its R4 froze
      publishability): a hand-built or edge database with a NULL-total,
      non-`cover_failed` filing that still carries resolved holdings can clear
      the ≥0.95 gate on an unmeasurable population — it now *reports*
      `unmeasurable` where it used to report a >1 number, but it still
      publishes. No known live trigger (a `13F-NT` notice reports no holdings).
      One-line change to `certifiable` plus a re-run of the gate-outcome tests,
      once decided. Executable demonstration:
      `tests/test_cover_tolerance.py::test_corpus_coverage_is_none_when_the_numerator_exceeds_a_certifiable_denominator`.

- [ ] **B2 · KI-1 + KI-2 — the parse substrate.** An invalid status cell
      collapses to the same canonical value as a blank one, so the R5
      cross-format gate can declare two *different* files identical (KI-1); and
      a row damaged before the fixed `[67:70]` status slice hides an A/D
      conflict, seeding a disputed identity (KI-2). One defect wearing two
      faces: validation and R5 identity share a representation that cannot serve
      both. **Do not patch these individually** — two consecutive review rounds
      tried, and each fix moved the defect.
      *Fix:* implement [`docs/build/RUN-M2-5-parse-substrate.md`](docs/build/RUN-M2-5-parse-substrate.md)
      — **but design-review it first; its review hung and produced nothing.**

- [ ] **B3 · KI-3 — the SEC `Total Count` trailer check is optional.** Skipped
      whenever extraction returns `None`, so a regex or typography drift
      silently removes the only independent row-count proof while parse coverage
      stays at 1.0. *Fix:* require and parse the trailer for production PDFs;
      a recognized-but-unparseable trailer hard-fails.

- [ ] **B4 · Three lower-value round-2 findings.** Sidecar value-type schema
      validation (types unchecked, `int()` can leak a raw `TypeError`);
      incomplete replay/migration state snapshots; missing negative tests for
      split resolution returning `NULL`.

- [ ] **B5 · Re-measure malformed-row counts on every newly cached quarter.**
      B2 was accepted on a measurement — 167,083 rows across all seven cached
      SEC files, **zero** malformed. That is what makes KI-1/KI-2 latent rather
      than live. Their failure mode is **silent** (R5 passes, coverage stays
      high, a disputed identity seeds), so this count is the only alarm.
      A non-zero `bad_width` or `bad_field` means stop and do B2.

## 2. Process

- [ ] **B6 · Check what a review actually examined before trusting its verdict.**
      M2-5 round 2 returned *APPROVED, zero findings*; an independent
      code-scoped review of the same commit returned *2 blockers, 6 majors* and
      re-graded the round-1 fixes as 10 fixed / 5 partial / 1 not-fixed. The
      difference was scope: the approving round spent its budget on harness
      bundle provenance and never read the implementation. Scope reviews to the
      code and put harness/CI provenance explicitly out of scope.

- [ ] **B7 · (Optional) Re-run Run 6 through orchestrate for process parity.**
      Code is merged and green; this only re-establishes the plan→review→QA
      paper trail the other runs have.
      ```bash
      cd ~/projects && ORCH_ASSUME_YES=skip-human-gate ORCH_PROFILE=quality WORKFLOW_MAX_ARTIFACT_BYTES=8388608 \
        ./orchestrate-tool/orchestrate.sh Populus "Re-validate RUN 6 (MCP server, already implemented under src/populus/mcp_server/) per docs/build/RUN-6-brief.md; ARCHITECTURE.md governs (§9.9, §11); tests green under 'uv run pytest -q'."
      ```

- [ ] **B8 · (Optional) Deeper cross-module adversarial sweep of M1.**

## 3. Owner actions — outward-facing, P0

These are **yours, not an agent's**: they involve account credentials and a
naming decision.

- [ ] **B9 · Claim the PyPI name.** Publish the `populus-mcp 0.0.1` placeholder.
- [ ] **B10 · Pick the domain (ARCHITECTURE OQ-1).** `populusfinance.com`
      collides with Populus Financial Group; candidates are in ARCHITECTURE.

## 4. Roadmap — deferred by design

One module at a time (G12).

- [ ] **B11 · RUN M1-B** — congressional 2013–2025 backfill. *(in flight)*
- [ ] **B12 · M3** — company financials.
- [ ] **B13 · M4** — macro.
- [ ] **B14 · P3 remaining dashboard surfaces** beyond the P3-2 frontend.

---

## Notes for whoever picks this up

- **G-guardrails govern**: G1 no paid/vendor data · G3 never silently drop ·
  G4 both dates always · G5 ranges and units labeled · G10 flows/snapshots ≠
  holdings · G12 one module at a time · G14 no identity time-travel.
- **Run orchestrate in a dedicated git worktree**, never the main checkout — its
  tree-fingerprint invariant FATALs on any concurrent change, and several
  sessions now write this repo simultaneously.
- **Verify against a frozen tree.** A headless agent reporting "completed" does
  not mean its writes landed; hash the source tree before and after any gate run
  and treat a mismatch as invalidating the run. A traceback whose displayed
  source line doesn't match the code (a comment, a wrong signature) is a
  source/bytecode mismatch — you are chasing a ghost, not a bug.
- **When three-plus review rounds land blockers in one mechanism, stop patching
  and write the spec.** Proven on the M2-4 serving lifecycle, M2-4 amendment
  composition, the P3 feed pagination, and again on the M2-5 parse substrate
  (B2).
