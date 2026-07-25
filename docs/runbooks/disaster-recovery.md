# Runbook — disaster recovery (ARCHITECTURE.md §13.5)

Rebuild the entire canonical store from raw archives on a clean machine and
prove the rebuild reconciles with the last published manifest — **logical
content, never file bytes** (SQLite page layout and library version
legitimately perturb file hashes). Drilled in P1; target **≤ 2 hours**.

This is the **operator** path. Automatic publish recovery (R35) never runs
these steps: `reconcile_inflight` completes an in-flight build from the data
repo (`.staging/` journal) and the remote release journal alone. This runbook
exists for the case where the canonical store itself is lost.

Execute **in order**; every command line is executable as written.

## 1. Clean machine → clone both repos

```bash
git clone https://github.com/johnbaekk-spec/populus.git
git clone https://github.com/johnbaekk-spec/populus-data.git
cd populus
python3 -m pip install --quiet 'uv==0.7.13'
uv sync --frozen
```

## 2. Download the raw-archive bundles

Raw archives are Release assets on `populus-data` (monthly bundles). Restore
them into a local `raw/` root laid out as the ingest jobs archived them:

```bash
mkdir -p raw
gh release list --repo johnbaekk-spec/populus-data --limit 100
gh release download raw-2026-07 --repo johnbaekk-spec/populus-data --dir raw
```

## 3. Rebuild the database from the archives

Initialize a fresh database, ingest offline from the restored archive, then
reparse both chambers from the raw documents (atomic per filing):

```bash
uv run populus db init rebuild.db
uv run populus ingest congress-house --db rebuild.db --from-cache raw/house
uv run populus ingest congress-senate --db rebuild.db --from-cache raw/senate
uv run populus ingest members --db rebuild.db --from-cache raw/legislators
uv run populus ingest congress-backfill --db rebuild.db --from-cache raw/kadoa
uv run populus reparse congress-house --db rebuild.db --raw-root raw/house
uv run populus reparse congress-senate --db rebuild.db --raw-root raw/senate
```

## 4. Reconcile against the last published manifest

`verify --db` recomputes the rebuild's `logical_digest` under the pinned
projection and reconciles row counts against the manifest-listed
`stats.json` — both must match the last publish:

```bash
uv run populus verify --data-repo ../populus-data --db rebuild.db
```

A digest mismatch means the rebuild does not reproduce the published logical
content: diff row counts per table first, then per-filing `parse_status`
against the completeness reconciliation (§9), before touching anything
published.

## 5. Resume publishing from the rebuilt store

Only after step 4 reconciles:

```bash
uv run populus build --db rebuild.db --data-repo ../populus-data
uv run populus publish --data-repo ../populus-data
uv run populus verify --data-repo ../populus-data
```

## Pre-draft crash boundary (owner-accepted, benign — 2026-07-23)

**Contract (precise):** automatic recovery completes the **same `build_id` from
the first durably-recoverable object — the uploaded+verified recovery journal —
onward**. The earlier boundaries create **no durably-recoverable state** and are
handled by **safe-refuse + rebuild** (owner-accepted, DR-5-driven). This is
by-design, not a broken "completes at every boundary" promise. It is a
deliberate, bounded, owner-accepted limitation:

- **Before the first remote mutation** (`populus build` has staged
  `.staging/<build_id>/journal.json` but `populus publish` has not yet created
  the draft or uploaded the journal) there is **no durable remote or committed
  state**. A crash here strands nothing: a fresh runner (fresh git clone, no
  working-tree `.staging/`) simply **rebuilds from source** — the ingested
  `congress.db` is regenerable via the re-ingest path in steps 1–4 above — and
  publishes normally. `next_build_id` burns the interrupted id; nothing
  consumer-visible was ever exposed, so there is nothing to reconcile.
- **From draft creation with the journal uploaded onward**, the journal (and
  the exact `congress.db` bytes it inlines) is the durable first remote object,
  and `reconcile_inflight` / `populus publish` completes the **same** build_id
  from committed data-repo state + the remote alone (drilled in
  `tests/test_publish.py::test_fresh_runner_completes_same_build_at_every_boundary`).
- **Explicitly rejected alternative:** committing the recovery journal to git
  before the first remote mutation to cover the pre-draft window. The journal
  **inlines `congress.db` as base64** (~35 MB/build), so committing it per
  build would add ~1 GB/month permanently to the data repo's git history —
  regressing **DR-5 / §13.4**, whose whole point is that SQLite snapshots are
  **Release assets, never git-tracked**, to stay under the >1 GB migration
  trigger. A benign, bounded window is not worth regressing a load-bearing
  git-bloat-avoidance invariant. **Owner-accepted 2026-07-23.**

