#!/bin/bash
# Per-job lifecycle controller for the self-hosted publish runner (RUN M2-11 R7c/R7d).
#
# The one-job-clean guarantee is a MECHANISM, not a wish: before every
# registration this controller destroys the previous ENTIRE writable runner
# root — runner installation, credentials, _work, HOME, caches, the per-job
# TMPDIR — after terminating residual runner-UID processes (and VERIFYING none
# survive) and copying logs to the owner domain (and VERIFYING the copies
# before the wipe may destroy the originals), then restores a pristine image
# the controller owns. What reconstruction cannot close (same-UID persistence
# outside the root) is accepted debt, enumerated in the plan's TD-4 — this
# script never claims it.
#
# Subcommands:
#   destroy-root   terminate+verify-no-survivors → export-logs+verify-export →
#                  wipe → verify-empty (writes the cleanup-verified marker only
#                  after verification passes)
#   restore-image  unpack the pristine image tarball into a fresh root, plus a
#                  fresh per-job TMPDIR and HOME
#   register       ephemeral (--ephemeral) registration; REFUSES unless the
#                  cleanup-verified marker from a preceding destroy-root exists,
#                  and consumes it (one registration per verified cleanup).
#                  Gated by the toolchain checksum manifest (R7c) and executed
#                  AS THE RUNNER USER via sudo -u (never with controller
#                  authority). The registration token is MINTED per cycle from
#                  the PAT in the credential file — see SECURITY below.
#   run-cycle      one full cycle: destroy-root → restore-image → register →
#                  wait for the runner process to exit. launchd KeepAlive
#                  re-invokes us, so one-cycle-per-invocation IS the loop —
#                  a crash anywhere lands back at destroy-root, never at a
#                  half-clean registration.
#
# Configuration (environment; the plist sets these):
#   RUNNER_BASE_DIR              dedicated base directory; every destructive
#                                operation is confined under it
#   RUNNER_ROOT                  the writable runner root — MUST be a direct
#                                child of RUNNER_BASE_DIR (allowlist pattern)
#   RUNNER_UID                   uid whose residual processes are terminated
#   RUNNER_USER                  account name the runner executes as; config.sh
#                                and run.sh run via `sudo -u $RUNNER_USER`.
#                                REFUSED if unset or equal to the controller's
#                                own user — runner operations must NEVER carry
#                                controller/root authority (F8)
#   RUNNER_IMAGE_TARBALL         controller-owned pristine image (.tar.gz)
#   RUNNER_REPO_URL              https://github.com/<owner>/<repo>
#   CONTROLLER_LOG_EXPORT_DIR    owner-domain directory receiving exported logs
#   CONTROLLER_CREDENTIAL_FILE   controller-domain file holding a fine-grained
#                                PAT (self-hosted-runners scope) — see SECURITY
#   CONTROLLER_TOOLCHAIN_MANIFEST
#                                controller-owned manifest gating registration:
#                                one `sha256  absolute-path` per line; every
#                                listed file must exist, be owned by root or
#                                the controller user, be non-writable by the
#                                runner user, and hash-match — else refuse (F9).
#                                Must validate a NONZERO number of entries, no
#                                duplicate paths, and carry an entry for every
#                                required tool (F6)
#   REQUIRED_TOOLCHAIN_TOOLS     space-separated basenames the manifest MUST
#                                list (default: "uv node"); a manifest missing
#                                one refuses toolchain-required-tool-missing
#   GITHUB_API_URL               optional API base (default https://api.github.com)
#   CONTROLLER_STATE_DIR         controller-domain directory holding the
#                                cleanup-verified marker and the lock (F4:
#                                REQUIRED; must NOT be under RUNNER_BASE_DIR
#                                and must not be runner-writable — the marker
#                                is the unforgeable registration proof, so it
#                                lives where the runner account cannot write)
#   CONTROLLER_LOCK_DIR          mkdir-style concurrency lock (default:
#                                CONTROLLER_STATE_DIR/.controller.lock). It
#                                records its owning "<boot-epoch> <pid>" in an
#                                `owner` file; a lock whose owner is provably
#                                dead is reclaimed rather than honoured (R2).
#   CONTROLLER_OP_LOG            optional: append one operation name per line
#                                (the behavioral tests' ordering instrument)
#   CONTROLLER_ENV_DUMP          optional (DRY_RUN only): write the constructed
#                                runner environment here so tests can prove the
#                                credential never reaches it
#   DRY_RUN                      when "1": no process termination, no network
#                                token mint, no GitHub registration, no runner
#                                execution. The tests set this; the REAL
#                                registration path is the block marked
#                                "REAL PATH" in cmd_register.
#
# SECURITY — credential and registration-token flow (F10):
#   GitHub registration tokens expire after ~1 hour, so a static token cannot
#   drive an always-on loop. CONTROLLER_CREDENTIAL_FILE therefore holds a
#   long-lived fine-grained PAT; each cycle the controller MINTS a fresh
#   registration token via POST /repos/{owner}/{repo}/actions/runners/
#   registration-token, in the CONTROLLER domain. The PAT is read at the single
#   point of use inside mint_registration_token; the minted token is passed to
#   config.sh on its argv. NEITHER is exported into the runner's environment,
#   written under RUNNER_ROOT, or echoed. The runner account cannot read the
#   controller domain (R7b), so a compromised job cannot mint registrations.
#
# Every refusal exits non-zero with a named reason (refuse <name>: ...), so a
# launchd log line identifies the exact guard that fired.

set -euo pipefail

# ---------------------------------------------------------------------------
# refusals and instrumentation
# ---------------------------------------------------------------------------

refuse() {
  # $1 = machine-readable reason name, $2 = human detail. Non-zero always.
  echo "refuse ${1}: ${2}" >&2
  exit 1
}

