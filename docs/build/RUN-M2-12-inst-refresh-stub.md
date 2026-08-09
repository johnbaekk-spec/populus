# RUN M2-12 — nightly institutional refresh (WITHDRAWN scope stub)

**Artifact:** scope stub · **Date: 2026-08-08** · **Status: withdrawn from RUN
M2-11 (R14/R15 retired; IDs not reused)** · maintained by T13, which also
verifies the absence of any refresh code
(`tests/test_workflow_governance.py`).

This document is the record that nightly refresh scope was **withdrawn, not
lost**. No refresh implementation exists: `src/populus/inst_refresh.py` does
not exist, and no code surface references the retired arming variable
`POPULUS_INST_REFRESH_ARMED` (both pinned by test — naming the variable here
in prose is the record; referencing it in code is the regression the test
catches). Any future refresh work starts from a **new plan** that answers the
design questions below; it does not resume from M2-11.

## Why withdrawn

M2-11 publishes from an **accepted, immutable, versioned snapshot** cut by the
owner (R23) — the module's source is frozen by design. A nightly refresh
inverts that: it would write new corpus state on a schedule, on the
self-hosted machine, against the resumable bulk-ingest journals. The journal
binding evidence below shows why that is not a flag-flip but a design problem.

## Journal-binding evidence (verified in this tree, 2026-08-08)

The resumable bulk pipeline (`src/populus/inst_bulk.py`) binds every journal
to a digest of the state that produced it:

- **`refs_sha256` — `inst_bulk.py:316`**: the canonical digest binding the
  rank journal — the discovered form-index references plus the ranking
  params, all available at sweep time. `rank_universe` (line 372) loads its
  journal with `binding_field="refs_sha256"` (line 400) and writes it back
  bound to the same digest (line 491).
- **Universe digest binding — `inst_bulk.py:898–907`**: the ingest driver's
  docstring states the contract ("journaled (bound to `universe_sha256`) after
  every filer", line 898) and the code enforces it — `load_journal(...,
  binding_field="universe_sha256", binding_value=universe.universe_sha256)`
  (lines 906–907, re-bound at 1099). The universe digest itself is computed at
  `inst_bulk.py:560` over the ranked top-N body.

The consequence: **a refreshed corpus produces new digests, and every prior
journal stops matching**. A naive nightly re-run either re-fetches the entire
durable corpus (defeating resumability and hammering SEC) or silently reuses
journals whose binding no longer describes the universe they claim to cover.

## Design questions a future refresh plan must answer

1. **Journal carry-forward / migration.** When the universe digest changes
   (new quarter, changed top-N membership), which per-CIK journal entries are
   still valid, and under what proof? A migration rule must be explicit —
   digest-mismatch today is a hard refusal, which is correct for M2-11 and
   fatal for a nightly.
2. **Changed-lineage invalidation.** An amendment or restatement arriving for
   an already-journaled filer changes that filer's reconciled lineage. What
   invalidates the journaled outcome map for exactly that filer without
   discarding the rest?
3. **Top-N vs full-universe policy.** The ranked universe is a top-N cut; a
   refresh can change membership at the boundary. Does refresh track the
   moving top-N (churn at the edge), pin a fixed universe per snapshot line,
   or widen to the full universe (a cost model nobody has measured)?
4. **Transitive write scope.** Refresh writes corpus state. Which store does
   it write — never the canonical audit store (an M2-11 invariant), so a
   refresh needs its own writable lineage store and a defined promotion path
   into an accepted snapshot version.
5. **Idempotency on a new accession.** A crashed refresh that half-ingested an
   accession must resume to the same end state as an uninterrupted run — the
   existing per-accession outcome maps get this per filer; the refresh
   orchestration above them must preserve it across universe changes.
6. **Shared manual/CI locking.** The owner cuts snapshots manually
   (`scripts/inst_snapshot.py`); a scheduled refresh would contend for the
   same stores and the same machine. A single lock discipline must cover both
   actors, or a nightly will one day run mid-snapshot-cut.

## Snapshot-retention obligation (owed BEFORE snapshot v2 — LD-8 / TD-7)

Accepted snapshots are **immutable and versioned** (`inst-source-v<N>.db`),
and each is a ~23 GB copy of the canonical store. Versions therefore
accumulate at ~23 GB per corpus state, and nothing deletes them — immutability
is the point, unbounded growth is the bill.

**Obligation:** before any snapshot **v2** is cut, a retention contract must
exist that states: how many versions are kept, which version(s) the published
provenance (`inst_source.json`) may still reference, what proves a version is
no longer referenced by any rollback path (the R25/LD-2 variable can be
repointed to an older version — retention must not delete the rollback
target), and who executes the deletion (owner-only, like every destructive
snapshot operation). Recording this here is the M2-12 carrying obligation from
the RUN M2-11 plan (round-3 reviewer note; Non-goals; DoD 1).
