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

## Acceptance

`uv run pytest -q` green — multi-module manifest, two-build inst digest reproducibility, and **all prior
M1 publish/pointer/digest tests unchanged**. End-to-end on real cached data: `db init → identity bootstrap
→ ingest inst-13f → build → publish --data-repo ../populus-data → verify` yields a manifest carrying
**both** `congress` and `inst` modules; `verify` recomputes both; a second build bumps `pointer_version`
and an unchanged re-poll is an idempotent accept. QoQ deltas computed on the real Berkshire
2025-Q4→2026-Q1 pair.
