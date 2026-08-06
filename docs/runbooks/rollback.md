# Runbook — rollback (ARCHITECTURE.md §13.5, P1 staging variant)

The only supported rollback is a **new, higher pointer generation targeting an
older `build_id`** — never a bare rewrite of `latest.json` to old bytes (every
post-P2 client rejects that as replay). The P1 staging variant below runs the
identical sequence minus attestation. Execute the steps **in order**; every
command line is executable as written from the `populus` repo root.

**From P3 on the pointer is only half of it.** §13.5 makes "restore the dashboard
to the rollback target deterministically" part of this same procedure, because a
rollback that fixes MCP clients while `publicfilings.org` keeps serving the
rejected build is **half a rollback** — and the §13.2 any-direction divergence
alarm pages exactly that state. Step 6 is that half; skipping it leaves the
system in the condition the alarm exists to detect.

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

## 6. Restore the dashboard to the same target (§13.5, P3 on)

The pointer now names the older build; the live site still serves the newer one.
Restore it deterministically — **never "rebuild from the current checkout"**,
which does not reproduce the target if application code caused the incident.

### 6a. Read the target build's latest deployment generation

Generations are append-only per build (`<gen>` is a monotonic integer); the
**highest** one is current:

```bash
export TARGET_BUILD=20260722.1
export GEN_DIR="../populus-data/builds/$TARGET_BUILD/deployments"
ls "$GEN_DIR"
GEN_FILE="$GEN_DIR/$(ls "$GEN_DIR" | sort -V | tail -1)"
cat "$GEN_FILE"
```

### 6b. Attestation-verify it before trusting one field of it

The generation is signed by the **record signer**, a different workflow identity
from the publisher, and it is attested under the explicit subject name
`deployments/<gen>.json` (see [`attestation.md`](attestation.md)). An unattested
or wrong-identity generation is **not** a rollback target — stop and treat it as
an incident of its own:

```bash
gh attestation verify "$GEN_FILE" \
  --repo johnbaekk-spec/populus \
  --signer-workflow johnbaekk-spec/populus/.github/workflows/record-sign.yml \
  --cert-oidc-issuer https://token.actions.githubusercontent.com \
  --predicate-type https://slsa.dev/provenance/v1
```

Then pull the three fields the rest of this step branches on:

```bash
eval "$(python3 - "$GEN_FILE" <<'EOF'
import json, sys
record = json.load(open(sys.argv[1]))
for key in ("cf_production_deployment_id", "dist_digest", "code_sha",
            "workflow_run_id", "dist_artifact_expires_at"):
    print(f'export {key.upper()}="{record[key]}"')
EOF
)"
```

### 6c. Path A — the recorded deployment still exists in Cloudflare (preferred)

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $CLOUDFLARE_PAGES_READ_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/publicfilings/deployments/$CF_PRODUCTION_DEPLOYMENT_ID"
```

On `200`, roll production straight back to it. This is an explicit API operation —
nothing about it happens automatically. It is the **only** step in this runbook
that needs the `Pages:Edit` token (`CLOUDFLARE_API_TOKEN` in the workflow's
naming); export it for this command and unset it afterwards:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/publicfilings/deployments/$CF_PRODUCTION_DEPLOYMENT_ID/rollback"
unset CLOUDFLARE_API_TOKEN
```

On `404`/`410`, that deployment is gone — go to Path B.

### 6d. Path B — recover the exact bytes from the retained artifact

Available while now is before the generation's `dist_artifact_expires_at`. Download
the artifact the recorded run produced, then **assert it recomputes to the recorded
`dist_digest` before deploying anything**:

```bash
gh run download "$WORKFLOW_RUN_ID" \
  --repo johnbaekk-spec/populus \
  --dir /tmp/populus-rollback-dist
uv run python - <<'EOF'
import os, sys
from populus.publish.digests import dist_digest
recomputed = dist_digest("/tmp/populus-rollback-dist/site")
expected = os.environ["DIST_DIGEST"]
if recomputed != expected:
    sys.exit(f"REFUSING: recomputed {recomputed} != recorded {expected}")
print("dist_digest matches the attested generation:", recomputed)
EOF
```

Then re-deploy those exact bytes **through the §12.1 protocol** — preview upload,
inventory-wide preview verification, production upload of the same bytes, live
verification — not by hand-uploading them.

### 6e. Path C — the artifact has aged out

Rebuild from the recorded `code_sha` (never from the current checkout), assert the
rebuilt tree matches `dist_digest`, and deploy that:

```bash
git -C . fetch --all --quiet
git -C . checkout --detach "$CODE_SHA"
echo "rebuild the site from this checkout with the pinned toolchain, then:"
uv run python - <<'EOF'
import os, sys
from populus.publish.digests import dist_digest
recomputed = dist_digest("dashboard/dist")
expected = os.environ["DIST_DIGEST"]
if recomputed != expected:
    sys.exit(f"REFUSING: rebuild {recomputed} != recorded {expected}")
print("rebuild reproduces the attested tree")
EOF
```

A mismatch here is **information, not an obstacle to route around**: the recorded
toolchain has drifted (§18.1 item 9). Deploying a tree that does not match the
attested digest would make the rollback unverifiable.

### 6f. Live-verify the domain, in every path

```bash
curl -sS "https://publicfilings.org/?cachebust=$(date +%s)" \
  | grep -o '<meta name="populus:[a-z_]*" content="[^"]*"'
```

Both markers must match the **target** build: `populus:build_id` equal to
`$TARGET_BUILD` and `populus:code_sha` equal to the generation's `code_sha`,
compared exactly — never by substring containment.

### 6g. The rollback deployment is itself recorded

Any re-deploy of an existing build writes a **new appended generation** (Paths B
and C go through the deploy protocol, so the signer runs; a Path A provider-side
rollback still needs a generation recorded for the deployment now serving).
Records are never overwritten — the original attestation stays intact, and the
§13.2 monitor requires a valid attested generation for whatever the live build is.

## 7. File the incident issue

Record the target build, the reason, the pointer versions involved, **which of
Paths A/B/C restored the dashboard**, and the new generation number.

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
