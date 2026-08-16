"""RUN M2-11 R7d — the behavioral fake-root suite for the runner controller.

This suite is AUTHORITATIVE (plan round-5 F2): every safety property of
``ops/runner/runner-controller.sh`` is exercised by EXECUTING the real script
with subprocess against a disposable fake root under ``tmp_path`` — a mocked
wipe proves nothing about the wipe. The static assertions at the bottom
(``set -euo pipefail``, no destroy-the-world patterns, credential never
echoed) are supplemental, never the primary evidence.

Nothing here registers with GitHub. Most invocations set ``DRY_RUN=1``, which
skips process termination, the network token mint, actual registration, and
runner execution — the real registration path is the block marked ``REAL
PATH`` in ``cmd_register`` and ``mint_registration_token``. The token-mint
tests DO run the real register path (``DRY_RUN=0``) but with ``curl`` and
``sudo`` replaced by PATH shims, so the real control flow is exercised with
no network and no privilege escalation. Everything else (validation, locking,
log export + verification, wipe, verify, marker protocol, toolchain gate,
privilege transition, environment construction) runs for real.

Organised by the defect each test exists to catch:

* wipe-scope — a wipe that escapes the allowlisted target (plant a sibling,
  assert survival).
* refusals — empty target, ``/``, ``$HOME``, a symlinked root, a path outside
  the base: each must exit non-zero with its named reason.
* ordering — terminate → export-logs → wipe → verify-empty → restore-image →
  verify-toolchain → register, read from the CONTROLLER_OP_LOG instrument; a
  wipe that runs before the log export destroys the diagnostics it was
  supposed to preserve.
* locking — a second invocation against a held lock refuses.
* marker protocol — register refuses without a verified cleanup, and consumes
  the marker (one registration per cleanup).
* privilege boundary (F8) — every runner-owned execution goes through
  ``sudo -u $RUNNER_USER``; controller-domain operations do not; refusal when
  RUNNER_USER is unset or equals the controller's own user.
* toolchain gate (F9) — registration refuses on a missing manifest, a missing
  or tampered tool, or a runner-writable tool; fail closed, never skip.
* token mint (F10) — a fresh registration token is minted per cycle from the
  PAT via the GitHub API; one retry on 401; persistent 401 refuses; neither
  the PAT nor the minted token reaches the runner environment or the root.
* export verification (F11) — an export failure refuses the wipe and the
  root survives untouched.
* termination verification (F12) — surviving runner-UID processes refuse
  destruction, named by PID.
* credential isolation — the credential string appears nowhere in the
  constructed runner environment nor anywhere under the root.
"""

from __future__ import annotations

import getpass
import hashlib
import os
import re
import stat
import subprocess
import sys
import tarfile
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "ops" / "runner" / "runner-controller.sh"

# This suite EXECUTES the real controller, and the controller is macOS-only: its
# ownership and mode probes use BSD `stat -f %u` / `stat -f %Lp`
# (runner-controller.sh:210,223), which GNU coreutils reads as "filesystem
# status" and fails. On Linux every test therefore dies identically at
# `state-dir-stat-failed` — 163 failures that say nothing about the script.
#
# Skipped rather than made portable ON PURPOSE: this script runs as root on the
# owner's Mac mini, and loosening its probes to satisfy a runner it will never
# execute on would edit a privileged wipe path for no operational benefit. The
# authoritative run is on the machine it manages.
#
# (Note for whoever revisits: line 321 DOES carry a `|| stat -c %u` fallback,
# so the file is inconsistent about portability. Harmless while macOS-only.)
pytestmark = pytest.mark.skipif(
    sys.platform != "darwin",
    reason=(
        "runner-controller.sh is macOS-only (BSD `stat -f`); executing it on "
        "Linux fails at state-dir-stat-failed before reaching any assertion"
    ),
)

# The credential file now holds a long-lived fine-grained PAT (F10); the
# controller mints short-lived registration tokens from it per cycle.
CREDENTIAL = "SECRET-FINE-GRAINED-PAT-do-not-leak-9f3a"
MINTED_TOKEN = "FIXTURE-MINTED-TOKEN-1234"
RUNNER_USER = "populusrunner"

SYSTEM_PATH = "/usr/bin:/bin:/usr/sbin:/sbin"