log_op() {
  # Ordering instrument: one operation name per line, append-only. The
  # behavioral suite asserts terminate → export-logs → wipe → verify-empty →
  # restore-image from this file; production leaves CONTROLLER_OP_LOG unset.
  if [ -n "${CONTROLLER_OP_LOG:-}" ]; then
    echo "$1" >> "${CONTROLLER_OP_LOG}"
  fi
}

# ---------------------------------------------------------------------------
# privilege boundary (F8) — runner operations run AS the runner user
# ---------------------------------------------------------------------------

require_runner_user() {
  # config.sh/run.sh with controller (root) authority would invalidate every
  # ACL and keychain boundary R7a/R7b establishes. Refuse to proceed without a
  # distinct runner identity to drop to.
  [ -n "${RUNNER_USER:-}" ] || refuse runner-user-unset "RUNNER_USER must name the runner account"
  if [ "${RUNNER_USER}" = "$(id -un)" ]; then
    refuse runner-user-is-controller "RUNNER_USER equals the controller's own user; runner operations must not run with controller authority"
  fi
}

run_as_runner() {
  # The ONLY gateway for runner-owned operations (anything executed inside the
  # runner root). Controller-domain operations — credential read, token mint,
  # log archive, image restore, wipe — never pass through here.
  sudo -u "${RUNNER_USER}" "$@"
}

verify_runner_identity() {
  # F7: RUNNER_UID (the uid whose processes are terminated) and RUNNER_USER
  # (the account registration drops to) are independent config values. If
  # they disagree, termination kills another account's processes — or misses
  # the runner's — while registration proceeds under a different uid. Require
  # them to denote the SAME account, never root, and never the controller
  # itself, BEFORE any terminate/wipe/register.
  require_runner_user
  local uid="${RUNNER_UID:?RUNNER_UID must be set}"
  [ "${uid}" != "0" ] || refuse runner-uid-root "RUNNER_UID must not be 0; the controller never terminates or registers as root"
  if [ "${uid}" = "$(id -u)" ]; then
    refuse runner-uid-is-controller "RUNNER_UID equals the controller's own uid"
  fi
  local resolved
  if ! resolved="$(id -u "${RUNNER_USER}" 2>/dev/null)"; then
    refuse runner-uid-mismatch "RUNNER_USER '${RUNNER_USER}' does not resolve to a uid"
  fi
  if [ "${resolved}" != "${uid}" ]; then
    refuse runner-uid-mismatch "RUNNER_USER ${RUNNER_USER} resolves to uid ${resolved}, but RUNNER_UID is ${uid}; refusing to terminate or register across mismatched identities"
  fi
}

# ---------------------------------------------------------------------------
# target validation — the allowlist
# ---------------------------------------------------------------------------

validate_target() {
  # The ONLY paths this controller will ever destroy are: a RUNNER_ROOT that is
  # a direct child of the dedicated RUNNER_BASE_DIR. Everything else refuses:
  # empty, '/', $HOME, a symlink (which would redirect the wipe elsewhere),
  # any path outside the base, and any path with a '..' component. Each guard
  # is ordered cheapest-lie-first.
  local base="${RUNNER_BASE_DIR:-}"
  local root="${RUNNER_ROOT:-}"

  [ -n "${base}" ] || refuse empty-base "RUNNER_BASE_DIR is unset or empty"
  [ "${base}" != "/" ] || refuse base-is-root "RUNNER_BASE_DIR must not be /"
  [ -n "${root}" ] || refuse empty-target "RUNNER_ROOT is unset or empty"
  [ "${root}" != "/" ] || refuse target-is-root "RUNNER_ROOT must not be /"
  [ "${root}" != "${HOME:-}" ] || refuse target-is-home "RUNNER_ROOT must not be \$HOME"
  case "${root}" in
    *..*) refuse target-dotdot "RUNNER_ROOT contains a .. component" ;;
  esac
  case "${root}" in
    "${base}"/*) : ;;
    *) refuse target-outside-base "RUNNER_ROOT is not under RUNNER_BASE_DIR" ;;
  esac
  # A direct child, not a grandchild: strip base + one component, expect empty.
  local rel="${root#"${base}"/}"
  case "${rel}" in
    */*) refuse target-not-direct-child "RUNNER_ROOT must be a direct child of RUNNER_BASE_DIR" ;;
    "")  refuse target-outside-base "RUNNER_ROOT equals RUNNER_BASE_DIR" ;;
  esac
  # Symlink check LAST, on the validated path: a symlinked root would make
  # every "confined" operation land wherever the link points.
  if [ -L "${root}" ]; then
    refuse target-symlink "RUNNER_ROOT is a symlink"
  fi
}

