# Runbook — self-hosted publish runner (RUN M2-11, R7/R8)

Every step below is **owner-only** unless marked otherwise: account creation,
ACL grants, credential placement, launchd loading, pmset, and teardown all
require the owner's admin session. The runner account itself is never given
admin, keychain access, or write access to the data stores.

This runbook covers what committed code cannot: it **invokes** the committed
controller (`ops/runner/runner-controller.sh`, tested by
`tests/test_runner_controller.py`) — it never re-describes its logic. If a
command here and the controller disagree, the controller is right and this
document has a bug.

Canonical layout used throughout (substitute nothing — this IS the layout the
committed plist expects):

```
/usr/local/populus-runner/
  controller/                      # owner/controller domain — runner CANNOT read
    runner-controller.sh           # installed copy of ops/runner/runner-controller.sh
    runner-image.tar.gz            # pristine runner image (see step 4)
    registration.credential        # fine-grained PAT the controller mints
                                   # per-cycle registration tokens from
    toolchain.manifest             # sha256 manifest gating every registration
    exported-logs/                 # per-job diagnostics, preserved across wipes
    logs/                          # launchd stdout/stderr
  roots/                           # RUNNER_BASE_DIR
    active/                        # RUNNER_ROOT — rebuilt every job
```

Data stores (already existing, owner home):

```
~/projects/Populus-ops/populus-m28.db      # canonical audit store (+ -wal/-shm)
~/projects/Populus-ops/snapshots/          # accepted snapshots inst-source-v<N>.db
```

---

## 0. Which machine, and is it provisioned? (read before anything else)

The runner host is **the machine that holds the canonical audit store and the
accepted snapshots** (the paths above). That is what pins the publish job to
this Mac — the snapshot is far too large to ship to a hosted runner — so the
install below happens *there*, not on whichever machine you happen to be
reading this from.

Three facts, learned operationally on 2026-08-13, that this section exists to
make cheap to re-discover:

* **A dispatch against an unregistered label queues silently for up to 24
  hours.** GitHub accepts `workflow_dispatch`, creates the run, and parks the
  `publish` job as `queued` with no immediate error; only after ~24 hours
  does it fail the job for never starting. A run that seems to hang has
  usually not started — check the job's own status, not the run's.
* **A green run is not proof anything published — under any graph.** A
  skipped job reports status "Success" (GitHub's documented job-condition
  behavior), so when `publish`'s `if:` guard evaluates false (wrong branch,
  `POPULUS_PUBLISH_ARMED` unset, unvalidated nightly) the whole chain —
  `publish`, `deploy`, `sign`, `assert-signed` — skips and the RUN concludes
  green. What the current graph does forbid is downstream jobs *running*
  without a successful publish; it cannot make a no-op run look red. Older
  runs additionally obey whatever graph they ran under: the dispatch of
  2026-08-12 07:16 (workflow at `76565a5`) concluded `success` while its job
  list contains no `publish` and no `deploy` job at all — only
  verification/signing jobs on hosted runners. So: read a run's **job list**,
  never its conclusion — a publish that published has a succeeded `publish`
  job on `self-hosted,macOS,populus-ops` in it.
* **Committed code ≠ provisioned machine.** The controller, its plist, and
  this runbook shipping in the repo says nothing about any machine having run
  steps 1–7.

Preflight — run on the intended host. The `ls`/`dscl` checks report absence
through their ordinary error output; the `gh` check prints what to look for:

