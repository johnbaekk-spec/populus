# Runbook — rollback (ARCHITECTURE.md §13.5, P1 staging variant)

The only supported rollback is a **new, higher pointer generation targeting an
older `build_id`** — never a bare rewrite of `latest.json` to old bytes (every
post-P2 client rejects that as replay). The P1 staging variant below runs the
identical sequence minus attestation. Execute the steps **in order**; every
command line is executable as written from the `populus` repo root.

## 1. Select the rollback target

Identify the older, known-good `build_id` (its `builds/<build_id>/` directory
and `data-<build_id>` release must both exist):

```bash
ls ../populus-data/builds
cat ../populus-data/latest.json
```

## 2. Mint the higher-version pointer targeting the older build

`publish --rollback-to` mints `pointer_version + 1` with a fresh
`issued_at`/`expires_at` and the older build's `manifest_sha256`, then
replaces `latest.json` **last** (atomic write):

```bash
uv run populus publish --data-repo ../populus-data --rollback-to 20260722.1
```

## 3. Verify the repointed state

```bash
uv run populus verify --data-repo ../populus-data
```

## 4. Verify a consumer follows the rollback

A consumer must experience the rollback as an ordinary higher-version update:

```bash
uv run python - <<'EOF'
from datetime import datetime, timezone
from populus.client.snapshot import LocalRepoFetcher, SnapshotClient

client = SnapshotClient(
    "/tmp/populus-rollback-drill-cache",
    LocalRepoFetcher("../populus-data"),
    now=lambda: datetime.now(timezone.utc),
)
result = client.refresh()
print(result.status, result.build_id, result.pointer_version)
assert result.status in ("installed", "idempotent"), result
EOF
```

## 5. Commit and push the pointer (orchestrator-owned)

Library code never commits; the operator (or the workflow) does:

```bash
git -C ../populus-data add builds latest.json
git -C ../populus-data commit -m "data: rollback pointer to older build"
git -C ../populus-data push
```

## 6. File the incident issue

Record the target build, the reason, and the pointer versions involved.

---

## Appendix A — abandoned-draft cleanup (operator-only, drafts-only)

Automatic recovery **completes** an in-flight draft; it never deletes one. If
an operator decides a pre-armed draft must be discarded instead (e.g. an
acceptance-test leftover no consumer has ever seen), confirm it is a draft
first — `delete_release` semantics are drafts-only; published releases are
immutable:

```bash
gh release view data-20260722.9 --repo johnbaekk-spec/populus-data --json isDraft
gh release delete data-20260722.9 --repo johnbaekk-spec/populus-data --yes
rm -rf ../populus-data/.staging/20260722.9
```

While any durable trace remains (a committed `builds/<id>/`, a published tag,
or a `.staging/<id>/` directory), `next_build_id` never reuses the id. Once
every trace is removed the id may be reallocated — safe, because nothing
durable ever referenced it.

## Appendix B — monitor state loss (§13.5)

The monitor **fails closed** when its tuple is missing or corrupt. Restore the
tuple from the mini's backup, or pin a trusted floor from the last known-good
publish log — **never delete the tuple to clear an alarm**.

The trust tuple is `(pointer_version, pointer_sha256)`, and `pointer_sha256`
**must be the SHA-256 of the exact `latest.json` bytes at that version** — the
same bytes the monitor fetches. A placeholder like `"0" * 64` is *not* safe: if
the restored version equals the live pointer version, the next poll sees the
real digest, reports **equivocation**, and refuses to recover. Derive the
digest from the verified pointer bytes rather than typing one in:

```bash
python3 - <<'EOF'
import json, pathlib, sys
from hashlib import sha256
sys.path.insert(0, "src")
from populus.publish.pointer import persist_tuple, validate_pointer
# Point at the verified pointer bytes for the floor you are pinning: the current
# authoritative latest.json from a fresh populus-data checkout, or the archived
# latest.json for the exact version recorded in the last known-good publish log.
pointer_bytes = pathlib.Path("../populus-data/latest.json").read_bytes()
pointer = json.loads(pointer_bytes)
assert validate_pointer(pointer) == [], "refusing to pin a floor from an invalid pointer"
persist_tuple(
    "/var/populus-monitor/pointer-tuple.json",
    pointer["pointer_version"],
    sha256(pointer_bytes).hexdigest(),  # the VERIFIED digest, never a placeholder
)
EOF
python3 scripts/monitor.py --attestation=sigstore \
  --state-dir /var/populus-monitor --repo johnbaekk-spec/populus-data
```