# F4: the marker and lock are the controller's proof state. If the runner
# account can write where they live, "cleanup verified" is forgeable and the
# lock is deniable — so every state-touching entry point asserts the domain.
verify_controller_state_dir() {
  [ -n "${CONTROLLER_STATE_DIR:-}" ] || refuse state-dir-unset \
    "CONTROLLER_STATE_DIR is required (controller-domain proof state)"
  [ -d "${CONTROLLER_STATE_DIR}" ] || refuse state-dir-missing \
    "CONTROLLER_STATE_DIR does not exist: ${CONTROLLER_STATE_DIR}"
  case "${CONTROLLER_STATE_DIR}/" in
    "${RUNNER_BASE_DIR}"/*) refuse state-dir-under-base \
      "CONTROLLER_STATE_DIR must not live under RUNNER_BASE_DIR" ;;
  esac
  local owner_uid mode self_uid
  owner_uid="$(stat -f %u "${CONTROLLER_STATE_DIR}" 2>/dev/null)" || \
    refuse state-dir-stat-failed "cannot stat CONTROLLER_STATE_DIR"
  self_uid="$(id -u 2>/dev/null || echo '')"
  # Runner-owned proof state is forgeable. The equality-with-self case is left
  # to verify_runner_identity's sharper runner-uid-is-controller refusal (it
  # runs first), and a genuinely runner-owned dir cannot be constructed in the
  # unprivileged test suite — coded, exercised only in production preflight,
  # same precedent as the owned-by-other-uid toolchain branch.
  if [ -n "${RUNNER_UID:-}" ] && [ "${owner_uid}" = "${RUNNER_UID}" ] \
     && [ "${RUNNER_UID}" != "${self_uid}" ]; then
    refuse state-dir-runner-owned \
      "CONTROLLER_STATE_DIR is owned by the runner uid ${RUNNER_UID}"
  fi
  mode="$(stat -f %Lp "${CONTROLLER_STATE_DIR}" 2>/dev/null)" || \
    refuse state-dir-stat-failed "cannot stat CONTROLLER_STATE_DIR mode"
  case "${mode}" in
    *[2367]?|*[2367]) refuse state-dir-writable \
      "CONTROLLER_STATE_DIR is group/other-writable (mode ${mode})" ;;
  esac
}

# ---------------------------------------------------------------------------
# concurrency lock — mkdir is atomic; a second invocation refuses
# ---------------------------------------------------------------------------

LOCK_DIR=""
_LOCK_HELD=0
# R2: the reclaim token serializing stale-lock takeover (see acquire_lock).
STEAL_DIR=""
_STEAL_HELD=0

# Controller-domain temp files the mint uses (F8): registered globally so the
# single EXIT trap removes them on EVERY exit path, refusals included.
MINT_CFG_FILE=""
MINT_BODY_FILE=""

controller_cleanup() {
  if [ "${_LOCK_HELD}" = "1" ] && [ -n "${LOCK_DIR}" ]; then
    # R2: the owner record lives INSIDE the lock, so it goes first — a bare
    # rmdir against a non-empty directory fails and would leak the lock on
    # every clean exit.
    rm -f "${LOCK_DIR}/owner" 2>/dev/null || true
    rmdir "${LOCK_DIR}" 2>/dev/null || true
  fi
  if [ "${_STEAL_HELD}" = "1" ] && [ -n "${STEAL_DIR}" ]; then
    rmdir "${STEAL_DIR}" 2>/dev/null || true
  fi
  [ -z "${MINT_CFG_FILE}" ] || rm -f "${MINT_CFG_FILE}" 2>/dev/null || true
  [ -z "${MINT_BODY_FILE}" ] || rm -f "${MINT_BODY_FILE}" 2>/dev/null || true
}
trap controller_cleanup EXIT

# R2 — the boot epoch, the identity that makes a recorded pid meaningful.
# A bare pid is NOT reboot-safe: pids are recycled, so a lock left behind by a
# reboot can name a pid that is alive again as something unrelated, and the
# controller would honour it forever. Scoping every recorded pid to the boot it
# ran in removes that class entirely — a lock from a previous boot is dead by
# definition, whatever its pid now points at.
#
# Fail CLOSED: an unreadable or unparseable boot epoch means we cannot prove
# anything is stale, so callers keep honouring the lock (a stuck cycle that
# launchd retries) rather than stealing one that may be live.
boot_epoch() {
  local raw sec
  raw="$(sysctl -n kern.boottime 2>/dev/null)" || return 1
  # "{ sec = 1786721781, usec = 698883 } Fri Aug 14 08:36:21 2026"
  #
  # Take the FIRST number in the string, anchored. A `.*sec = ` pattern is
  # greedy and matches "uSEC = " instead, silently yielding the microseconds —
  # which makes every lock look like it came from another boot and turns this
  # guard into an unconditional steal. Cost a real debugging round; do not
  # "simplify" it back.
  sec="$(printf '%s' "${raw}" | sed -n 's/^[^0-9]*\([0-9][0-9]*\).*/\1/p')"
  case "${sec}" in ''|*[!0-9]*) return 1 ;; esac
  # Sanity floor: a real boot epoch is seconds since 1970, always past 2001.
  # Anything smaller means the format changed under us — refuse to conclude
  # anything rather than mistake a parse failure for a stale lock.
  [ "${sec}" -gt 1000000000 ] || return 1
  printf '%s' "${sec}"
}

# Is the lock at $1 provably abandoned? Exit 0 = provably dead (safe to
# reclaim); non-zero = live, or not provable. Never guesses.
lock_is_stale() {
  local dir="$1" boot owner recorded_boot recorded_pid dir_mtime
  boot="$(boot_epoch)" || return 1        # cannot prove ⇒ honour the lock
  owner="${dir}/owner"

  if [ -r "${owner}" ]; then
    read -r recorded_boot recorded_pid < "${owner}" 2>/dev/null || return 1
    case "${recorded_boot}${recorded_pid}" in
      ''|*[!0-9]*) return 1 ;;            # unparseable ⇒ honour the lock
    esac
    # A different boot: the recording process cannot possibly still exist.
    [ "${recorded_boot}" = "${boot}" ] || return 0
    # Same boot: the pid is directly decidable. kill -0 tests existence only.
    kill -0 "${recorded_pid}" 2>/dev/null && return 1
    return 0
  fi

  # No owner file. Either a holder microseconds into acquire (mkdir has
  # returned, the write has not), or a lock predating R2 / killed in that
  # window. The directory's own mtime decides it WITHOUT a timing heuristic:
  # created before this boot ⇒ no process from this boot owns it ⇒ dead.
  dir_mtime="$(stat -f %m "${dir}" 2>/dev/null)" || return 1
  case "${dir_mtime}" in ''|*[!0-9]*) return 1 ;; esac
  [ "${dir_mtime}" -lt "${boot}" ] && return 0
  # Same boot, no owner recorded: assume a live holder mid-acquire. Fail closed.
  return 1
}