```bash
# Is THIS the machine that holds the stores? (both must exist)
ls ~/projects/Populus-ops/populus-m28.db ~/projects/Populus-ops/snapshots/

# Is a runner with the REQUIRED LABELS registered, and is it online? A bare
# total_count cannot answer this: it counts every runner regardless of labels
# or connectivity. Expect one line, ending "online". No output = not
# registered (install below); "offline" = registered but the controller is
# not cycling (step 5).
gh api repos/johnbaekk-spec/populus/actions/runners   --jq '.runners[] | select(([.labels[].name] | contains(["self-hosted","macOS","populus-ops"])) ) | "\(.name)\t\(.status)"'

# Steps 1/3/5 present on this machine?
dscl . -read /Users/populusrunner UniqueID 2>/dev/null || echo "step 1 NOT done (no runner account)"
ls -d /usr/local/populus-runner/controller 2>/dev/null || echo "steps 3-4 NOT done (no controller install)"
ls /Library/LaunchDaemons/com.populus.runner-controller.plist 2>/dev/null || echo "step 5 NOT done (no launchd daemon)"
ls /usr/local/populus-toolchain/bin 2>/dev/null || echo "toolchain NOT provisioned (step 4 prerequisite)"
```

If every check reports NOT done, this is a fresh install: proceed with
steps 1–7 in order. If the labeled-runner check prints nothing (or
"offline") but the machine-side pieces exist, the ephemeral registration has
lapsed and the controller is not cycling — start at step 5's "confirm it is
running" tail, not at step 1.

---

## 1. Create the dedicated non-admin runner account (owner-only)

```bash
# Create a standard (NON-admin) account with its own home. sysadminctl prompts
# for an interactive password; give it a long random one and never use it —
# the controller launches the runner, nobody logs in as it.
sudo sysadminctl -addUser populusrunner \
  -fullName "Populus Publish Runner" \
  -home /Users/populusrunner \
  -shell /bin/bash \
  -password -

# Verify it is NOT in the admin group (empty output = correct):
dscl . -read /Groups/admin GroupMembership | tr ' ' '\n' | grep -x populusrunner || echo "OK: not admin"

# Record the uid — the controller's RUNNER_UID (needed in step 5):
dscl . -read /Users/populusrunner UniqueID
```

## 2. ACL read-only grant on the store and snapshots (owner-only)

The runner account gets **read-only** access to the canonical store and the
snapshots directory, and nothing else in the owner's home. macOS ACLs grant
without loosening the POSIX bits.

```bash
# Traverse-only on the path components (execute/search, no read of listings
# beyond what traversal needs):
chmod +a "populusrunner allow execute" ~/projects
chmod +a "populusrunner allow execute" ~/projects/Populus-ops

# Read-only on the canonical store family. deny write,delete,append is
# explicit and FIRST-MATCH: even a bug that opens read-write is refused by
# the OS, which is the enforcement layer behind mode=ro (plan R2).
for f in ~/projects/Populus-ops/populus-m28.db \
         ~/projects/Populus-ops/populus-m28.db-wal \
         ~/projects/Populus-ops/populus-m28.db-shm; do
  [ -e "$f" ] && chmod +a "populusrunner deny write,delete,append,writeattr,writeextattr" "$f"
  [ -e "$f" ] && chmod +a "populusrunner allow read" "$f"
done

# Snapshots directory: list + read files, no writes.
chmod +a "populusrunner allow list,search,readattr" ~/projects/Populus-ops/snapshots
chmod +a "populusrunner deny add_file,add_subdirectory,delete,delete_child" ~/projects/Populus-ops/snapshots
find ~/projects/Populus-ops/snapshots -type f -name 'inst-source-v*.db' \
  -exec chmod +a "populusrunner allow read" {} \; \
  -exec chmod +a "populusrunner deny write,delete,append" {} \;

# Verify the grant (both lines must appear in the ACL listing):
ls -le ~/projects/Populus-ops/populus-m28.db

# Verify enforcement — this MUST fail with Permission denied:
sudo -u populusrunner sh -c 'echo x >> ~johnbaek/projects/Populus-ops/populus-m28.db' \
  && echo "FAIL: runner can write the canonical store — STOP" \
  || echo "OK: write refused"
```

## 3. Install the controller (owner-only)

