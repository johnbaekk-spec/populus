# RUN M2-3 — cross-filer aggregates + multi-module publish integration

**Source of truth:** `ARCHITECTURE.md` §5.6 (consumer matrix — M2 R→`inst_agg.db`), §5.5 (publish
protocol, versioned logical digest), §12.1 (inventory/dist digest), §17 (two-build reproducibility
P1 gate). Contract: `docs/build/M2-CONTRACT.md` (§3 consumer matrix, §6 tools these feed, §8 gates).
Builds on **RUN M2-2** (`v_default_holdings`, inst tables) and M1 publish substrate
(`publish/build.py`, `manifest.py`, `digests.py`, `inventory.py`, `client/snapshot.py`) — the
snapshot client + manifest are **already module-keyed** (`manifest["modules"][name]`,
`_MODULE_NAME` grammar); `build.py` is the piece to generalize. **Do not regress any M1 test.**

## Scope (owns)

`src/populus/inst_agg.py` (aggregate builder → `inst_agg.db`); edits to `src/populus/publish/build.py`
(emit the `inst` module + its logical-digest projection), `src/populus/publish/manifest.py` (admit
`inst`), and a `MODULE`/module-registry generalization where needed; `tests/test_inst_agg.py`; extensions
to `tests/test_publish.py` (multi-module manifest + two-build inst digest). Wire aggregate build into
`populus build` (or `populus inst-agg`) in `cli.py`.

## Requirements

1. **Aggregates** (`inst_agg.py`, from `v_default_holdings`, deterministic ordering): (a) **filer
   registry** — CIK, name, latest period, position count, total `value_usd`; (b) **QoQ deltas** per
   filer×security across consecutive periods — `new|add|trim|exit`, Δvalue, Δshares (join as-of, G14);
   (c) **top-holders per issuer** ranked by `value_usd` as-of period; (d) **concentration** — per-filer
   top-N share (or HHI). Emit to a fresh `inst_agg.db` (schema owned here).
2. **Manifest `inst` module** (§5.5): `modules.inst` with `client_compat` (PEP 440), `watermarks`
   (latest `period_of_report`, latest `filed_date`), `artifacts[]` (`inst_agg.db` + any JSON slices;
   sha256/bytes/path/license_ids incl. `sec-edgar`), and an inst **logical-digest projection v1**
   (allowlist inst tables minus volatile `ingested_at`; RFC 8785 rows, PK-sorted, `T:<table>\n` framing).
3. **Generalize `build.py`**: assemble build-scoped artifacts for **both** `congress` and `inst`
   under `builds/<build_id>/` without breaking M1. The recovery journal stays congress-scoped
   (`inst_agg.db` is regenerable from the ingested inst tables — note in Tech Debt if the same-build_id
   recovery contract needs a one-line scope statement); no new remote-mutation ordering.
4. **`manifest.py`**: admit additional modules — relax the hard `congress`-only requirement to
   "≥1 known module, each well-formed" (keep congress present in the standard build) **without
   regressing M1 manifest validation**. `populus verify` recomputes **all** artifact hashes + **both**
   module logical digests + pointer/manifest consistency.
5. **Two-build reproducibility** (P1 gate, §17): two independent builds of the same cached inst inputs
   yield an **identical `inst` logical digest** — test asserts it (mirrors the congress two-build test).