acquire_lock() {
  verify_controller_state_dir
  # run-cycle calls three phases in this same shell; the first acquire wins
  # and the nested ones pass — the lock spans the whole cycle, released by the
  # EXIT trap. A SECOND PROCESS still refuses: mkdir on the existing lock
  # directory fails atomically.
  if [ "${_LOCK_HELD}" = "1" ]; then
    return 0
  fi
  LOCK_DIR="${CONTROLLER_LOCK_DIR:-${CONTROLLER_STATE_DIR}/.controller.lock}"
  if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
    # R2: a held lock is only honoured while its owner can still be alive.
    # Before R2 a reboot mid-cycle left this directory behind and EVERY later
    # cycle refused forever — the runner bricked until someone cleared it by
    # hand.
    if ! lock_is_stale "${LOCK_DIR}"; then
      refuse lock-held "another controller invocation holds ${LOCK_DIR}"
    fi
    # Reclaiming is itself serialized, by a second atomic mkdir. Without it two
    # invocations that both observe the same stale lock can each remove it and
    # each re-create it — two live holders, the exact condition the lock
    # exists to prevent. Only the process that takes the steal token reclaims;
    # any other refuses and lets launchd retry.
    STEAL_DIR="${LOCK_DIR}.steal"
    if ! mkdir "${STEAL_DIR}" 2>/dev/null; then
      # A steal token from a previous boot is itself abandoned; clear it and
      # let the next cycle proceed rather than trading one brick for another.
      if lock_is_stale "${STEAL_DIR}"; then
        rmdir "${STEAL_DIR}" 2>/dev/null || true
      fi
      refuse lock-held "another controller invocation is reclaiming ${LOCK_DIR}"
    fi
    _STEAL_HELD=1
    log_op reclaim-stale-lock
    rm -f "${LOCK_DIR}/owner" 2>/dev/null || true
    rmdir "${LOCK_DIR}" 2>/dev/null || true
    if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
      refuse lock-held "another controller invocation holds ${LOCK_DIR}"
    fi
  fi
  # Record the owner BEFORE declaring the lock held, so a crash after this
  # point always leaves a decidable lock rather than an ambiguous one.
  if ! printf '%s %s\n' "$(boot_epoch || echo 0)" "$$" > "${LOCK_DIR}/owner"; then
    rmdir "${LOCK_DIR}" 2>/dev/null || true
    refuse lock-owner-unwritable "cannot record the lock owner in ${LOCK_DIR}"
  fi
  _LOCK_HELD=1
  # Release the steal token only once we own the lock outright.
  if [ "${_STEAL_HELD}" = "1" ]; then
    rmdir "${STEAL_DIR}" 2>/dev/null || true
    _STEAL_HELD=0
  fi
}

# The cleanup-verified marker lives BESIDE the root (in the base dir), never
# inside it — it must survive the wipe it certifies, and the runner account
# must not be able to forge it.
marker_path() {
  echo "${CONTROLLER_STATE_DIR}/.cleanup-verified"
}

# ---------------------------------------------------------------------------
# toolchain checksum gate (F9) — verified before EVERY registration
# ---------------------------------------------------------------------------

# F2: populated by verify_toolchain from the VALIDATED manifest entries only.
# TOOLCHAIN_DIRS is a colon-joined, deduped, manifest-order directory list;
# TOOLCHAIN_ENTRIES is a space-separated "basename=absolute-path" list.
TOOLCHAIN_DIRS=""
TOOLCHAIN_ENTRIES=""
# The runner PATH built from them (build_runner_path). Empty until then, so a
# consumer that runs before the gate fails loudly rather than silently using a
# toolchain-free PATH.
RUNNER_PATH=""
SYSTEM_PATH="/usr/bin:/bin:/usr/sbin:/sbin"