```bash
# Controller domain: root-owned, mode 700 — the runner account cannot read
# the credential, the image, or the controller itself (plan R7b).
sudo mkdir -p /usr/local/populus-runner/controller/{exported-logs,logs}
sudo mkdir -p /usr/local/populus-runner/roots/active
sudo cp "$(git rev-parse --show-toplevel)/ops/runner/runner-controller.sh" \
  /usr/local/populus-runner/controller/runner-controller.sh
sudo chmod 755 /usr/local/populus-runner/controller/runner-controller.sh
sudo chown -R root:wheel /usr/local/populus-runner/controller
sudo chmod 700 /usr/local/populus-runner/controller

# F4 ownership boundary — three domains, never blurred:
#   /usr/local/populus-runner            root-owned, 755 (nothing runner-writable)
#   /usr/local/populus-runner/controller root-owned, 700 (credential, image, state)
#   /usr/local/populus-runner/roots      root-owned, 755; ONLY the per-cycle
#                                        ACTIVE root inside it is chowned to the
#                                        runner account BY THE CONTROLLER during
#                                        restore-image — never chown -R the
#                                        parent: the runner must not own the
#                                        directory that contains the controller's
#                                        proof state or its siblings.
sudo mkdir -p /usr/local/populus-runner/controller/state
sudo chmod 700 /usr/local/populus-runner/controller/state
# CONTROLLER_STATE_DIR (cleanup-verified marker + lock) lives HERE — the runner
# account cannot write it, so the registration proof is unforgeable.
RUNNER_UID=$(dscl . -read /Users/populusrunner UniqueID | awk '{print $2}')
```

The controller does not take this layout on trust. `restore-image` performs the
active-root chown itself (`chown -Rh $RUNNER_UID $RUNNER_ROOT`, and nothing
above it), and **every registration re-asserts the boundary in both
directions** before the cleanup-verified marker is consumed:

| Observed | Refusal |
| --- | --- |
| `RUNNER_ROOT` not owned by `RUNNER_UID` | `active-root-not-runner-owned` |
| `RUNNER_BASE_DIR` owned by `RUNNER_UID` | `base-dir-runner-owned` |
| `CONTROLLER_STATE_DIR` owned by `RUNNER_UID` | `state-dir-runner-owned` |

The first is the failure a fresh install hits if the chown is skipped: the
runner account cannot write its own `_work`, `HOME`, or `TMPDIR`, and the job
fails on permissions rather than announcing why. The other two are the
privilege-escalation directions — a runner-owned parent can replace the root or
the image; a runner-owned state directory makes the registration proof
forgeable.

### Credential placement (owner-only — controller domain, never the runner's)

The credential is a **fine-grained PAT**, NOT a raw registration token —
GitHub registration tokens expire after ~1 hour, which cannot drive an
always-on loop. The controller mints a fresh registration token from this
PAT every cycle via `POST /repos/{owner}/{repo}/actions/runners/
registration-token` (one retry on 401; a persistent 401 refuses with
`registration-token-denied`, meaning the PAT is dead or under-scoped).