@pytest.fixture()
def fake(tmp_path: Path) -> dict:
    """A disposable controller world: base dir, root, owner domain, image.

    Layout mirrors the plist's canonical layout, scaled down:
      base/root           the runner root (allowlisted target)
      base/sibling.txt    MUST survive every wipe
      owner/              controller domain: credential, exported logs, op
                          log, toolchain manifest, sudo shim log
      toolchain/uv        a fake root-read-only tool, listed in the manifest
      shims/sudo          PATH shim standing in for sudo: logs its argv to
                          SUDO_LOG and exits 0 without executing anything —
                          the privilege-transition instrument (F8)
      image.tar.gz        a pristine image with one marker file
    """
    base = tmp_path / "base"
    root = base / "root"
    owner = tmp_path / "owner"
    (root / "_diag").mkdir(parents=True)
    (root / "_diag" / "job.log").write_text("diagnostics from the last job\n")
    (root / "_work").mkdir()
    (root / "_work" / "leftover.txt").write_text("job residue\n")
    (base / "sibling.txt").write_text("beside the target, not inside it\n")
    owner.mkdir()
    (owner / "logs").mkdir()
    # F4: the proof-state domain (marker + lock). Outside base, 0700.
    state = owner / "state"
    state.mkdir(mode=0o700)
    cred = owner / "registration.credential"
    cred.write_text(CREDENTIAL + "\n")

    # Toolchain gate fixtures (F9/F6): the two REQUIRED tools (uv, node),
    # checksummed into a controller-owned manifest. Mode 0555: not writable
    # by anyone.
    tool = tmp_path / "toolchain" / "uv"
    tool.parent.mkdir()
    tool.write_text("#!/bin/sh\necho fake-uv 0.0.0\n")
    tool.chmod(0o555)
    node_tool = tmp_path / "toolchain" / "node"
    node_tool.write_text("#!/bin/sh\necho fake-node v0.0.0\n")
    node_tool.chmod(0o555)
    manifest = owner / "toolchain.manifest"
    manifest.write_text(
        f"{hashlib.sha256(tool.read_bytes()).hexdigest()}  {tool}\n"
        f"{hashlib.sha256(node_tool.read_bytes()).hexdigest()}  {node_tool}\n"
    )

    # sudo shim (F8): logs "$*" one line per invocation, executes NOTHING.
    shims = tmp_path / "shims"
    shims.mkdir()
    sudo_shim = shims / "sudo"
    sudo_shim.write_text('#!/bin/bash\nprintf \'%s\\n\' "$*" >> "${SUDO_LOG}"\nexit 0\n')
    sudo_shim.chmod(0o755)

    # id shim (F7): `id -u <name>` resolves ID_SHIM_USER to ID_SHIM_UID and
    # reports every other name as nonexistent; bare `id -u` / `id -un`
    # (controller self-identification) pass through to the real id. The
    # fixture's RUNNER_USER does not exist on the test machine, so the UID
    # coherence probe must be shimmed while the control flow around it runs.
    id_shim = shims / "id"
    id_shim.write_text(
        "#!/bin/bash\n"
        'if [ "${1:-}" = "-u" ] && [ -n "${2:-}" ]; then\n'
        '  if [ "$2" = "${ID_SHIM_USER:-}" ]; then echo "${ID_SHIM_UID}"; exit 0; fi\n'
        '  echo "id: $2: no such user" >&2; exit 1\n'
        "fi\n"
        "exec /usr/bin/id \"$@\"\n"
    )
    id_shim.chmod(0o755)

    # chown shim (F1): logs its argv, executes NOTHING. The controller runs as
    # ROOT in production, where `chown -Rh <runner-uid> <root>` is what makes
    # the runner able to write its own workspace/HOME/TMPDIR; an unprivileged
    # test process cannot chown to a foreign uid, so the shim is how the CALL
    # is observed. The ownership ASSERTIONS are driven separately, via the stat
    # shim below.
    chown_shim = shims / "chown"
    chown_shim.write_text('#!/bin/bash\nprintf \'%s\\n\' "$*" >> "${CHOWN_LOG}"\nexit 0\n')
    chown_shim.chmod(0o755)

    # stat shim (F1): reports STAT_SHIM_UID as the owner uid for any path at or
    # under one of the colon-separated STAT_SHIM_PATH entries; everything else
    # (including every `-f %Lp` mode query) passes through to the real stat.
    # Same precedent as the id shim: the production condition — a root actually
    # owned by a foreign runner uid — is unconstructible unprivileged, so the
    # branch is driven through the observation point rather than left untested.
    stat_shim = shims / "stat"
    stat_shim.write_text(
        "#!/bin/bash\n"
        'if [ "${1:-}" = "-f" ] && [ "${2:-}" = "%u" ] && [ -n "${STAT_SHIM_PATH:-}" ]; then\n'
        '  IFS=":" read -r -a _paths <<< "${STAT_SHIM_PATH}"\n'
        '  for _p in "${_paths[@]}"; do\n'
        '    [ -n "${_p}" ] || continue\n'
        '    case "${3:-}" in\n'
        '      "${_p}"|"${_p}"/*) echo "${STAT_SHIM_UID}"; exit 0 ;;\n'
        "    esac\n"
        "  done\n"
        "fi\n"
        'exec /usr/bin/stat "$@"\n'
    )
    stat_shim.chmod(0o755)

    image_src = tmp_path / "image-src"
    image_src.mkdir()
    (image_src / "pristine.marker").write_text("from the image\n")
    tarball = tmp_path / "image.tar.gz"
    with tarfile.open(tarball, "w:gz") as tf:
        tf.add(image_src / "pristine.marker", arcname="pristine.marker")

    env = {
        # Shims first, then the minimal POSIX PATH the script needs.
        "PATH": f"{shims}:{SYSTEM_PATH}",
        # HOME is set to a REAL directory distinct from the root so the
        # $HOME refusal test can point the root at it.
        "HOME": str(tmp_path / "home"),
        "RUNNER_BASE_DIR": str(base),
        "CONTROLLER_STATE_DIR": str(state),
        "RUNNER_ROOT": str(root),
        "RUNNER_UID": "999999",  # nonexistent: pgrep exits 1 = no survivors
        "RUNNER_USER": RUNNER_USER,
        # F7 coherence: the id shim resolves RUNNER_USER to exactly this uid.
        "ID_SHIM_USER": RUNNER_USER,
        "ID_SHIM_UID": "999999",
        "RUNNER_REPO_URL": "https://github.com/example/populus",
        "RUNNER_IMAGE_TARBALL": str(tarball),
        "CONTROLLER_LOG_EXPORT_DIR": str(owner / "logs"),
        "CONTROLLER_CREDENTIAL_FILE": str(cred),
        "CONTROLLER_TOOLCHAIN_MANIFEST": str(manifest),
        "CONTROLLER_OP_LOG": str(owner / "ops.log"),
        "CONTROLLER_ENV_DUMP": str(owner / "env.dump"),
        "SUDO_LOG": str(owner / "sudo.log"),
        "CHOWN_LOG": str(owner / "chown.log"),
        # F1 default: the root reads back as runner-owned (which the production
        # chown makes true), the base dir and the state dir do NOT.
        "STAT_SHIM_PATH": str(root),
        "STAT_SHIM_UID": "999999",
        "DRY_RUN": "1",
    }
    (tmp_path / "home").mkdir()
    return {
        "base": base,
        "state": state,
        "root": root,
        "owner": owner,
        "tool": tool,
        "node_tool": node_tool,
        "toolchain": tool.parent,
        "manifest": manifest,
        "shims": shims,
        "env": env,
        "tmp": tmp_path,
    }