verify_toolchain() {
  # R7c promises the root-owned read-only toolchain is checksummed at job
  # start. Fail closed: no manifest, no registration — a skipped gate is a
  # bypassed gate.
  log_op verify-toolchain
  local manifest="${CONTROLLER_TOOLCHAIN_MANIFEST:-}"
  [ -n "${manifest}" ] || refuse toolchain-manifest-missing "CONTROLLER_TOOLCHAIN_MANIFEST is unset; registration requires the toolchain gate"
  [ -f "${manifest}" ] || refuse toolchain-manifest-missing "no manifest file at ${manifest}"

  local controller_uid expected path owner mode g o actual
  # F6: a manifest that VALIDATES NOTHING is a vacuous gate — every line
  # skipped as blank or comment counts for nothing. Track how many entries
  # actually passed validation, refuse duplicates (a path listed twice can
  # mask a missing tool by inflating counts), and require an explicit entry
  # for every required tool basename.
  local required="${REQUIRED_TOOLCHAIN_TOOLS:-uv node}"
  local entry_count=0 seen_paths=$'\n' seen_names="" tool_name tool_dir
  TOOLCHAIN_DIRS=""
  TOOLCHAIN_ENTRIES=""
  controller_uid="$(id -u)"
  while IFS=' ' read -r expected path; do
    # Blank lines and comment lines are permitted in the manifest.
    [ -n "${expected}" ] || continue
    case "${expected}" in \#*) continue ;; esac
    # Leading whitespace on the path (the classic `sha256  path` two-space
    # shasum format) is stripped by read's IFS splitting already.
    case "${seen_paths}" in
      *$'\n'"${path}"$'\n'*) refuse toolchain-duplicate-entry "${path} is listed more than once in the manifest" ;;
    esac
    seen_paths="${seen_paths}${path}"$'\n'
    [ -f "${path}" ] || refuse toolchain-file-missing "manifest names ${path} which does not exist"
    owner="$(stat -f %u "${path}" 2>/dev/null || stat -c %u "${path}")"
    if [ "${owner}" != "0" ] && [ "${owner}" != "${controller_uid}" ]; then
      refuse toolchain-not-controller-owned "${path} is owned by uid ${owner}, not root or the controller"
    fi
    # Non-writable by the runner user: the runner is neither root nor the
    # controller (require_runner_user enforces distinctness), so with ownership
    # pinned above it can only write via the group/other write bits.
    mode="$(stat -f %Lp "${path}" 2>/dev/null || stat -c %a "${path}")"
    g="${mode: -2:1}"
    o="${mode: -1}"
    case "${g}${o}" in
      *[2367]*) refuse toolchain-runner-writable "${path} is group/other-writable (mode ${mode})" ;;
    esac
    actual="$(shasum -a 256 "${path}" | awk '{print $1}')"
    if [ "${actual}" != "${expected}" ]; then
      refuse toolchain-hash-mismatch "${path} does not match its manifest checksum"
    fi
    entry_count=$((entry_count + 1))
    tool_name="${path##*/}"
    seen_names="${seen_names} ${tool_name}"
    # F2: record the VALIDATED entry's directory and absolute path. The runner
    # PATH is built from these (build_runner_path) so the binaries the gate
    # just checksummed are the binaries the job can actually reach.
    tool_dir="${path%/*}"
    case ":${TOOLCHAIN_DIRS}:" in
      *":${tool_dir}:"*) : ;;
      *) TOOLCHAIN_DIRS="${TOOLCHAIN_DIRS:+${TOOLCHAIN_DIRS}:}${tool_dir}" ;;
    esac
    TOOLCHAIN_ENTRIES="${TOOLCHAIN_ENTRIES} ${tool_name}=${path}"
  done < "${manifest}"
  # F6: zero validated entries means the gate checked NOTHING — an empty or
  # comment-only manifest must never pass.
  [ "${entry_count}" -gt 0 ] || refuse toolchain-manifest-empty "the manifest validates zero entries; a gate that checks nothing is a bypassed gate"
  for tool_name in ${required}; do
    case " ${seen_names} " in
      *" ${tool_name} "*) : ;;
      *) refuse toolchain-required-tool-missing "required tool '${tool_name}' has no entry in the manifest" ;;
    esac
  done
}

# ---------------------------------------------------------------------------
# F2 — bind the runner PATH to the CHECKSUMMED toolchain
# ---------------------------------------------------------------------------
#
# The gate verified `/usr/local/populus-toolchain/bin/{uv,node}`. A runner
# environment of `PATH=/usr/bin:/bin:/usr/sbin:/sbin` cannot reach those files
# at all — so the job either fails to find its tools or finds DIFFERENT,
# unchecked ones earlier on some other path. A checksum gate over binaries the
# job never executes is theatre. The PATH is therefore DERIVED from the
# validated manifest entries, and the derivation is then PROVEN by resolution
# rather than assumed.

build_runner_path() {
  # Manifest directories first (dedup + manifest order preserved by
  # verify_toolchain), then the minimal system path.
  [ -n "${TOOLCHAIN_DIRS}" ] || refuse toolchain-path-unbound \
    "no validated toolchain directories; the runner PATH cannot be bound to the gate"
  RUNNER_PATH="${TOOLCHAIN_DIRS}:${SYSTEM_PATH}"
}

resolve_on_path() {
  # $1 = tool basename, $2 = the PATH to search. Returns the FIRST executable
  # regular file, which is what exec would actually pick.
  #
  # Deliberately NOT `command -v`: bash 3.2 (the macOS system bash this runs
  # under) reports a non-executable match, so a gated tool with its execute bit
  # cleared would "resolve" and the binding assertion would pass on a binary
  # the job cannot run. Measured, not assumed.
  local name="$1" search="$2" dir candidate
  local IFS=':'
  for dir in ${search}; do
    [ -n "${dir}" ] || continue
    candidate="${dir}/${name}"
    if [ -f "${candidate}" ] && [ -x "${candidate}" ]; then
      echo "${candidate}"
      return 0
    fi
  done
  return 1
}

assert_toolchain_path_bound() {
  # For every REQUIRED tool: resolve it under the constructed PATH and demand
  # the manifest's own absolute path back. This catches both halves of the
  # defect — a manifest directory missing from PATH (resolves to nothing or to
  # a system copy) and a decoy binary shadowing the checked one from an earlier
  # directory (an unlisted `uv` sitting beside a listed `node`).
  local required="${REQUIRED_TOOLCHAIN_TOOLS:-uv node}"
  local tool_name entry expected resolved
  for tool_name in ${required}; do
    expected=""
    for entry in ${TOOLCHAIN_ENTRIES}; do
      case "${entry}" in
        "${tool_name}="*) expected="${entry#*=}" ;;
      esac
    done
    [ -n "${expected}" ] || refuse toolchain-path-unbound \
      "required tool '${tool_name}' has no validated manifest entry to bind"
    # Pure resolution against the constructed PATH — nothing is executed.
    resolved="$(resolve_on_path "${tool_name}" "${RUNNER_PATH}")" || resolved=""
    if [ "${resolved}" != "${expected}" ]; then
      refuse toolchain-path-unbound \
        "'${tool_name}' resolves to '${resolved:-<nothing>}' under the runner PATH, but the manifest gates '${expected}'"
    fi
  done
}

