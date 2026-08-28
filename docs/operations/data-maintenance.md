# Recurring data maintenance

Owner procedures that keep the institutional (13F) data trustworthy between
code changes. Companions: [`deploy.md`](deploy.md) (the publish path),
`../runbooks/self-hosted-runner.md` (the publisher host these stores live on).

## Quarterly: re-verify the curated manager registry

**Cadence:** once per quarter, after each 13F filing deadline (period end plus
45 days). **Owner-run** — it needs a build's `inst_agg.db` and a human with a
primary source; it is not CI.

```sh
uv run python scripts/maintenance/verify_manager_registry.py --inst-db <inst_agg.db>
```

The build already fails automatically on an `active` registry row that stops
joining (the R24 gate). This command answers the question the gate cannot:
which rows are still *correct*. A manager that renamed itself or was acquired
still joins by CIK and passes the gate while its display name silently goes
stale — only a human with a primary source can settle that, so the command
reports and never edits. `verified_date` on each row
(`src/populus/manager_registry.yaml`) is the expiry clock; the report names the
rows that have aged past it. It exits non-zero when the build gate would fail,
so it can be chained.

## As needed: cut an accepted institutional source snapshot

`scripts/inst_snapshot.py` stays at its historical path — the Makefile
(`accept-m2-11` cuts its hermetic fixture snapshot with the same protocol), the
runner runbook, and `tests/test_inst_snapshot_script.py` all pin it. It is an
**owner protocol, deliberately incapable of running by accident**: it refuses
to act without an explicit `--source` (the canonical ~21 GB audit store,
opened read-only) and `--dest-dir` (the snapshots directory).

```sh
uv run python scripts/inst_snapshot.py \
  --source <inst-source.db> --dest-dir "$(dirname "$POPULUS_OPS_SNAPSHOT")"
```

The finalization order is load-bearing (R23; measured at plan revision 3):
backup-API copy to a unique temp sibling → apply the shipped `views.sql` →
write the single-row `inst_source_meta` inside the hashed bytes (R24) →
`wal_checkpoint(TRUNCATE)` → explicit `journal_mode=DELETE` with the returned
value asserted → assert no `-wal`/`-shm` sidecars → `chmod 0444` **before**
re-verification → reopen read-only, re-run `verify_views` +
`integrity_check` → sha256 of the finalized bytes → fsync → refuse an existing
destination → atomic no-replace publication via `os.link`. A crash at any
point after publication leaves an already-immutable destination; there is no
window in which an accepted snapshot exists writable.

The published snapshot is what `POPULUS_INST_DB` points the stage build at;
the runner runbook documents the host path convention (`POPULUS_OPS_SNAPSHOT`).