def run_ctl(fake: dict, subcommand: str, **env_overrides) -> subprocess.CompletedProcess:
    env = {**fake["env"], **{k: v for k, v in env_overrides.items() if v is not None}}
    for k, v in env_overrides.items():
        if v is None:
            env.pop(k, None)
    return subprocess.run(
        ["bash", str(SCRIPT), subcommand],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


def ops_logged(fake: dict) -> list[str]:
    op_log = fake["owner"] / "ops.log"
    if not op_log.exists():
        return []
    return op_log.read_text().splitlines()


def sudo_logged(fake: dict) -> list[str]:
    sudo_log = fake["owner"] / "sudo.log"
    if not sudo_log.exists():
        return []
    return sudo_log.read_text().splitlines()


def chown_logged(fake: dict) -> list[str]:
    chown_log = fake["owner"] / "chown.log"
    if not chown_log.exists():
        return []
    return chown_log.read_text().splitlines()


def env_dumped(fake: dict) -> dict[str, str]:
    """The constructed runner environment, parsed from the DRY_RUN dump."""
    text = (fake["owner"] / "env.dump").read_text()
    out: dict[str, str] = {}
    for line in text.splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            out[k] = v
    return out


# ---------------------------------------------------------------------------
# wipe scope — destroys exactly the allowlisted target and nothing beside it
# ---------------------------------------------------------------------------


def test_destroy_root_wipes_target_and_only_target(fake):
    outside = fake["tmp"] / "outside.txt"
    outside.write_text("outside the base entirely\n")
    r = run_ctl(fake, "destroy-root")
    assert r.returncode == 0, r.stderr
    # The root exists and is empty; the planted residue is gone.
    assert fake["root"].is_dir()
    assert list(fake["root"].iterdir()) == []
    # The sibling INSIDE the base and the file OUTSIDE the base both survive.
    assert (fake["base"] / "sibling.txt").read_text() == "beside the target, not inside it\n"
    assert outside.exists()


def test_destroy_root_exports_logs_before_wiping(fake):
    r = run_ctl(fake, "destroy-root")
    assert r.returncode == 0, r.stderr
    exported = list((fake["owner"] / "logs").rglob("job.log"))
    assert exported, "the _diag log was wiped without being exported"
    assert exported[0].read_text() == "diagnostics from the last job\n"


# ---------------------------------------------------------------------------
# refusals — every destructive-target lie exits non-zero with a named reason
# ---------------------------------------------------------------------------


def assert_refused(r: subprocess.CompletedProcess, reason: str):
    assert r.returncode != 0, "expected a refusal, got success"
    assert f"refuse {reason}" in r.stderr, (
        f"expected named reason {reason!r} in stderr: {r.stderr!r}"
    )


def test_refuses_empty_target(fake):
    assert_refused(run_ctl(fake, "destroy-root", RUNNER_ROOT=""), "empty-target")


def test_refuses_unset_target(fake):
    assert_refused(run_ctl(fake, "destroy-root", RUNNER_ROOT=None), "empty-target")


def test_refuses_root_slash_target(fake):
    assert_refused(run_ctl(fake, "destroy-root", RUNNER_ROOT="/"), "target-is-root")


def test_refuses_home_target(fake):
    home = fake["env"]["HOME"]
    assert_refused(run_ctl(fake, "destroy-root", RUNNER_ROOT=home), "target-is-home")


def test_refuses_symlinked_target(fake):
    # A symlink at the allowlisted path redirects the wipe wherever it points;
    # the victim contents must be untouched after the refusal.
    victim = fake["tmp"] / "victim"
    victim.mkdir()
    (victim / "precious.txt").write_text("must survive\n")
    link = fake["base"] / "linkroot"
    link.symlink_to(victim)
    r = run_ctl(fake, "destroy-root", RUNNER_ROOT=str(link))
    assert_refused(r, "target-symlink")
    assert (victim / "precious.txt").read_text() == "must survive\n"


def test_refuses_target_outside_base(fake):
    stranger = fake["tmp"] / "stranger"
    stranger.mkdir()
    assert_refused(
        run_ctl(fake, "destroy-root", RUNNER_ROOT=str(stranger)),
        "target-outside-base",
    )


def test_refuses_dotdot_target(fake):
    sneaky = str(fake["base"]) + "/root/../../home"
    r = run_ctl(fake, "destroy-root", RUNNER_ROOT=sneaky)
    assert r.returncode != 0
    assert "refuse " in r.stderr


# ---------------------------------------------------------------------------
# ordering — terminate → export-logs → wipe → verify-empty → restore-image
#            → verify-toolchain → register
# ---------------------------------------------------------------------------


def test_run_cycle_operation_order(fake):
    r = run_ctl(fake, "run-cycle")
    assert r.returncode == 0, r.stderr
    ops = ops_logged(fake)
    assert ops == [
        "terminate",
        "export-logs",
        "wipe",
        "verify-empty",
        "restore-image",
        "verify-toolchain",
        "register",
    ], f"lifecycle order violated: {ops}"


def test_restore_image_populates_fresh_root(fake):
    r = run_ctl(fake, "run-cycle")
    assert r.returncode == 0, r.stderr
    # Pristine image content present; fresh per-job TMPDIR and HOME created;
    # nothing from the previous job's root survives.
    assert (fake["root"] / "pristine.marker").read_text() == "from the image\n"
    assert (fake["root"] / "tmp").is_dir()
    assert (fake["root"] / "home").is_dir()
    assert not (fake["root"] / "_work").exists()


# ---------------------------------------------------------------------------
# concurrency lock
# ---------------------------------------------------------------------------


def test_second_invocation_refuses_while_lock_held(fake):
    # Occupy the lock the way a concurrent invocation would (mkdir is the
    # atomic primitive the script itself uses), then invoke: refusal.
    lock = fake["state"] / ".controller.lock"
    lock.mkdir()
    assert_refused(run_ctl(fake, "destroy-root"), "lock-held")
    # The refusing invocation must NOT have released the other holder's lock.
    assert lock.is_dir()


def test_lock_released_after_successful_run(fake):
    assert run_ctl(fake, "destroy-root").returncode == 0
    assert run_ctl(fake, "restore-image").returncode == 0, "lock leaked across invocations"


# ---------------------------------------------------------------------------
# R2 — the lock is reboot-safe: it records its owner, and an owner that cannot
# still be alive does not hold it.
#
# Before R2 the lock was a bare mkdir released only by the EXIT trap, so a
# reboot (or a SIGKILL) mid-cycle left the directory behind and EVERY later
# cycle refused `lock-held` forever — the runner bricked until a human cleared
# it. These tests pin both halves: a dead owner is reclaimed, a live one is
# still honoured.
# ---------------------------------------------------------------------------


def boot_epoch() -> int:
    """The current boot's epoch seconds, the way the controller reads it."""
    raw = subprocess.run(
        ["sysctl", "-n", "kern.boottime"], capture_output=True, text=True, check=True
    ).stdout
    m = re.search(r"sec = (\d+)", raw)
    assert m, f"unparseable kern.boottime: {raw!r}"
    return int(m.group(1))


def plant_lock(fake: dict, owner_line: str | None, *, mtime: int | None = None) -> Path:
    """Occupy the lock the way a crashed or running invocation would."""
    lock = fake["state"] / ".controller.lock"
    lock.mkdir()
    if owner_line is not None:
        (lock / "owner").write_text(owner_line)
    if mtime is not None:
        os.utime(lock, (mtime, mtime))
    return lock


def dead_pid() -> int:
    """A pid that is certainly not running: spawn one and reap it."""
    p = subprocess.Popen([sys.executable, "-c", ""])
    p.wait()
    return p.pid


def test_lock_with_dead_pid_is_reclaimed(fake):
    # The reboot/crash case R2 exists for: same boot, owner no longer running.
    plant_lock(fake, f"{boot_epoch()} {dead_pid()}\n")
    r = run_ctl(fake, "destroy-root")
    assert r.returncode == 0, f"a dead owner must not brick the cycle: {r.stderr}"
    assert "reclaim-stale-lock" in ops_logged(fake), "reclaim must be recorded"


def test_lock_with_live_pid_still_refuses(fake):
    # The guard must not have been traded away for the fix: a genuinely live
    # holder (this very test process) is still honoured.
    lock = plant_lock(fake, f"{boot_epoch()} {os.getpid()}\n")
    assert_refused(run_ctl(fake, "destroy-root"), "lock-held")
    assert lock.is_dir(), "the refusing invocation released another's lock"
    assert (lock / "owner").exists(), "it also destroyed the owner record"


def test_lock_from_a_previous_boot_is_reclaimed_even_if_the_pid_is_alive(fake):
    # Pid reuse is why a bare pid is not enough. Record OUR OWN pid — alive
    # beyond any doubt — against the PREVIOUS boot. A pid-only implementation
    # honours this lock forever; a boot-scoped one knows the recorder is gone.
    plant_lock(fake, f"{boot_epoch() - 1} {os.getpid()}\n")
    r = run_ctl(fake, "destroy-root")
    assert r.returncode == 0, f"a previous boot's lock must be stale: {r.stderr}"


def test_unowned_lock_predating_this_boot_is_reclaimed(fake):
    # A lock left by the PRE-R2 controller carries no owner file at all. Dated
    # before this boot, no process from this boot can own it.
    plant_lock(fake, None, mtime=boot_epoch() - 3600)
    r = run_ctl(fake, "destroy-root")
    assert r.returncode == 0, f"a pre-boot unowned lock must be stale: {r.stderr}"


def test_unowned_lock_from_this_boot_is_honoured(fake):
    # Fail closed on the one genuinely ambiguous case: a holder that has
    # returned from mkdir but not yet written its owner file. Same boot, no
    # owner — assume live. (This is also the existing planted-lock case above.)
    plant_lock(fake, None)
    assert_refused(run_ctl(fake, "destroy-root"), "lock-held")


def test_reclaim_is_serialized_by_the_steal_token(fake):
    # Two invocations observing the same stale lock must not BOTH reclaim it —
    # that is two live holders, precisely what the lock prevents. The steal
    # token is the serializer; while it is held, a second invocation refuses
    # rather than taking the stale lock for itself.
    plant_lock(fake, f"{boot_epoch()} {dead_pid()}\n")
    steal = fake["state"] / ".controller.lock.steal"
    steal.mkdir()
    os.utime(steal, (boot_epoch() + 1, boot_epoch() + 1))  # this boot ⇒ live
    assert_refused(run_ctl(fake, "destroy-root"), "lock-held")


def test_successful_run_leaves_no_lock_behind(fake):
    # The owner record lives INSIDE the lock directory, so releasing it is no
    # longer a bare rmdir. If cleanup forgets the file, rmdir fails silently
    # and the lock leaks on every clean exit.
    assert run_ctl(fake, "destroy-root").returncode == 0
    assert not (fake["state"] / ".controller.lock").exists(), "lock leaked"
    assert not (fake["state"] / ".controller.lock.steal").exists(), "steal token leaked"


# ---------------------------------------------------------------------------
# marker protocol — register only after a VERIFIED cleanup, exactly once
# ---------------------------------------------------------------------------


def test_register_refuses_without_cleanup_marker(fake):
    assert_refused(run_ctl(fake, "register"), "cleanup-not-verified")


def test_register_consumes_marker(fake):
    assert run_ctl(fake, "destroy-root").returncode == 0
    assert run_ctl(fake, "register").returncode == 0
    # One registration per verified cleanup: the second refuses.
    assert_refused(run_ctl(fake, "register"), "cleanup-not-verified")


def test_failed_wipe_writes_no_marker(fake):
    # Force verify-empty to fail: make the wipe unable to remove a subdir's
    # contents by dropping write permission on it. The marker must not exist
    # afterwards — an unverified wipe certifies nothing.
    stubborn = fake["root"] / "stubborn"
    stubborn.mkdir()
    (stubborn / "held.txt").write_text("x")
    stubborn.chmod(stat.S_IRUSR | stat.S_IXUSR)
    try:
        r = run_ctl(fake, "destroy-root")
        assert r.returncode != 0
        assert not (fake["state"] / ".cleanup-verified").exists()
    finally:
        stubborn.chmod(stat.S_IRWXU)


# ---------------------------------------------------------------------------
# privilege boundary (F8) — runner ops via sudo -u, controller ops direct
# ---------------------------------------------------------------------------


def test_runner_operations_drop_to_runner_user(fake):
    # A full DRY_RUN cycle performs exactly ONE runner-owned execution (the
    # register rehearsal; /usr/bin/true stands in for config.sh — the REAL
    # PATH invokes config.sh through the same run_as_runner gateway). It must
    # go through the sudo shim with -u $RUNNER_USER and the env -i
    # construction. Controller-domain operations (terminate, log export,
    # wipe, image restore) appear NOWHERE in the shim log — one entry total
    # is the proof they ran un-dropped.
    r = run_ctl(fake, "run-cycle")
    assert r.returncode == 0, r.stderr
    lines = sudo_logged(fake)
    assert len(lines) == 1, f"expected exactly one privilege-dropped op: {lines}"
    assert lines[0].startswith(f"-u {RUNNER_USER} env -i "), lines[0]
    assert f"HOME={fake['root']}/home" in lines[0]
    assert f"TMPDIR={fake['root']}/tmp" in lines[0]


def test_register_refuses_when_runner_user_unset(fake):
    assert run_ctl(fake, "destroy-root").returncode == 0
    assert_refused(run_ctl(fake, "register", RUNNER_USER=None), "runner-user-unset")


def test_register_refuses_when_runner_user_is_controller(fake):
    assert run_ctl(fake, "destroy-root").returncode == 0
    r = run_ctl(fake, "register", RUNNER_USER=getpass.getuser())
    assert_refused(r, "runner-user-is-controller")
    # The refusal fired BEFORE the marker was consumed: the verified-cleanup
    # proof survives for a corrected invocation.
    assert (fake["state"] / ".cleanup-verified").exists()


# ---------------------------------------------------------------------------
# toolchain checksum gate (F9) — fail closed before every registration
# ---------------------------------------------------------------------------


def test_register_refuses_without_manifest_env(fake):
    assert run_ctl(fake, "destroy-root").returncode == 0
    assert_refused(
        run_ctl(fake, "register", CONTROLLER_TOOLCHAIN_MANIFEST=None),
        "toolchain-manifest-missing",
    )


def test_register_refuses_absent_manifest_file(fake):
    assert run_ctl(fake, "destroy-root").returncode == 0
    assert_refused(
        run_ctl(
            fake,
            "register",
            CONTROLLER_TOOLCHAIN_MANIFEST=str(fake["owner"] / "no-such.manifest"),
        ),
        "toolchain-manifest-missing",
    )


def test_register_refuses_missing_tool_file(fake):
    assert run_ctl(fake, "destroy-root").returncode == 0
    ghost = fake["tmp"] / "toolchain" / "ghost-tool"
    fake["manifest"].write_text(f"{'0' * 64}  {ghost}\n")
    r = run_ctl(fake, "register")
    assert_refused(r, "toolchain-file-missing")
    assert str(ghost) in r.stderr, "the refusal must name the missing file"


def test_register_refuses_tampered_tool(fake):
    assert run_ctl(fake, "destroy-root").returncode == 0
    tool = fake["tool"]
    tool.chmod(0o755)
    tool.write_text("#!/bin/sh\necho TAMPERED\n")
    tool.chmod(0o555)
    r = run_ctl(fake, "register")
    assert_refused(r, "toolchain-hash-mismatch")
    assert str(tool) in r.stderr, "the refusal must name the tampered file"


def test_register_refuses_runner_writable_tool(fake):
    assert run_ctl(fake, "destroy-root").returncode == 0
    # Content still hash-matches; the WRITABILITY alone must refuse — a tool
    # the runner can rewrite after the check is a bypassed gate.
    fake["tool"].chmod(0o775)
    try:
        r = run_ctl(fake, "register")
        assert_refused(r, "toolchain-runner-writable")
        assert str(fake["tool"]) in r.stderr
    finally:
        fake["tool"].chmod(0o555)


def test_matching_manifest_passes(fake):
    # The valid FULL manifest (both required tools, uv and node, correctly
    # checksummed) passes the gate (F6's positive case).
    assert run_ctl(fake, "destroy-root").returncode == 0
    r = run_ctl(fake, "register")
    assert r.returncode == 0, r.stderr
    assert "verify-toolchain" in ops_logged(fake)


# ---------------------------------------------------------------------------
# toolchain gate vacuity (F6) — a manifest that validates nothing refuses
# ---------------------------------------------------------------------------


def test_register_refuses_empty_manifest(fake):
    assert run_ctl(fake, "destroy-root").returncode == 0
    fake["manifest"].write_text("")
    assert_refused(run_ctl(fake, "register"), "toolchain-manifest-empty")


def test_register_refuses_comment_only_manifest(fake):
    # Every line skips as blank or comment: zero entries validated, which is
    # a vacuous gate, not a passed one.
    assert run_ctl(fake, "destroy-root").returncode == 0
    fake["manifest"].write_text("# a gate that checks nothing\n\n# still nothing\n")
    assert_refused(run_ctl(fake, "register"), "toolchain-manifest-empty")


def test_register_refuses_manifest_missing_required_uv(fake):
    # node alone validates fine, but uv is a REQUIRED tool: the refusal must
    # name the absent tool.
    assert run_ctl(fake, "destroy-root").returncode == 0
    node_tool = fake["node_tool"]
    fake["manifest"].write_text(
        f"{hashlib.sha256(node_tool.read_bytes()).hexdigest()}  {node_tool}\n"
    )
    r = run_ctl(fake, "register")
    assert_refused(r, "toolchain-required-tool-missing")
    assert "uv" in r.stderr, "the refusal must name the missing required tool"


def test_register_refuses_duplicate_manifest_path(fake):
    # A path listed twice inflates the entry count and can mask a missing
    # tool; it refuses even though every hash matches.
    assert run_ctl(fake, "destroy-root").returncode == 0
    uv_line = f"{hashlib.sha256(fake['tool'].read_bytes()).hexdigest()}  {fake['tool']}\n"
    node_line = (
        f"{hashlib.sha256(fake['node_tool'].read_bytes()).hexdigest()}  {fake['node_tool']}\n"
    )
    fake["manifest"].write_text(uv_line + node_line + uv_line)
    r = run_ctl(fake, "register")
    assert_refused(r, "toolchain-duplicate-entry")
    assert str(fake["tool"]) in r.stderr


# ---------------------------------------------------------------------------
# F2 (delta round) — the runner PATH is BOUND to the checksummed toolchain
#
# The gate hashes /…/toolchain/{uv,node}; a runner PATH of
# /usr/bin:/bin:/usr/sbin:/sbin cannot reach them, so the job runs different,
# unchecked binaries (or none). The PATH must be DERIVED from the validated
# manifest entries, and each required tool must RESOLVE to its manifest path.
# ---------------------------------------------------------------------------


def test_runner_path_leads_with_the_validated_toolchain_dir(fake):
    r = run_ctl(fake, "run-cycle")
    assert r.returncode == 0, r.stderr
    path = env_dumped(fake)["PATH"]
    assert path.split(":")[0] == str(fake["toolchain"]), (
        f"the manifest's toolchain dir must come FIRST on the runner PATH: {path}"
    )
    assert path.endswith(SYSTEM_PATH), f"the system path must remain the tail: {path}"


def test_register_refuses_when_a_gated_tool_does_not_resolve(fake):
    # The manifest still validates (hash matches, ownership and mode fine), but
    # `uv` is not executable, so nothing on the runner PATH resolves to the
    # gated absolute path. A gate over a binary the job cannot execute is
    # theatre: refuse, naming the tool.
    assert run_ctl(fake, "destroy-root").returncode == 0
    fake["tool"].chmod(0o444)
    try:
        r = run_ctl(fake, "register")
        assert_refused(r, "toolchain-path-unbound")
        assert "'uv'" in r.stderr, r.stderr
        assert str(fake["tool"]) in r.stderr, "the refusal must name the gated path"
        # The refusal fired BEFORE the marker was consumed.
        assert (fake["state"] / ".cleanup-verified").exists()
    finally:
        fake["tool"].chmod(0o555)


def test_register_refuses_a_decoy_shadowing_the_gated_tool(fake):
    # A manifest directory may hold binaries the manifest does NOT list. Here
    # `decoy/node` is gated (so `decoy/` legitimately joins the PATH, first),
    # and an UNLISTED `decoy/uv` sits beside it — shadowing the checksummed
    # `toolchain/uv`. The checksum gate alone passes; the binding assertion is
    # what catches it.
    assert run_ctl(fake, "destroy-root").returncode == 0
    decoy = fake["tmp"] / "decoy"
    decoy.mkdir()
    decoy_node = decoy / "node"
    decoy_node.write_text("#!/bin/sh\necho decoy-node\n")
    decoy_node.chmod(0o555)
    decoy_uv = decoy / "uv"
    decoy_uv.write_text("#!/bin/sh\necho DECOY UV — never checksummed\n")
    decoy_uv.chmod(0o555)
    fake["manifest"].write_text(
        f"{hashlib.sha256(decoy_node.read_bytes()).hexdigest()}  {decoy_node}\n"
        f"{hashlib.sha256(fake['tool'].read_bytes()).hexdigest()}  {fake['tool']}\n"
    )
    r = run_ctl(fake, "register")
    assert_refused(r, "toolchain-path-unbound")
    assert str(decoy_uv) in r.stderr, "the refusal must name what actually resolved"
    assert str(fake["tool"]) in r.stderr, "and the manifest path it should have been"


# ---------------------------------------------------------------------------
# F1 (delta round) — ownership of the writable root
#
# The controller creates and extracts RUNNER_ROOT with controller (root)
# authority, then runs config.sh/run.sh via `sudo -u $RUNNER_USER`. Without an
# ownership transfer the runner account cannot write its own workspace, HOME,
# or TMPDIR and a real first install fails — invisibly to a shim-based suite,
# because shims do not check ownership.
#
# SPLIT, deliberately: the chown CALL is observed through a chown shim (an
# unprivileged test process cannot chown to a foreign uid — that half is
# production-only), while the ASSERTIONS are driven through a stat shim, the
# same precedent as the toolchain owner-check branch.
# ---------------------------------------------------------------------------


def test_restore_image_transfers_root_ownership_to_the_runner_uid(fake):
    r = run_ctl(fake, "restore-image")
    assert r.returncode == 0, r.stderr
    lines = chown_logged(fake)
    assert lines == [f"-Rh 999999 {fake['root']}"], (
        f"restore-image must hand exactly the root to the runner uid: {lines}"
    )


def test_ownership_transfer_never_touches_the_base_or_the_state_dir(fake):
    # A runner-owned parent lets a job replace the root or the image; a
    # runner-owned state dir makes the cleanup-verified marker forgeable.
    r = run_ctl(fake, "run-cycle")
    assert r.returncode == 0, r.stderr
    for line in chown_logged(fake):
        target = line.rsplit(" ", 1)[-1]
        assert target != str(fake["base"]), f"base dir chowned: {line}"
        assert target != str(fake["state"]), f"state dir chowned: {line}"
        assert target.startswith(str(fake["root"])), f"chown escaped the root: {line}"


def test_register_refuses_when_the_active_root_is_not_runner_owned(fake):
    # The production failure this catches: the chown never happened (or failed
    # silently), so config.sh would run as a user that cannot write the tree.
    assert run_ctl(fake, "destroy-root").returncode == 0
    r = run_ctl(fake, "register", STAT_SHIM_UID="777777")
    assert_refused(r, "active-root-not-runner-owned")
    assert "777777" in r.stderr and "999999" in r.stderr
    # Fired before the marker was consumed: a corrected invocation still has
    # its verified-cleanup proof.
    assert (fake["state"] / ".cleanup-verified").exists()


def test_register_refuses_when_the_base_dir_is_runner_owned(fake):
    assert run_ctl(fake, "destroy-root").returncode == 0
    # Root AND base both read back as runner-owned: the root half passes, the
    # base half is the refusal.
    r = run_ctl(
        fake, "register", STAT_SHIM_PATH=f"{fake['root']}:{fake['base']}"
    )
    assert_refused(r, "base-dir-runner-owned")
    assert str(fake["base"]) in r.stderr


def test_register_refuses_when_the_state_dir_is_runner_owned(fake):
    # destroy-root runs with the default (honest) ownership view so the marker
    # exists; only the register invocation sees a runner-owned state dir.
    assert run_ctl(fake, "destroy-root").returncode == 0
    r = run_ctl(
        fake, "register", STAT_SHIM_PATH=f"{fake['root']}:{fake['state']}"
    )
    assert r.returncode != 0
    assert "state-dir-runner-owned" in r.stderr


# ---------------------------------------------------------------------------
# runner identity coherence (F7) — RUNNER_UID must BE RUNNER_USER's uid
# ---------------------------------------------------------------------------


def test_destroy_refuses_mismatched_uid_and_user(fake):
    # RUNNER_USER resolves (via the id shim) to a DIFFERENT uid than
    # RUNNER_UID: termination would target another account's processes. The
    # refusal must fire before ANY terminate/export/wipe.
    r = run_ctl(fake, "destroy-root", ID_SHIM_UID="888888")
    assert_refused(r, "runner-uid-mismatch")
    assert ops_logged(fake) == [], "no operation may run on a mismatched identity"
    assert (fake["root"] / "_work" / "leftover.txt").exists()
    assert not (fake["state"] / ".cleanup-verified").exists()


def test_destroy_refuses_runner_uid_zero(fake):
    r = run_ctl(fake, "destroy-root", RUNNER_UID="0", ID_SHIM_UID="0")
    assert_refused(r, "runner-uid-root")
    assert ops_logged(fake) == []


def test_destroy_refuses_runner_uid_equal_to_controller(fake):
    me = str(os.getuid())
    r = run_ctl(fake, "destroy-root", RUNNER_UID=me, ID_SHIM_UID=me)
    assert_refused(r, "runner-uid-is-controller")
    assert ops_logged(fake) == []


def test_register_refuses_mismatched_identity_and_preserves_marker(fake):
    assert run_ctl(fake, "destroy-root").returncode == 0
    r = run_ctl(fake, "register", ID_SHIM_UID="888888")
    assert_refused(r, "runner-uid-mismatch")
    # The refusal fired BEFORE the marker was consumed.
    assert (fake["state"] / ".cleanup-verified").exists()


def test_coherent_identity_proceeds(fake):
    # The fixture pair (RUNNER_UID=999999, RUNNER_USER resolving to 999999
    # via the id shim) is coherent: the full cycle runs to completion.
    r = run_ctl(fake, "run-cycle")
    assert r.returncode == 0, r.stderr


# ---------------------------------------------------------------------------
# token mint (F10) — real register path with PATH-shimmed curl + sudo
# ---------------------------------------------------------------------------

EXPECTED_MINT_URL = "https://api.github.com/repos/example/populus/actions/runners/registration-token"


def make_curl_shim(fake: dict, codes: str) -> dict:
    """Install a fake curl on PATH ahead of everything else.

    Logs its argv (one line per invocation) to CURL_LOG; returns the Nth code
    from ``codes`` per invocation (sticking on the last); on 201 writes a
    fixture token JSON to the ``-o`` file, on anything else an error body.
    Returns the env overrides for run_ctl.
    """
    curl_dir = fake["tmp"] / "curlshim"
    curl_dir.mkdir()
    shim = curl_dir / "curl"
    shim.write_text(
        "#!/bin/bash\n"
        'printf \'%s\\n\' "$*" >> "${CURL_LOG}"\n'
        'out=""\ncfg=""\nprev=""\n'
        'for a in "$@"; do\n'
        '  if [ "$prev" = "-o" ]; then out="$a"; fi\n'
        '  if [ "$prev" = "--config" ]; then cfg="$a"; fi\n'
        '  prev="$a"\n'
        "done\n"
        # F8 instrument: record the config file's mode + path, and its
        # content, at the moment curl sees it (it is removed after the call).
        'if [ -n "$cfg" ]; then\n'
        '  echo "$(stat -f %Lp "$cfg" 2>/dev/null || stat -c %a "$cfg") $cfg" >> "${CURL_CFG_LOG}"\n'
        '  cat "$cfg" >> "${CURL_CFG_CONTENT}"\n'
        "fi\n"
        "n=0\n"
        '[ -f "${CURL_STATE}" ] && n=$(cat "${CURL_STATE}")\n'
        'echo $((n+1)) > "${CURL_STATE}"\n'
        "set -- ${CURL_CODES}\n"
        "i=$((n+1)); [ $i -gt $# ] && i=$#\n"
        'eval "code=\\${$i}"\n'
        'if [ "$code" = "201" ]; then\n'
        f'  echo \'{{"token":"{MINTED_TOKEN}","expires_at":"2026-01-01T00:00:00Z"}}\' > "$out"\n'
        "else\n"
        '  echo \'{"message":"Bad credentials"}\' > "$out"\n'
        "fi\n"
        'printf \'%s\' "$code"\n'
    )
    shim.chmod(0o755)
    return {
        "PATH": f"{curl_dir}:{fake['env']['PATH']}",
        "CURL_LOG": str(fake["owner"] / "curl.log"),
        "CURL_CFG_LOG": str(fake["owner"] / "curl.cfg.log"),
        "CURL_CFG_CONTENT": str(fake["owner"] / "curl.cfg.content"),
        "CURL_STATE": str(fake["owner"] / "curl.state"),
        "CURL_CODES": codes,
        "DRY_RUN": "0",
    }


def curl_cfg_logged(fake: dict) -> list[str]:
    """(mode, path) tuples the curl shim recorded, one per invocation."""
    log = fake["owner"] / "curl.cfg.log"
    if not log.exists():
        return []
    return log.read_text().splitlines()


def curl_logged(fake: dict) -> list[str]:
    log = fake["owner"] / "curl.log"
    if not log.exists():
        return []
    return log.read_text().splitlines()


def test_real_register_mints_fresh_token_per_cycle(fake):
    assert run_ctl(fake, "destroy-root").returncode == 0
    r = run_ctl(fake, "register", **make_curl_shim(fake, "201"))
    assert r.returncode == 0, r.stderr
    # The mint: one POST to the registration-token endpoint, authorized by
    # the PAT read from the credential file — carried in the --config file,
    # NEVER on curl's argv (F8).
    mints = curl_logged(fake)
    assert len(mints) == 1, mints
    assert EXPECTED_MINT_URL in mints[0]
    assert "-X POST" in mints[0]
    assert "--config" in mints[0]
    assert CREDENTIAL not in mints[0], "PAT leaked into curl argv"
    cfg_content = (fake["owner"] / "curl.cfg.content").read_text()
    assert f'Authorization: Bearer {CREDENTIAL}' in cfg_content
    # The minted token reaches the config.sh invocation (via the sudo shim's
    # argv log), on argv — not in the env -i assignments.
    sudo_lines = sudo_logged(fake)
    assert len(sudo_lines) == 1, sudo_lines
    assert f"{fake['root']}/config.sh" in sudo_lines[0]
    assert f"--token {MINTED_TOKEN}" in sudo_lines[0]
    assert "--ephemeral" in sudo_lines[0]
    for assignment in re.findall(r"\S+=\S+", sudo_lines[0]):
        assert MINTED_TOKEN not in assignment, "token leaked into the runner env"
        assert CREDENTIAL not in assignment, "PAT leaked into the runner env"
    # The PAT never reaches the runner side at all.
    assert CREDENTIAL not in sudo_lines[0]
    # Neither token is written under the root or echoed by the controller.
    for p in fake["root"].rglob("*"):
        if p.is_file():
            text = p.read_text(errors="replace")
            assert MINTED_TOKEN not in text, p
            assert CREDENTIAL not in text, p
    assert MINTED_TOKEN not in r.stdout + r.stderr
    assert CREDENTIAL not in r.stdout + r.stderr


# ---------------------------------------------------------------------------
# R3 — registration is idempotent against a runner name that is already
# claimed. The runner name is fixed, and an ephemeral runner that died without
# deregistering (crash, reboot, cancelled job) leaves it claimed on the GitHub
# side. Without --replace, config.sh then refuses and EVERY later cycle fails
# until someone deletes the runner in the web UI.
# ---------------------------------------------------------------------------


def test_registration_passes_replace(fake):
    assert run_ctl(fake, "destroy-root").returncode == 0
    r = run_ctl(fake, "register", **make_curl_shim(fake, "201"))
    assert r.returncode == 0, r.stderr
    (invocation,) = sudo_logged(fake)
    assert "--replace" in invocation, (
        "config.sh must be invoked with --replace or a stale runner name "
        f"bricks every cycle: {invocation}"
    )


def test_registration_succeeds_against_a_pre_existing_runner(fake):
    # Behavioral, not argv-shaped: a config.sh stub that reproduces GitHub's
    # actual behaviour — the name is taken, so it FAILS unless --replace is
    # given — must be driven to success by the controller as it really runs.
    assert run_ctl(fake, "destroy-root").returncode == 0
    config_log = fake["owner"] / "configsh.log"
    config = fake["root"] / "config.sh"
    config.write_text(
        "#!/bin/bash\n"
        "# Stands in for a config.sh whose runner name is already registered.\n"
        "for a in \"$@\"; do\n"
        '  if [ "$a" = "--replace" ]; then\n'
        f'    printf \'replaced\\n\' >> "{config_log}"\n'
        "    exit 0\n"
        "  fi\n"
        "done\n"
        f'printf \'name-taken\\n\' >> "{config_log}"\n'
        "exit 1\n"
    )
    config.chmod(0o755)

    # A sudo shim that actually EXECUTES, so config.sh runs for real. The
    # non-executing shim used elsewhere could never catch this defect.
    exec_shims = fake["tmp"] / "execshims"
    exec_shims.mkdir()
    exec_sudo = exec_shims / "sudo"
    exec_sudo.write_text(
        "#!/bin/bash\n"
        'printf \'%s\\n\' "$*" >> "${SUDO_LOG}"\n'
        '[ "${1:-}" = "-u" ] && shift 2\n'   # drop the privilege transition
        'exec "$@"\n'
    )
    exec_sudo.chmod(0o755)

    overrides = make_curl_shim(fake, "201")
    overrides["PATH"] = f"{exec_shims}:{overrides['PATH']}"
    r = run_ctl(fake, "register", **overrides)

    assert config_log.read_text().splitlines() == ["replaced"], (
        "config.sh either never ran or ran without --replace"
    )
    assert r.returncode == 0, f"registration must survive a claimed name: {r.stderr}"


def test_the_pre_existing_runner_stub_actually_discriminates(fake):
    # Control for the test above: prove the stub FAILS without --replace, so
    # its success there is evidence about the controller and not about a stub
    # that exits 0 regardless.
    config_log = fake["owner"] / "control.log"
    config = fake["tmp"] / "config-control.sh"
    config.write_text(
        "#!/bin/bash\n"
        "for a in \"$@\"; do\n"
        '  if [ "$a" = "--replace" ]; then\n'
        f'    printf \'replaced\\n\' >> "{config_log}"\n'
        "    exit 0\n"
        "  fi\n"
        "done\n"
        f'printf \'name-taken\\n\' >> "{config_log}"\n'
        "exit 1\n"
    )
    config.chmod(0o755)
    without = subprocess.run([str(config), "--unattended", "--ephemeral"])
    assert without.returncode == 1, "the stub must refuse a claimed name"
    with_replace = subprocess.run([str(config), "--unattended", "--replace"])
    assert with_replace.returncode == 0


def test_real_register_retries_once_on_401_then_succeeds(fake):
    # Expired/rejected-once recovery: the first mint 401s, the retry 201s,
    # and registration proceeds with the retried token.
    assert run_ctl(fake, "destroy-root").returncode == 0
    r = run_ctl(fake, "register", **make_curl_shim(fake, "401 201"))
    assert r.returncode == 0, r.stderr
    assert len(curl_logged(fake)) == 2, "expected exactly one retry"
    sudo_lines = sudo_logged(fake)
    assert len(sudo_lines) == 1 and f"--token {MINTED_TOKEN}" in sudo_lines[0]


def test_real_register_refuses_persistent_401(fake):
    assert run_ctl(fake, "destroy-root").returncode == 0
    r = run_ctl(fake, "register", **make_curl_shim(fake, "401 401"))
    assert_refused(r, "registration-token-denied")
    assert len(curl_logged(fake)) == 2, "exactly one retry, then refuse"
    # config.sh was never invoked without a token.
    assert not any("config.sh" in line for line in sudo_logged(fake))


# ---------------------------------------------------------------------------
# PAT off argv (F8) — the credential travels via a curl --config file only
# ---------------------------------------------------------------------------


def test_pat_never_in_curl_argv_and_config_file_hygiene(fake):
    assert run_ctl(fake, "destroy-root").returncode == 0
    r = run_ctl(fake, "register", **make_curl_shim(fake, "201"))
    assert r.returncode == 0, r.stderr
    mints = curl_logged(fake)
    assert len(mints) == 1, mints
    # Argv carries NO credential material — no PAT, no Bearer header at all —
    # only the config-file flag and its path.
    assert CREDENTIAL not in mints[0], "PAT visible to process-argument inspection"
    assert "Bearer" not in mints[0]
    assert "--config" in mints[0]
    # The config file: mode 0600, outside the runner root, and the actual
    # carrier of the Authorization header.
    cfgs = curl_cfg_logged(fake)
    assert len(cfgs) == 1, cfgs
    mode, cfg_path = cfgs[0].split(" ", 1)
    assert mode == "600", f"curl config must be 0600, got {mode}"
    assert not cfg_path.startswith(str(fake["root"])), (
        "curl config must live outside the runner root"
    )
    assert f"Authorization: Bearer {CREDENTIAL}" in (
        fake["owner"] / "curl.cfg.content"
    ).read_text()
    # Removed after the call (success path).
    assert not Path(cfg_path).exists(), "curl config must be removed after the mint"


def test_curl_config_removed_on_failure_path(fake):
    assert run_ctl(fake, "destroy-root").returncode == 0
    r = run_ctl(fake, "register", **make_curl_shim(fake, "401 401"))
    assert_refused(r, "registration-token-denied")
    cfgs = curl_cfg_logged(fake)
    assert cfgs, "the shim saw no config file"
    for line in cfgs:
        _, cfg_path = line.split(" ", 1)
        assert not Path(cfg_path).exists(), (
            "curl config must be removed on the refusal path too"
        )


# ---------------------------------------------------------------------------
# export verification (F11) — a failed export refuses the wipe
# ---------------------------------------------------------------------------


def test_unwritable_export_destination_refuses_and_root_survives(fake):
    logs_dir = fake["owner"] / "logs"
    logs_dir.chmod(0o555)
    try:
        r = run_ctl(fake, "destroy-root")
        assert_refused(r, "log-export-failed")
        # The root SURVIVES untouched: the wipe must not destroy the only
        # copies of logs that were never exported.
        assert (fake["root"] / "_diag" / "job.log").read_text() == (
            "diagnostics from the last job\n"
        )
        assert (fake["root"] / "_work" / "leftover.txt").exists()
        # And no marker: an aborted destroy certifies nothing.
        assert not (fake["state"] / ".cleanup-verified").exists()
        ops = ops_logged(fake)
        assert "wipe" not in ops, f"wipe ran after a failed export: {ops}"
    finally:
        logs_dir.chmod(0o755)


# ---------------------------------------------------------------------------
# termination verification (F12) — survivors refuse destruction, by PID
# ---------------------------------------------------------------------------


def make_pgrep_shim(fake: dict, pids: str) -> dict:
    """Install a fake pgrep ahead of the system one.

    With PGREP_PIDS set it prints them and exits 0 (survivors); with it empty
    it exits 1 (pgrep's documented no-match status). Tests cannot spawn
    processes as another UID, so the verification probe is shimmed while the
    real control flow around it runs.
    """
    pgrep_dir = fake["tmp"] / "pgrepshim"
    pgrep_dir.mkdir()
    shim = pgrep_dir / "pgrep"
    shim.write_text(
        "#!/bin/bash\n"
        'if [ -n "${PGREP_PIDS:-}" ]; then printf \'%s\\n\' ${PGREP_PIDS}; exit 0; fi\n'
        "exit 1\n"
    )
    shim.chmod(0o755)
    return {"PATH": f"{pgrep_dir}:{fake['env']['PATH']}", "PGREP_PIDS": pids}


def test_surviving_runner_processes_refuse_destruction(fake):
    r = run_ctl(fake, "destroy-root", **make_pgrep_shim(fake, "4242 4343"))
    assert_refused(r, "runner-processes-survive")
    assert "4242" in r.stderr and "4343" in r.stderr, (
        f"surviving PIDs must be named: {r.stderr!r}"
    )
    # Refusal happened BEFORE export/wipe: the root is untouched, no marker.
    assert (fake["root"] / "_work" / "leftover.txt").exists()
    assert not (fake["state"] / ".cleanup-verified").exists()
    ops = ops_logged(fake)
    assert "wipe" not in ops and "export-logs" not in ops


def test_empty_process_set_proceeds(fake):
    r = run_ctl(fake, "destroy-root", **make_pgrep_shim(fake, ""))
    assert r.returncode == 0, r.stderr
    assert (fake["state"] / ".cleanup-verified").exists()


# ---------------------------------------------------------------------------
# credential isolation — never in the runner env, never under the root
# ---------------------------------------------------------------------------


def test_credential_absent_from_runner_env_and_root(fake):
    r = run_ctl(fake, "run-cycle")
    assert r.returncode == 0, r.stderr
    # The constructed runner environment, dumped by the DRY_RUN register path.
    env_dump = (fake["owner"] / "env.dump").read_text()
    assert CREDENTIAL not in env_dump
    assert "CONTROLLER_CREDENTIAL_FILE" not in env_dump
    # Nowhere under the reconstructed root either.
    for p in fake["root"].rglob("*"):
        if p.is_file():
            assert CREDENTIAL not in p.read_text(errors="replace"), p
    # And never on the controller's own stdout/stderr.
    assert CREDENTIAL not in r.stdout + r.stderr


# ---------------------------------------------------------------------------
# supplemental static assertions (never the primary evidence — R7d)
# ---------------------------------------------------------------------------


def test_script_sets_strict_mode():
    text = SCRIPT.read_text()
    assert "set -euo pipefail" in text


def test_script_has_no_unconfined_rm(fake):
    # No `rm -rf /` and no `rm -rf` on a bare variable: the wipe primitive is
    # find -mindepth 1 -delete on the VALIDATED target. The only rm uses are
    # -f on the marker file and the mint's controller-domain temp body.
    text = SCRIPT.read_text()
    assert "rm -rf /" not in text
    assert not re.search(r"rm\s+-rf?\s+\"?\$", text), "rm -rf on a variable is forbidden"


def test_credential_path_never_echoed():
    # No echo/printf line may reference the credential file or a token
    # variable — the credential flows only to the mint request and the minted
    # token only to the registration command line.
    for line in SCRIPT.read_text().splitlines():
        if re.match(r"\s*(echo|printf)\b", line):
            assert "CONTROLLER_CREDENTIAL_FILE" not in line
            assert "token" not in line.lower()


def test_script_is_executable():
    assert os.access(SCRIPT, os.X_OK), "controller must be executable for launchd"


# ---------------------------------------------------------------- F4: proof-state domain

def test_state_dir_unset_refuses(fake):
    """No CONTROLLER_STATE_DIR => no lock, no marker, no run — fail closed."""
    r = run_ctl(fake, "destroy-root", CONTROLLER_STATE_DIR=None)
    assert r.returncode != 0
    assert "state-dir-unset" in r.stderr
    assert (fake["base"] / "root" / "_diag" / "job.log").exists(), "root untouched"


def test_state_dir_under_base_refuses(fake):
    """Proof state under RUNNER_BASE_DIR is exactly the forgeable layout F4 bans."""
    inside = fake["base"] / "state-inside"
    inside.mkdir(mode=0o700)
    r = run_ctl(fake, "destroy-root", CONTROLLER_STATE_DIR=str(inside))
    assert r.returncode != 0
    assert "state-dir-under-base" in r.stderr


def test_state_dir_group_writable_refuses(fake):
    fake["state"].chmod(0o770)
    r = run_ctl(fake, "destroy-root")
    assert r.returncode != 0
    assert "state-dir-writable" in r.stderr