# ---------------------------------------------------------------------------
# F1 — ownership of the writable root
# ---------------------------------------------------------------------------
#
# The controller runs as root (launchd) and creates + extracts RUNNER_ROOT, so
# every file lands controller-owned. config.sh and run.sh then execute via
# `sudo -u $RUNNER_USER` and must WRITE that tree — _work, the per-job HOME,
# the per-job TMPDIR. Without a transfer of ownership the first real install
# fails on permissions; the shim-based suite never noticed because shims do not
# check ownership.
#
# The transfer is deliberately NARROW: only RUNNER_ROOT and its contents (which
# include the HOME and TMPDIR this controller creates). NEVER RUNNER_BASE_DIR —
# a runner-owned parent would let a job replace the root, the image, or the
# sibling state. NEVER CONTROLLER_STATE_DIR — a runner-owned proof directory
# makes the cleanup-verified marker forgeable.

transfer_root_ownership() {
  local uid="${RUNNER_UID:?RUNNER_UID must be set to transfer root ownership}"
  local crc=0
  # -R covers the extracted image plus the fresh home/tmp; -h so a symlink in
  # the image retargets nothing outside the root.
  chown -Rh "${uid}" "${RUNNER_ROOT}" 2>/dev/null || crc=$?
  if [ "${crc}" -ne 0 ]; then
    if [ "$(id -u)" = "0" ]; then
      # PRODUCTION half: as root the chown cannot legitimately fail, so a
      # failure is a real defect and must stop the cycle.
      refuse runner-root-chown-failed \
        "chown -Rh ${uid} ${RUNNER_ROOT} exited ${crc}"
    fi
    # TEST half (production-only distinction): an unprivileged controller —
    # which is what the behavioral suite runs as — cannot chown to a foreign
    # uid. That is not a silent pass: verify_root_ownership below gates
    # registration on the OBSERVED owner, so a root the runner does not own
    # never reaches config.sh.
    echo "note: ownership transfer skipped (controller is unprivileged); registration remains gated by verify_root_ownership" >&2
  fi
}

verify_root_ownership() {
  # Asserted before EVERY registration, in both directions.
  local uid="${RUNNER_UID:?RUNNER_UID must be set}"
  local owner
  owner="$(owner_uid_of "${RUNNER_ROOT}")"
  [ "${owner}" = "${uid}" ] || refuse active-root-not-runner-owned \
    "RUNNER_ROOT ${RUNNER_ROOT} is owned by uid ${owner}, not the runner uid ${uid}; the runner cannot write its own workspace"
  owner="$(owner_uid_of "${RUNNER_BASE_DIR}")"
  [ "${owner}" != "${uid}" ] || refuse base-dir-runner-owned \
    "RUNNER_BASE_DIR ${RUNNER_BASE_DIR} is owned by the runner uid ${uid}; a runner-owned parent can replace the root or the image"
  owner="$(owner_uid_of "${CONTROLLER_STATE_DIR}")"
  [ "${owner}" != "${uid}" ] || refuse state-dir-runner-owned \
    "CONTROLLER_STATE_DIR ${CONTROLLER_STATE_DIR} is owned by the runner uid ${uid}; the cleanup-verified marker would be forgeable"
}

owner_uid_of() {
  local out
  out="$(stat -f %u "$1" 2>/dev/null || stat -c %u "$1" 2>/dev/null)" \
    || refuse ownership-stat-failed "cannot stat $1 to determine its owner"
  [ -n "${out}" ] || refuse ownership-stat-failed "empty owner uid for $1"
  echo "${out}"
}

# ---------------------------------------------------------------------------
# destroy-root: terminate → export-logs → wipe → verify-empty
# ---------------------------------------------------------------------------

cmd_destroy_root() {
  validate_target
  # F7: the identity the kills target and the identity registration drops to
  # must be proven coherent BEFORE any termination or wipe.
  verify_runner_identity
  acquire_lock

  # A stale marker from a previous cycle certifies nothing about THIS wipe;
  # drop it before touching anything so a mid-destroy crash cannot leave a
  # marker that predates the failure.
  rm -f "$(marker_path)"

  # 1. Terminate residual runner-UID processes, then VERIFY the UID's process
  #    set is empty (F12). "No processes found" (pkill/pgrep exit 1) is the
  #    desired steady state; any OTHER failure is a command failure and
  #    refuses — a kill that silently failed would let a hostile process watch
  #    its own root being rebuilt.
  log_op terminate
  local uid="${RUNNER_UID:?RUNNER_UID must be set for termination}"
  local krc
  if [ "${DRY_RUN:-0}" != "1" ]; then
    krc=0
    pkill -TERM -U "${uid}" || krc=$?
    [ "${krc}" -le 1 ] || refuse terminate-failed "pkill -TERM exited ${krc}"
    sleep 5
    krc=0
    pkill -KILL -U "${uid}" || krc=$?
    [ "${krc}" -le 1 ] || refuse terminate-failed "pkill -KILL exited ${krc}"
  fi
  # Verification runs in DRY_RUN too (pgrep only observes; the tests shim it):
  # the wipe is gated on OBSERVED emptiness, not on the kills' exit status.
  local prc=0 survivors=""
  survivors="$(pgrep -u "${uid}")" || prc=$?
  [ "${prc}" -le 1 ] || refuse terminate-verify-failed "pgrep exited ${prc}; cannot verify the runner-UID process set"
  if [ "${prc}" -eq 0 ] && [ -n "${survivors}" ]; then
    survivors="${survivors//$'\n'/ }"
    refuse runner-processes-survive "runner-UID processes survived termination: pids ${survivors}"
  fi

  # 2. Export logs to the owner domain BEFORE the wipe destroys them, and
  #    VERIFY the copies (F11): every source file must exist at the export
  #    destination with a matching byte count, or the wipe REFUSES — the
  #    diagnostics from a suspicious job are exactly the thing we must not
  #    delete along with it, and an unverified export is not an export.
  log_op export-logs
  local stamp export_dir
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  export_dir="${CONTROLLER_LOG_EXPORT_DIR:?CONTROLLER_LOG_EXPORT_DIR must be set}/${stamp}"
  mkdir -p "${export_dir}" || refuse log-export-failed "cannot create export directory ${export_dir}; refusing to wipe the only log copies"
  local d f rel dst
  for d in _diag logs; do
    [ -d "${RUNNER_ROOT}/${d}" ] || continue
    cp -R "${RUNNER_ROOT}/${d}" "${export_dir}/" \
      || refuse log-export-failed "copying ${d} to ${export_dir} failed; refusing to wipe the only log copies"
    while IFS= read -r f; do
      rel="${f#"${RUNNER_ROOT}"/}"
      dst="${export_dir}/${rel}"
      [ -f "${dst}" ] || refuse log-export-not-verified "exported copy of ${rel} is missing; refusing to wipe"
      if [ "$(wc -c < "${f}")" -ne "$(wc -c < "${dst}")" ]; then
        refuse log-export-not-verified "exported copy of ${rel} has a different byte count; refusing to wipe"
      fi
    done < <(find "${RUNNER_ROOT}/${d}" -type f)
  done

  # 3. Wipe the root's CONTENTS. find -delete confines itself to the validated
  #    target and needs no glob (a glob misses dotfiles; rm -rf on a variable
  #    is the classic destroy-the-wrong-thing primitive we refuse to write).
  log_op wipe
  if [ -d "${RUNNER_ROOT}" ]; then
    find "${RUNNER_ROOT}" -mindepth 1 -delete
  else
    mkdir -p "${RUNNER_ROOT}"
  fi

  # 4. VERIFY empty — the wipe is not trusted, it is checked. Only a verified
  #    wipe writes the marker that register later requires.
  log_op verify-empty
  if [ -n "$(ls -A "${RUNNER_ROOT}")" ]; then
    refuse wipe-not-verified "RUNNER_ROOT is not empty after wipe"
  fi
  touch "$(marker_path)"
}

