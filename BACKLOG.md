# Populus — backlog

**As of 2026-07-31**, on `main` @ `f78376e`. Consolidates the older `STATUS.md`
"Pending" list with everything carried open out of M2. Ordered by priority
*within* each section; sections are ordered by kind, not urgency.

**Shipped:** M1 (congressional trading, 6 runs) · M2 (institutional 13F, 6 runs
— identity coverage 0.9996, `inst` serving) · P3-2 (public dashboard frontend)
· **P3-3a/P3-3b — `publicfilings.org` live 2026-08-08 with a signed,
independently-verifiable deployment record.**
**In flight:** RUN M1-B (congressional 2013–2025 backfill).

---

## 1. Correctness — carried open from M2

Full detail, reproductions and file:line: [`docs/build/M2-KNOWN-ISSUES.md`](docs/build/M2-KNOWN-ISSUES.md).

- [ ] **B1 · KI-4 — coverage is published above 100%.** An over-counting
      amendment composition makes an inflated filing *print* `coverage = 1.2`.
      The gate correctly fails closed; the **published number** is wrong.
      **Do this one first.** It is the only M2 finding that needs no malformed
      input — it sits on a live path — and a ratio above 100% directly
      contradicts the project's premise of calibrating trust in numbers.
      *Fix:* return `coverage = None` for an inflated population, keep
      numerator/denominator for diagnosis, assert corpus **and** per-period
      coverage never publish above 1.

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

## 5. Carried open from RUN P3-3b (site went live 2026-08-08)

`publicfilings.org` is live and serving an **attestation-verified** build:
generation 1 for `20260808.1`, 5379/5379 files swept, `verification_scope:
expected_paths`. Twelve runs; ten first-contact defects, all fixed and
mutation-pinned. These two are what P3-3b knowingly did **not** close.

- [ ] **B15 · Ticker names are missing site-wide — the honest no-map state
      (TD-7).** `POPULUS_TICKER_MAP` points at a deliberately absent path on
      CI, because `company_tickers.json` exists only under
      `data-cache/inst/registry` on a workstation: it is not in git, `build.py`
      emits none, and `publish.yml` ingests congress only. So the deployed site
      renders `no-map` on ticker surfaces and the search index carries empty
      ticker names.

      **This was chosen, not overlooked.** The alternative the code originally
      had was falling back to `tests/fixtures/inst/mcp/company_tickers.json` —
      shipping *fixture* data as production truth, which the served-tree sweep
      cannot detect because the served bytes would faithfully match the built
      bytes. Refusing a fixtures path under CI is now enforced
      (`dashboard/src/lib/inst.ts`) and lint-asserted in
      `tests/test_attestation_structure.py`.

      **To close:** give the pipeline a real registry source — either an ingest
      step that fetches SEC's `company_tickers.json` under the existing SEC UA
      policy (**the SEC UA must never change**), or a copy committed to
      `populus-data` and staged into the build as a manifest-listed artifact so
      it is covered by the digest and the sweep. Then point
      `POPULUS_TICKER_MAP` at the staged copy and delete the absent-path
      placeholder in `publish.yml`.

- [ ] **B16 · The TD-4 override exists and has been used once — decide whether
      it stays.** A live-but-unattested deployment deadlocks the R18 gate: it
      refuses to publish over an unexplained state, including the publish
      carrying the fix. Cloudflare will not delete an active production
      deployment, and attesting a known-bad build to clear a gate is the one
      thing this system exists to prevent. So
      `acknowledge_unrecorded_code_sha` was added: it must name the exact
      `code_sha` the domain serves, is `workflow_dispatch`-only (a nightly can
      never carry one), clears **only** that state, attests nothing, and records
      in the verdict that a human overrode a gate.

      **It was used once, on 2026-08-08, to clear the deadlock run 10 created.**
      Procedure and the explicit "what not to do" are in
      [`docs/runbooks/deploy.md`](docs/runbooks/deploy.md); mutants pin that any
      other sha and an always-on form both fail.

      **Decide:** keep it as the documented TD-4 clearing path, or remove it now
      that generation 1 exists and the deadlock cannot recur in the same shape.
      Keeping it is defensible — the deadlock is structural, not a one-off — but
      an override that is never exercised is an override nobody remembers is
      there. If it stays, it belongs in §14's credential/override inventory and
      in the quarterly review.

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