Mint the PAT at GitHub → Settings → Developer settings → Fine-grained
tokens, scoped to **only** the `johnbaekk-spec/populus` repository with the
repository **"Administration: Read and write"** permission and nothing
else. That is the permission the repository registration-token endpoint
(`POST /repos/{owner}/{repo}/actions/runners/registration-token`) requires
for fine-grained tokens (GitHub REST docs, "Create a registration token
for a repository"). Do **not** grant the org-level "Self-hosted runners"
permission instead: that permission governs the *organization* runner
endpoints (`/orgs/{org}/actions/runners/...`) and does not authorize the
repository endpoint this controller calls — a PAT carrying only it refuses
with `registration-token-denied`.

Blast radius, stated honestly: repository Administration write is
**repo-admin authority** — it can alter settings, collaborators, branch
protections, and webhooks on `populus`, not just runners. Mitigations are
scope (this single repository, no org-level grants), placement (root-owned
0600 controller-domain file the runner account cannot read; the PAT never
reaches the runner environment, the root, or curl's argv), and rotation:
set a short expiry (90 days or less), calendar the rotation, and revoke
immediately on any compromise signal (step 9).

Place it by pasting into a root-owned file — it must never transit the runner
account, the repo checkout, or a shell history line with the value inline:

```bash
sudo sh -c 'umask 077; cat > /usr/local/populus-runner/controller/registration.credential'
# paste the PAT, then Ctrl-D
sudo chmod 600 /usr/local/populus-runner/controller/registration.credential
```

## 4. Provision the pristine runner image (owner-only)

The image is the runner installation the controller unpacks into every fresh
root. Build it once, from the official runner release, in a scratch directory:

```bash
cd "$(mktemp -d)"
# Recheck the official latest release immediately before provisioning. GitHub
# stops assigning jobs to runners that fall outside its update window, so a
# stale bootstrap is a hard stop rather than a warning.
RUNNER_VERSION=2.336.0
RUNNER_ARCHIVE=actions-runner-osx-arm64-2.336.0.tar.gz
RUNNER_SHA256=8e8839c49b7060b6b2154f4931f815df330c27f167d53ef2239ee3dfce28b079
test "$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest |
  jq -r .tag_name)" = "v${RUNNER_VERSION}"
curl -fLO "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${RUNNER_ARCHIVE}"
printf '%s  %s\n' "$RUNNER_SHA256" "$RUNNER_ARCHIVE" | shasum -a 256 -c -
mkdir image && tar -xzf "$RUNNER_ARCHIVE" -C image
test "$(image/bin/Runner.Listener --version)" = "$RUNNER_VERSION"
tar -czf runner-image.tar.gz -C image .
sudo mv runner-image.tar.gz /usr/local/populus-runner/controller/runner-image.tar.gz
sudo chown root:wheel /usr/local/populus-runner/controller/runner-image.tar.gz
sudo chmod 600 /usr/local/populus-runner/controller/runner-image.tar.gz
```

The toolchain (uv, node) is installed separately, root-owned and read-only,
outside the runner root — it survives reconstruction and is checksummed at
job start (plan R7c/TD-3).

### Toolchain manifest provisioning (owner-only — the R7c checksum gate)

The controller REFUSES every registration unless
`CONTROLLER_TOOLCHAIN_MANIFEST` names a manifest whose every entry
(`sha256  absolute-path` per line, `#` comments allowed) exists, is owned by
root or the controller user, is not group/other-writable, and hash-matches.
There is no skip path: a missing manifest is `toolchain-manifest-missing`, a
tampered tool `toolchain-hash-mismatch` naming the file. The manifest must
also validate a **nonzero** number of entries (`toolchain-manifest-empty`
otherwise — a comment-only file gates nothing), list no path twice
(`toolchain-duplicate-entry`), and carry an entry for every tool named in
`REQUIRED_TOOLCHAIN_TOOLS` (default `uv node`;
`toolchain-required-tool-missing` names the absentee). Generate it after
installing (or upgrading) the toolchain, and regenerate on every upgrade:

```bash
sudo sh -c 'umask 077; shasum -a 256 \
  /usr/local/populus-toolchain/bin/uv \
  /usr/local/populus-toolchain/bin/node \
  > /usr/local/populus-runner/controller/toolchain.manifest'
sudo chown root:wheel /usr/local/populus-runner/controller/toolchain.manifest
sudo chmod 600 /usr/local/populus-runner/controller/toolchain.manifest
# Verify the gate passes before relying on launchd to discover a typo:
sudo env RUNNER_BASE_DIR=/usr/local/populus-runner/roots \
  RUNNER_ROOT=/usr/local/populus-runner/roots/active \
  RUNNER_USER=populusrunner RUNNER_UID="$(dscl . -read /Users/populusrunner UniqueID | awk '{print $2}')" \
  CONTROLLER_STATE_DIR=/usr/local/populus-runner/controller/state \
  CONTROLLER_TOOLCHAIN_MANIFEST=/usr/local/populus-runner/controller/toolchain.manifest \
  /usr/local/populus-runner/controller/runner-controller.sh register \
  ; true
```

Read the outcome by its refusal NAME, not by the exit code — this preflight is
*expected* to refuse. Any `toolchain-*` name is a real manifest defect and the
thing this step exists to surface. A later name means the manifest and the PATH
binding both passed and the run stopped on a guard this preflight does not
satisfy: `active-root-not-runner-owned` before the first cycle has ever run (no
root has been restored yet), or `cleanup-not-verified` after one.

(Adjust the listed paths to wherever the toolchain actually lives; list every
binary a job invokes.)

**The `uv` you install here must be the version `publish.yml` pins — `0.7.13`
today.** The workflow no longer installs uv on this machine: macOS Pythons are
PEP 668 externally-managed, so `python3 -m pip install` there fails rather than
installing, and reinstalling over the gated copy would defeat the checksum in
any case. The publish job therefore USES the uv this manifest gates, and
asserts `uv --version` against its pin — a drifted toolchain fails the job on
its first step with a message pointing back at this section. The fix is to
re-provision the binary and regenerate the manifest, never to edit the pin down
to whatever the machine has:

```bash
/usr/local/populus-toolchain/bin/uv --version   # must equal publish.yml's UV_PIN
grep -n 'UV_PIN' "$(git rev-parse --show-toplevel)/.github/workflows/publish.yml"
```

### The runner PATH is derived from the manifest, not hardcoded

A checksum gate over binaries the job never executes proves nothing. The
controller therefore builds the runner's `PATH` from the **directories of the
validated manifest entries** (deduped, manifest order, prepended ahead of
`/usr/bin:/bin:/usr/sbin:/sbin`), and then re-resolves every tool named in
`REQUIRED_TOOLCHAIN_TOOLS` under that `PATH`, demanding the manifest's own
absolute path back. A mismatch refuses `toolchain-path-unbound`, naming the
tool, what actually resolved, and what the manifest gates.

Two consequences for provisioning:

* Listing a tool in the manifest is what puts its directory on the runner's
  `PATH`. There is no separate `PATH` to maintain, and no way for the gate and
  the job to disagree about which `uv` is in play.
* **A manifest directory must contain nothing you have not listed.** An
  unlisted binary sitting beside a listed one shadows the checksummed copy for
  any earlier directory on the path, and the controller refuses the cycle
  rather than running it. Keep `/usr/local/populus-toolchain/bin` to exactly
  the gated set.

## 5. Load the controller (owner-only)

```bash
# Fill the install-time values (RUNNER_UID and RUNNER_USER) into a copy of
# the committed plist, then load it into the SYSTEM domain. The plist pins
# UserName=root: the CONTROLLER runs as root (it must terminate runner-UID
# processes, rebuild the root, and read the credential), but every
# runner-owned operation (config.sh, run.sh) is executed via
# `sudo -u $RUNNER_USER` — the controller refuses if RUNNER_USER is unset or
# equals its own user, so runner code never carries root authority.
# ORDER MATTERS: the -USERNAME token must be replaced before its prefix.
RUNNER_UID=$(dscl . -read /Users/populusrunner UniqueID | awk '{print $2}')
sed -e "s/REPLACED-AT-INSTALL-USERNAME/populusrunner/" \
    -e "s/REPLACED-AT-INSTALL/${RUNNER_UID}/" \
  "$(git rev-parse --show-toplevel)/ops/runner/com.populus.runner-controller.plist" \
  | sudo tee /Library/LaunchDaemons/com.populus.runner-controller.plist > /dev/null
sudo chown root:wheel /Library/LaunchDaemons/com.populus.runner-controller.plist
sudo chmod 644 /Library/LaunchDaemons/com.populus.runner-controller.plist
sudo launchctl load -w /Library/LaunchDaemons/com.populus.runner-controller.plist

# Confirm it is running and watch the first cycle:
sudo launchctl list | grep com.populus.runner-controller
tail -f /usr/local/populus-runner/controller/logs/controller.err.log
```

## 6. Always-on power configuration (OD-1, owner-only)

```bash
# The nightly runs at 06:17 UTC; the machine must never be asleep for it.
sudo pmset -a sleep 0 disksleep 0 displaysleep 10
sudo pmset -a autorestart 1     # power-loss recovery
pmset -g                        # verify: sleep 0, autorestart 1
```

## 7. Arm the repository variables (owner-only)

Two repository **variables** (not secrets — `vars.`, and the workflow reads
them that way for the reason recorded in `.github/workflows/publish.yml`: a
variable read through `secrets.` resolves to the empty string with no error at
all). Neither is set by any script here; both are owner actions, and their
ORDER is the R25 supervision rule.

```bash
# 1. The accepted snapshot the publish job derives the institutional module
#    from. It is the FINALIZED file cut by scripts/inst_snapshot.py in step 2's
#    snapshots directory — never the canonical store, never a -wal sibling.
#    UNSET is a supported state: with no value the publish job omits the flag
#    entirely and builds congress-only, byte-identical to a pre-M2-11 build.
#    That is also the rollback: unset it, and the next run publishes congress.
gh variable set POPULUS_INST_DB --repo johnbaekk-spec/populus \
  --body "/Users/johnbaek/projects/Populus-ops/snapshots/inst-source-v1.db"

# Verify what is actually armed (POPULUS_PUBLISH_ARMED is the pre-existing
# publish switch and is independent of both of these):
gh variable list --repo johnbaekk-spec/populus
```

The second variable is deliberately in a **separate block below**, not in the
one above: pasted together, "set this one later" is one keystroke from being
untrue. Do not run it until the supervised dispatch has been watched end to
end (plan T11): runner-root reconstruction observed, toolchain gate passed,
attestation verified, snapshot identity corroborated against the canonical
store's hash. Scheduled runs require it; `workflow_dispatch` is EXEMPT, which
is exactly what makes that supervised run possible. Setting it early arms an
unattended 06:17 UTC nightly against a runner nobody has ever watched.

```bash
# ONLY after the supervised dispatch above has succeeded and been inspected:
gh variable set POPULUS_SELFHOSTED_VALIDATED --repo johnbaekk-spec/populus --body true
```

The publish job's `if:` is the enforcement, not this document: it requires the
default branch, `POPULUS_PUBLISH_ARMED`, and — for `schedule` runs only —
`POPULUS_SELFHOSTED_VALIDATED`. `tests/test_publish.py` pins that condition, so
a rewrite that quietly drops the schedule clause fails the suite.

## 8. Per-job lifecycle (what the controller does — reference, not steps)

Each launchd invocation is ONE cycle of
`runner-controller.sh run-cycle`, whose subcommands are the contract
(behaviorally tested in `tests/test_runner_controller.py`):

1. `destroy-root` — terminate residual runner-UID processes and **verify by
   `pgrep -u` that none survive** (survivors refuse destruction, named by
   PID) → export `_diag`/`logs` to `controller/exported-logs/<timestamp>/`
   and **verify every copied file's byte count before the wipe may run** (an
   export failure refuses the wipe; the root survives) → wipe the entire
   root → **verify empty** → write the cleanup-verified marker.
2. `restore-image` — unpack the pristine image into the fresh root, create a
   fresh per-job `TMPDIR` and `HOME` inside it.
3. `register` — verify the toolchain manifest (step 4) → **mint a fresh
   registration token from the PAT** (controller domain; never exported,
   never written under the root) → ephemeral (`--ephemeral`) registration
   run **as `RUNNER_USER` via `sudo -u`**; refuses unless the
   cleanup-verified marker exists, and consumes it.
4. wait — the ephemeral runner (also run as `RUNNER_USER`) exits after one
   job; the controller exits; launchd KeepAlive re-invokes, landing back at
   `destroy-root`.

Nothing in this section is a step the owner runs by hand; to exercise a phase
manually, invoke the installed controller with the same subcommands.

## 9. Suspicion event — same-UID persistence sweep (owner-only)

Whole-root reconstruction does NOT close every same-UID surface (plan TD-4,
accepted). On any suspicion, sweep the surfaces reconstruction cannot reach:

```bash
# Anything the runner UID left registered with launchd:
sudo launchctl asuser "$(dscl . -read /Users/populusrunner UniqueID | awk '{print $2}')" \
  launchctl list

# User-level launch agents and daemons planted in its home:
sudo ls -la /Users/populusrunner/Library/LaunchAgents/ 2>/dev/null
sudo find /Users/populusrunner -newer /usr/local/populus-runner/controller/runner-image.tar.gz \
  -not -path '*/Caches/*' -type f 2>/dev/null

# Scheduled jobs under its identity:
sudo crontab -u populusrunner -l 2>/dev/null || echo "no crontab (expected)"
sudo launchctl print gui/$(dscl . -read /Users/populusrunner UniqueID | awk '{print $2}') 2>/dev/null | head -50

# UID-writable droppings outside the root and home:
sudo find /tmp /var/tmp /usr/local -user populusrunner -print 2>/dev/null
```

Anything found is evidence, not cleanup — copy it into
`controller/exported-logs/` first, then remove it, then **rotate the PAT**
(below) and treat the last job's outputs as untrusted.

### Token rotation (owner-only)

```bash
# 1. Revoke and re-mint DATA_REPO_PAT (GitHub → Settings → Developer settings
#    → Fine-grained tokens), then update the repo secret:
gh secret set DATA_REPO_PAT --repo johnbaekk-spec/populus

# 2. Rotate the registration PAT the same way (revoke, re-mint fine-grained
#    with repository Administration: Read and write, step 3 placement), then force
#    the registration off and on: remove the runner in the repo's Runners UI
#    (or let the ephemeral registration lapse) and restart the controller —
#    it mints a fresh registration token from the new PAT on the next cycle:
sudo launchctl kickstart -k system/com.populus.runner-controller
```

## 10. Complete teardown (owner-only)

Order matters: disarm the schedule first, then the machine.

```bash
# 1. Disarm scheduled self-hosted runs (repo variable; dispatch stays exempt):
gh variable delete POPULUS_SELFHOSTED_VALIDATED --repo johnbaekk-spec/populus
#    ...and unset the snapshot path, or a run that falls back to a hosted
#    runner would pass --inst-db pointing at a file only this Mac ever had.
#    Unset means congress-only, which is the correct state once the machine is
#    gone (step 7).
gh variable delete POPULUS_INST_DB --repo johnbaekk-spec/populus

# 2. Stop and unload the controller:
sudo launchctl unload -w /Library/LaunchDaemons/com.populus.runner-controller.plist
sudo rm /Library/LaunchDaemons/com.populus.runner-controller.plist

# 3. Remove the runner registration (repo → Settings → Actions → Runners →
#    remove), then destroy the machine-side state — logs are preserved OUTSIDE
#    the deleted tree first:
sudo cp -R /usr/local/populus-runner/controller/exported-logs ~/populus-runner-final-logs
sudo rm -rf /usr/local/populus-runner

# 4. Run the persistence sweep (step 9) BEFORE deleting the account, then:
sudo sysadminctl -deleteUser populusrunner

# 5. Remove the ACL grants (repeat per file/dir that received one; the ACL
#    entries name the now-deleted user and are inert, but leave no debris):
chmod -a# 0 ~/projects/Populus-ops/populus-m28.db   # inspect ls -le first; -a# removes by index
ls -le ~/projects/Populus-ops/populus-m28.db          # verify: no populusrunner entries

# 6. Rotate DATA_REPO_PAT (step 9) — teardown assumes nothing about why.
```