# ---------------------------------------------------------------------------
# restore-image: pristine image → fresh root + fresh TMPDIR + fresh HOME
# ---------------------------------------------------------------------------

cmd_restore_image() {
  validate_target
  acquire_lock

  log_op restore-image
  local tarball="${RUNNER_IMAGE_TARBALL:?RUNNER_IMAGE_TARBALL must be set}"
  [ -f "${tarball}" ] || refuse image-missing "no image tarball at configured path"
  mkdir -p "${RUNNER_ROOT}"
  tar -xzf "${tarball}" -C "${RUNNER_ROOT}"
  # Fresh per-job TMPDIR and HOME, both INSIDE the root so the next
  # destroy-root reconstructs them too.
  mkdir -p "${RUNNER_ROOT}/tmp" "${RUNNER_ROOT}/home"
  # F1: everything above was created/extracted with CONTROLLER authority. Hand
  # the root — and only the root — to the runner account that must write it.
  transfer_root_ownership
}

# ---------------------------------------------------------------------------
# registration-token mint (F10) — controller domain, per cycle
# ---------------------------------------------------------------------------

MINTED_TOKEN=""

mint_registration_token() {
  # REAL PATH (network) — never reached under DRY_RUN. The PAT is read here,
  # at the single point of use, into a local that is never exported and never
  # logged. One retry on 401 covers a just-expired cached credential edge;
  # a second 401 is a dead PAT and refuses with its own name.
  local cred_file="${CONTROLLER_CREDENTIAL_FILE:?CONTROLLER_CREDENTIAL_FILE must be set}"
  [ -f "${cred_file}" ] || refuse credential-missing "no credential file at configured path"
  local pat
  pat="$(cat "${cred_file}")"
  local repo_path="${RUNNER_REPO_URL:?RUNNER_REPO_URL must be set}"
  repo_path="${repo_path#https://github.com/}"
  local api_url="${GITHUB_API_URL:-https://api.github.com}/repos/${repo_path}/actions/runners/registration-token"
  # The response body lands in a controller-domain temp file, NEVER under
  # RUNNER_ROOT, and is removed on every exit from this function.
  #
  # F8: the PAT must NEVER appear on curl's argv — process arguments are
  # world-readable to same-UID persistence (ps/proc inspection). The
  # Authorization header therefore travels in a curl --config file: a
  # controller-domain mktemp, chmod 0600, outside the runner root, removed on
  # every exit (the mint_cleanup calls below plus the script-wide EXIT trap
  # covering refusal paths). Argv carries only the config-file PATH.
  local http_code crc attempt
  MINT_BODY_FILE="$(mktemp)"
  MINT_CFG_FILE="$(umask 077; mktemp)"
  chmod 600 "${MINT_CFG_FILE}"
  printf 'header = "Accept: application/vnd.github+json"\nheader = "Authorization: Bearer %s"\n' "${pat}" > "${MINT_CFG_FILE}"
  for attempt in 1 2; do
    crc=0
    http_code="$(curl -sS -o "${MINT_BODY_FILE}" -w '%{http_code}' -X POST \
      --config "${MINT_CFG_FILE}" \
      "${api_url}")" || crc=$?
    if [ "${crc}" -ne 0 ]; then
      mint_cleanup
      refuse registration-mint-failed "curl exited ${crc} minting the registration token"
    fi
    if [ "${http_code}" = "201" ]; then
      MINTED_TOKEN="$(sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${MINT_BODY_FILE}")"
      mint_cleanup
      [ -n "${MINTED_TOKEN}" ] || refuse registration-mint-failed "registration-token response carried no token field"
      return 0
    fi
    if [ "${http_code}" != "401" ]; then
      mint_cleanup
      refuse registration-mint-failed "HTTP ${http_code} from the registration-token endpoint"
    fi
    # 401: retry exactly once.
  done
  mint_cleanup
  refuse registration-token-denied "persistent 401 from the registration-token endpoint; the PAT is invalid or lacks repository Administration write"
}