6. **Snapshot serve**: an integration test constructs `SnapshotClient(module="inst")` over the published
   tree and reads back an aggregate (client machinery already supports it — exercise, don't rebuild).
7. **M2 ≥95 % value-coverage gate — a pre-publication requirement, enforced in this run's
   `build`/`publish` path** (M2-CONTRACT §8; assigned by RUN M2-2 LD-8/R17, ratified by that plan's
   human approval). RUN M2-2 already **computes and persists** the never-inflated gate inputs
   (`inst_filings.table_value_total_usd` / `resolved_value_usd` / `resolved_rows`, and the
   `v_default_inst_filings` / `v_default_holdings` predicate); this run **executes** the gate before the
   `inst` module is published, since M2-3 owns publication. Semantics (LD-8):
   - **Threshold:** coverage ≥ **0.95**.
   - **Denominator** = Σ `table_value_total_usd` over `v_default_inst_filings` (includes info-table-failed
     filings whose cover total is known — they drag coverage down, never vanish).
   - **Numerator** = Σ `value_usd` over `v_default_holdings` with a non-null `security_id`.
   - **Certifiability vs threshold are SEPARATE signals** (do not conflate them — RUN M2-2 QA-F6):
     `InstCoverage.certifiable` means **measurable** (`denominator > 0` and no *cover-failed* filing);
     `InstCoverage.meets_threshold` means measurable **and** `coverage ≥ COVERAGE_THRESHOLD` (0.95).
     A fully-measurable 94 % is *certifiable but below threshold*, not "non-certifiable".
   - **Cover-failure is keyed on the `cover_failed` FLAG, never on "total IS NULL"** (RUN M2-2 QA-F3 —
     do not reintroduce this): a valid totals-free **`13F-NT` notice** legitimately has
     `table_value_total_usd IS NULL` and is a genuine **zero contribution**, *not* an unknown one. Counting
     every NULL total as a failure would refuse publication solely because a valid notice exists. Use
     `cover_failed_count` as computed by `populus.ingest.inst13f.compute_coverage` (which already applies
     this rule) rather than re-deriving it. An M2-3 gate regression test must cover a notice-only corpus.
   - **Publish is REFUSED (fail-closed)** when `meets_threshold` is false — i.e. coverage < 0.95, or
     `denominator = 0` (no inst value → N/A, not an auto-pass), or `cover_failed_count > 0` (a genuinely
     cover-failed filing of unknown value). Summing an unknown total as 0 would inflate coverage.
   - **OWNER DECISION (2026-07-24) — ship the gate as specified; fail-closed is ACCEPTED.** The
     threshold stays **≥0.95** and the gate is enforced exactly as written. It is understood and
     accepted that, with only the FTD bootstrap admitted, the `inst` module **will not publish**
     (coverage tops out ≈50 % by value per period — measured in RUN M2-2's V-A). That is the correct,
     honest outcome: no under-covered inst snapshot is published, and the rest of this run —
     aggregates, QoQ deltas, the `inst` manifest module, the logical digest, two-build reproducibility
     and `verify` — is still built and fully tested. **Do NOT lower the threshold, and do NOT widen
     FTD intervals by inference to make the gate pass.** The gate becomes satisfiable when an
     identifier-history source is admitted through §15 (a later, separately-contracted run).
     Acceptance for THIS run therefore asserts the gate REFUSES to publish `inst` on the FTD-only
     corpus (a fail-closed test), not that it passes.
   - **Data-acquisition prerequisite (blocking input to this run):** period-covering FTD / identifier
     data must be admitted through the §15 conditions register (`sec-ftd`) so the CUSIP→`security_id`
     resolution the numerator depends on can reach ≥95 %; without it the gate stays fail-closed.
     **Measured in RUN M2-2's V-A acceptance: FTD alone cannot reach the threshold** — its as-of intervals
     only cover dates a security actually failed to deliver (~50 % by value per period; 0 % when no
     period-covering archive is loaded). Reaching ≥95 % therefore requires either an identifier-history
     source admitted via §15, an explicitly-labelled confidence-carrying inference layer (G5), or an
     owner decision to revisit the gate's basis/threshold. **Raise this with the owner at M2-3 entry.**
   So no under-coverage or genuinely cover-failed inst snapshot can publish before the gate exists.

## Acceptance

`uv run pytest -q` green — multi-module manifest, two-build inst digest reproducibility, and **all prior
M1 publish/pointer/digest tests unchanged**. End-to-end on real cached data: `db init → identity bootstrap
→ ingest inst-13f → build → publish --data-repo ../populus-data → verify` yields a manifest carrying
**both** `congress` and `inst` modules; `verify` recomputes both; a second build bumps `pointer_version`
and an unchanged re-poll is an idempotent accept. QoQ deltas computed on the real Berkshire
2025-Q4→2026-Q1 pair.