A draft that was created but has **no valid recovery journal on the remote**
(the crash landed between draft creation and the verified journal upload) is
**not** silently rebuilt: recovery refuses loudly and preserves the draft —
resolve it via the abandoned-draft cleanup in `rollback.md` (drafts-only).

*Re-raised and re-affirmed (round 6, 2026-07-23): an external review again
asked that the three earliest boundaries complete the same `build_id`. Re-
affirmed owner-accepted — the only way to do so is to commit the DB-inlining
journal to git, which regresses DR-5/§13.4; their current behavior (safe-refuse
+ rebuild, nothing stranded) is correct by design.*

## Multi-module recovery boundary — the inst asset (TD-M2-3-1, RUN M2-3)

A build that clears the M2 ≥95% gate carries a SECOND Release asset,
`inst_agg.db` (the cross-filer aggregate), alongside `congress.db`. The recovery
journal stays **congress-scoped by design** — it inlines only `congress.db`
(committing a second DB-inlining envelope would regress DR-5/§13.4 exactly as
above) — so the inst asset is recovered as a **present draft Release asset** or
**regenerated from source**, never carried in the journal. `_complete_build`
uploads `inst_agg.db` from the staged `assets/` directory AFTER the journal +
`congress.db` (the P1 journal-first / publish-release / pointer-last order is
unchanged) and before `publish_release`.

Crash boundaries for an inst-bearing build:

- **Before the journal** — same as the pre-draft boundary above: nothing durable
  exists, a fresh runner rebuilds from source (steps 1–4 regenerate the ingested
  tables, and `populus build` regenerates `inst_agg.db` deterministically).
- **After the journal + `congress.db`, before the inst upload, staging lost** —
  the narrow fresh-runner window. `reconcile_inflight` / `populus publish` finds
  the inst module in the journal's manifest but `inst_agg.db` is **neither a
  verified draft asset nor present in staging**, and the congress-scoped journal
  cannot regenerate it. Recovery **refuses loudly**: the release is left a draft,
  the pointer is unmoved, and nothing consumer-visible is stranded. Resolve it
  with the **drafts-only cleanup** below (shown for an example interrupted id
  `20260724.1`), then rebuild under a new `build_id` (which regenerates
  `inst_agg.db` from source):

  ```bash
  # 1. Delete the abandoned draft (drafts-only; published releases are immutable)
  gh release delete data-20260724.1 --repo johnbaekk-spec/populus-data --yes
  # 2. Remove any stale staging scratch for it
  rm -rf ../populus-data/.staging/20260724.1
  # 3. Rebuild + publish under a fresh id (next_build_id burns the interrupted one)
  uv run populus build   --db rebuild.db --data-repo ../populus-data
  uv run populus publish --data-repo ../populus-data
  ```

  This is the same executable, owner-accepted drafts-only cleanup as
  `rollback.md` Appendix A — one documented operator command, applied to a
  regenerable derived asset.
- **After the inst upload** — `verify_asset` finds `inst_agg.db` present and
  completion proceeds normally. On the SAME runner (staging intact) the upload is
  simply retried from staging and completion is fully automatic; no operator
  step is needed.

*Removal condition:* widen the journal to a multi-DB envelope (accepting the
DR-5 git-size cost) or upload the inst asset ahead of the journal — either would
make the narrow window fully automatic. Neither is worth its cost today, so the
one-command operator step stands (drilled in
`tests/test_publish.py` fresh-runner inst crash-boundary tests).

## Filesystem trust boundary (§14, owner-accepted — bounded)

Populus hardens **all untrusted-data-derived paths** (manifest / pointer /
asset / journal / module names) through containment chokepoints
(`resolve_within`, the backend `_safe_path`, the client `_safe_under`) plus
strict grammar. It **additionally refuses symlinks at the base subdirs/files it
OWNS AND CREATES** — `releases/`, `builds/`, `.staging/`, and the monitor's
`pointer-tuple.json` / `failures` — as bounded tamper-detection: each owned
component is checked with `is_symlink()` before any write and refused if a
symlink was swapped in (never `.resolve()`-then-trust).

It **treats the *configured* `data_repo` and monitor `state_dir` roots
themselves as trusted operator inputs.** Defending a symlinked configured-root
(or a symlinked `$HOME`/parent above it) is **explicitly out of the §14 threat
model** — planting a symlink there already requires publisher-filesystem write
access, at which point the attacker could edit code or the source database
directly. The check is deliberately bounded to the owned children and does not
chase parent directories.

## Appendix — stale staging scratch

A `.staging/<build_id>/` directory **without** a `journal.json` is
pre-durable scratch from a build interrupted before its journal was staged —
it is never adopted and never published. `next_build_id` burns the id (it
never reuses it); the directory itself may be removed by hand:

```bash
ls ../populus-data/.staging
rm -rf ../populus-data/.staging/20260722.9
```