mint_cleanup() {
  # Removes BOTH mint temp files (body + curl config carrying the PAT) and
  # clears the globals so the EXIT trap does not double-remove.
  rm -f "${MINT_BODY_FILE}" "${MINT_CFG_FILE}" 2>/dev/null || true
  MINT_BODY_FILE=""
  MINT_CFG_FILE=""
}

# ---------------------------------------------------------------------------
# register: ephemeral, and only after a VERIFIED cleanup
# ---------------------------------------------------------------------------

cmd_register() {
  validate_target
  # Guards that certify nothing about the wipe run BEFORE the marker is
  # consumed: a refusal here must not burn the verified-cleanup proof.
  verify_runner_identity
  acquire_lock
  verify_toolchain
  # F2: derive the runner PATH from what the gate just validated, then PROVE
  # each required tool resolves to its manifest path under it.
  build_runner_path
  assert_toolchain_path_bound
  # F1: the runner must own its writable root, and must NOT own the controller
  # domain. Both directions, before the marker is consumed.
  verify_root_ownership

  # The marker is the proof obligation: no verified wipe, no registration. It
  # is consumed on use — one registration per verified cleanup, so a crashed
  # job can never re-register against a dirty root.
  local marker
  marker="$(marker_path)"
  if [ ! -f "${marker}" ]; then
    refuse cleanup-not-verified "no cleanup-verified marker; run destroy-root first"
  fi
  rm -f "${marker}"

  log_op register

  # The runner's environment is constructed minimal and explicit (env -i):
  # nothing from the controller's environment leaks in, and in particular
  # the credential file's contents are ABSENT by construction.
  # PATH is the gate-bound one (F2), never a bare system path.
  local runner_env=(
    "PATH=${RUNNER_PATH:?runner PATH was never bound to the toolchain gate}"
    "HOME=${RUNNER_ROOT}/home"
    "TMPDIR=${RUNNER_ROOT}/tmp"
  )

  if [ "${DRY_RUN:-0}" = "1" ]; then
    # DRY RUN (the tests' path): dump the constructed environment so the suite
    # can grep it for the credential — proving absence, not asserting it.
    # The credential file is NOT read and no network mint occurs in this
    # branch; a stub stands in for the minted token and /usr/bin/true stands
    # in for config.sh, so the privilege transition (sudo -u) is still
    # exercised behaviorally.
    if [ -n "${CONTROLLER_ENV_DUMP:-}" ]; then
      printf '%s\n' "${runner_env[@]}" > "${CONTROLLER_ENV_DUMP}"
    fi
    MINTED_TOKEN="DRY-RUN-STUB-REGISTRATION-TOKEN"
    run_as_runner env -i "${runner_env[@]}" /usr/bin/true
    return 0
  fi

  # REAL PATH — mint a fresh registration token (controller domain), then run
  # the actual GitHub registration AS THE RUNNER USER. config.sh receives the
  # minted token on its argv inside an env -i environment; neither the PAT nor
  # the minted token is exported or written under the root.
  mint_registration_token
  # R3: --replace makes registration IDEMPOTENT. The runner name is fixed, and
  # an ephemeral runner that died without deregistering (a crash, a reboot, a
  # cancelled job) leaves its name claimed on the GitHub side; without
  # --replace config.sh then refuses "a runner exists with the same name" and
  # every subsequent cycle fails until someone deletes it in the web UI. The
  # name is ours by construction, so replacing it is the intended semantic.
  run_as_runner env -i "${runner_env[@]}" "${RUNNER_ROOT}/config.sh" \
    --unattended \
    --ephemeral \
    --replace \
    --url "${RUNNER_REPO_URL:?RUNNER_REPO_URL must be set}" \
    --token "${MINTED_TOKEN}" \
    --labels "self-hosted,macOS,populus-ops" \
    --name "populus-ops-ephemeral"
}

# ---------------------------------------------------------------------------
# run-cycle: one full cycle; launchd KeepAlive is the loop
# ---------------------------------------------------------------------------

cmd_run_cycle() {
  # Each phase re-validates on its own; the FIRST acquire takes the lock and
  # holds it across the whole cycle (see acquire_lock). The ORDER here is the
  # contract the behavioral suite pins:
  # a restore before a verified destroy, or a registration before a restore,
  # is a defect, not a variation.
  cmd_destroy_root
  cmd_restore_image
  cmd_register

  if [ "${DRY_RUN:-0}" = "1" ]; then
    return 0
  fi
  # Wait: run the ephemeral runner AS THE RUNNER USER (F8); it exits after one
  # job, we exit after it, and launchd re-invokes run-cycle — landing at
  # destroy-root again.
  run_as_runner env -i \
    "PATH=${RUNNER_PATH:?runner PATH was never bound to the toolchain gate}" \
    "HOME=${RUNNER_ROOT}/home" \
    "TMPDIR=${RUNNER_ROOT}/tmp" \
    "${RUNNER_ROOT}/run.sh"
}

# ---------------------------------------------------------------------------
# dispatch
# ---------------------------------------------------------------------------

case "${1:-}" in
  destroy-root)  cmd_destroy_root ;;
  restore-image) cmd_restore_image ;;
  register)      cmd_register ;;
  run-cycle)     cmd_run_cycle ;;
  "")            refuse no-subcommand "usage: runner-controller.sh {destroy-root|restore-image|register|run-cycle}" ;;
  *)             refuse unknown-subcommand "unknown subcommand: ${1}" ;;
esac
