#!/usr/bin/env python3
"""External heartbeat monitor (ARCHITECTURE.md §13.2) — the Mac mini consumer.

A §5.5 protocol-conformant consumer: resolve ``latest.json`` → evaluate the
pointer state machine against the durably persisted two-field tuple on this
machine's disk → authenticate the manifest → fetch the manifest-listed
``stats.json`` → verify its SHA-256 → evaluate build age (>36 h), watermark
freshness, and consecutive-failure count. An unchanged current pointer is an
idempotent PASS that still proceeds through the manifest and stats checks —
sameness short-circuits nothing but the version branch.

Trust state is load-bearing: a missing or corrupt tuple FAILS CLOSED (exit 2)
— restore the backed-up tuple or pin a trusted floor per the §13.5 runbook;
the monitor never silently re-bootstraps trust. A higher pointer is persisted
as the future baseline only after the full manifest/artifact/stats check
succeeds; on any failure the old tuple is preserved.

Exit codes: 0 = pass · 1 = alarm/failure (tuple preserved) · 2 = fail-closed
(missing/corrupt trust state).

The library core is importable (``run_monitor``) and clock-free; ``main``
owns the wall clock, the token env, and the Discord transport.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "src"))

from populus.client.snapshot import FetchError, Fetcher  # noqa: E402
from populus.publish.attestation import (  # noqa: E402
    AttestationProvider,
    StagingNoop,
)
from populus.publish.manifest import (  # noqa: E402
    MODULE,
    pointer_manifest_identity_error,
    validate_manifest,
)
from populus.publish.pointer import (  # noqa: E402
    TrustTupleError,
    evaluate_pointer,
    load_tuple,
    parse_rfc3339z,
    persist_tuple,
)

BUILD_AGE_LIMIT = timedelta(hours=36)
CONSECUTIVE_FAILURE_ALARM = 2
STATS_ARTIFACT = "congress/stats.json"

TUPLE_FILE = "pointer-tuple.json"
FAILURES_FILE = "failures"


def check_immutable_releases_stub() -> str:
    """§13.2 setting-drift check — STUB until the Administration:read PAT
    exists (§14 secret 4, P-setup). Returns the honest status string; the
    real implementation queries the repository-settings API and alarms if
    immutable releases ever flips off."""
    return "unchecked (stub: requires the Administration:read PAT, §14)"


def _read_failures(path: Path) -> int:
    try:
        return int(path.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return 0


def _write_failures(path: Path, count: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{count}\n", encoding="utf-8")


def run_monitor(
    state_dir: Path | str,
    fetcher: Fetcher,
    *,
    now: Callable[[], datetime],
    alert: Callable[[str], None],
    attestation: AttestationProvider | None = None,
) -> int:
    """One monitor poll; see the module docstring for the contract."""
    state_dir = Path(state_dir)
    attestation = attestation or StagingNoop()
    tuple_path = state_dir / TUPLE_FILE
    failures_path = state_dir / FAILURES_FILE

    # Owned-file tamper check (R29 / §14 boundary): the configured state_dir root
    # is a trusted operator input, but the tuple + failures files Populus OWNS
    # AND CREATES under it must be real files, not symlinks swapped in to
    # redirect a write. Fail closed if either is a symlink.
    for owned in (tuple_path, failures_path):
        if owned.is_symlink():
            alert(
                f"monitor state file {owned.name} is a symlink — failing closed"
                " (§13.5); a Populus-owned state file must not be a symlink"
            )
            return 2

    # Trust state first: missing or corrupt ⇒ fail closed, never bootstrap.
    try:
        trust = load_tuple(tuple_path)
    except TrustTupleError as exc:
        alert(f"monitor trust tuple corrupt — failing closed (§13.5): {exc}")
        return 2
    if trust is None:
        alert(
            "monitor trust tuple missing — failing closed; restore the backup"
            " or pin a trusted floor (§13.5), never delete the tuple to clear"
            " an alarm"
        )
        return 2

    failures = _read_failures(failures_path)

    def _fail(message: str) -> int:
        count = failures + 1
        _write_failures(failures_path, count)
        if count >= CONSECUTIVE_FAILURE_ALARM:
            alert(f"monitor: {count} consecutive failures — latest: {message}")
        return 1

    def _alarm(message: str) -> int:
        _write_failures(failures_path, 0)
        alert(f"monitor alarm: {message}")
        return 1

    try:
        pointer_bytes = fetcher.fetch_path("latest.json")
    except FetchError as exc:
        return _fail(f"pointer fetch failed: {exc}")

    moment = now()
    decision = evaluate_pointer(
        pointer_bytes, now=moment, trust=trust, attestation=attestation
    )
    if decision.status == "replay":
        return _alarm(
            "pointer replay: " + "; ".join(decision.errors)
        )
    if decision.status == "equivocation":
        return _alarm(
            "pointer EQUIVOCATION (publisher error or compromise): "
            + "; ".join(decision.errors)
        )
    if decision.status not in ("idempotent", "install"):
        return _fail(f"pointer {decision.status}: " + "; ".join(decision.errors))
    pointer = decision.pointer

    # The monitor never ends early: an equal-pointer idempotent pass still
    # proceeds through the manifest and stats checks.
    try:
        manifest_bytes = fetcher.fetch_path(pointer["manifest_path"])
    except FetchError as exc:
        return _fail(f"manifest fetch failed: {exc}")
    if sha256(manifest_bytes).hexdigest() != pointer["manifest_sha256"]:
        return _fail("manifest bytes do not hash to the pointer's manifest_sha256")
    verdict = attestation.verify("manifest.json", manifest_bytes)
    if not verdict.ok:
        return _fail(f"manifest attestation rejected: {verdict.detail}")
    try:
        manifest = json.loads(manifest_bytes.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        return _fail(f"manifest unparseable: {exc}")
    manifest_errors = validate_manifest(manifest)
    if manifest_errors:
        return _fail("manifest invalid: " + "; ".join(manifest_errors))
    identity_error = pointer_manifest_identity_error(manifest, pointer["build_id"])
    if identity_error is not None:
        return _fail(identity_error)

    module = manifest["modules"][MODULE]
    stats_entry = next(
        (
            entry
            for entry in module["artifacts"]
            if entry["name"] == STATS_ARTIFACT and entry.get("path") is not None
        ),
        None,
    )
    if stats_entry is None:
        return _fail(f"manifest lists no {STATS_ARTIFACT} path artifact")
    try:
        stats_bytes = fetcher.fetch_path(stats_entry["path"])
    except FetchError as exc:
        return _fail(f"stats fetch failed: {exc}")
    if (
        len(stats_bytes) != stats_entry["bytes"]
        or sha256(stats_bytes).hexdigest() != stats_entry["sha256"]
    ):
        return _fail("stats.json does not match its manifest-listed sha256/bytes")
    # A manifest-consistent stats.json can still be malformed (bad JSON, or a
    # non-object root) — that is a monitored FAILURE, never an uncaught
    # traceback that skips the failure counter and the second-failure alert
    # (R17/R28/F3).
    try:
        stats = json.loads(stats_bytes.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        return _fail(f"stats.json is not valid JSON: {exc}")
    if not isinstance(stats, dict):
        return _fail("stats.json is not a JSON object")

    # Build age (>36 h) and watermark freshness against the manifest.
    created_at = parse_rfc3339z(manifest["created_at"])
    if moment - created_at > BUILD_AGE_LIMIT:
        return _alarm(
            f"build {manifest['build_id']} is older than 36h"
            f" (created {manifest['created_at']})"
        )
    # Freshness evidence must be PRESENT and structurally valid — absent or
    # malformed evidence fails closed, never compares None == None as "fresh"
    # (R3/R17/F12).
    freshness = stats.get("freshness")
    if not isinstance(freshness, dict):
        return _alarm("stats.json carries no valid freshness object")
    watermark_pairs = (
        ("house_index_last_modified", "house_index_last_modified"),
        ("senate_max_filed_date", "senate_db_max_filed_date"),
    )
    watermarks = module["watermarks"]
    for manifest_key, stats_key in watermark_pairs:
        if manifest_key not in watermarks or stats_key not in freshness:
            return _alarm(
                "missing freshness evidence: manifest watermark"
                f" {manifest_key!r} or stats.json freshness {stats_key!r} is"
                " absent — failing closed rather than passing as fresh"
            )
        if watermarks[manifest_key] != freshness[stats_key]:
            return _alarm(
                f"watermark {manifest_key} lags/disagrees between the manifest"
                f" ({watermarks[manifest_key]!r}) and stats.json"
                f" ({freshness[stats_key]!r})"
            )

    # Setting drift (immutable releases) — stub until the PAT exists.
    check_immutable_releases_stub()

    # Full check passed: only now does a higher pointer become the baseline.
    if decision.status == "install":
        persist_tuple(
            tuple_path, pointer["pointer_version"], decision.pointer_sha256
        )
    _write_failures(failures_path, 0)
    return 0


def _discord_alert(message: str) -> None:
    """stderr always; Discord webhook when DISCORD_WEBHOOK_URL is set."""
    import os

    print(f"ALERT: {message}", file=sys.stderr)
    webhook = os.environ.get("DISCORD_WEBHOOK_URL")
    if webhook:
        import httpx

        try:
            httpx.post(webhook, json={"content": f"populus-monitor: {message}"})
        except httpx.HTTPError as exc:
            print(f"ALERT DELIVERY FAILED: {type(exc).__name__}", file=sys.stderr)


def _attestation_provider(choice: str):
    """Build the provider the operator selected. Never guesses."""
    from populus.publish.attestation import build_provider

    return build_provider(choice)


def main(argv: list[str] | None = None) -> int:
    import os

    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--state-dir",
        required=True,
        help="Durable monitor state (trust tuple + failure counter).",
    )
    parser.add_argument(
        "--repo",
        required=True,
        help="OWNER/REPO of the private populus-data staging repo.",
    )
    parser.add_argument(
        "--attestation",
        required=True,
        choices=("sigstore", "staging-noop"),
        help="Which attestation provider verifies the pointer and manifest. "
             "Required: the monitor is a §5.5 consumer like any other, and a "
             "silently unverified monitor is worse than none.",
    )
    args = parser.parse_args(argv)
    token = os.environ.get("GH_TOKEN")
    if not token:
        print("GH_TOKEN is required (fine-grained PAT, §14)", file=sys.stderr)
        return 2
    from populus.client.snapshot import GitHubRepoFetcher

    fetcher = GitHubRepoFetcher(args.repo, token)
    return run_monitor(
        args.state_dir,
        fetcher,
        now=lambda: datetime.now(timezone.utc),
        alert=_discord_alert,
        attestation=_attestation_provider(args.attestation),
    )


if __name__ == "__main__":
    sys.exit(main())
