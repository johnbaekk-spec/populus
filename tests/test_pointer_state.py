"""Pointer state machine, snapshot client, fetchers, monitor (RUN 5; R6–R8,
R14, R17, R20, R22, R24, R27–R28).

Every §17 fixture is here: (g) equal-but-expired ⇒ stale, (h) future-issued ⇒
reject, (i) state-loss bootstrap (client TOFU / monitor fail-closed),
equivocation, replay, authorized rollback, tampered-byte with the prior cache
retained. Client crash recovery is exercised by constructing a FRESH
SnapshotClient over the on-disk state left at each boundary — no in-memory
carryover, the process-restart semantics.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
import subprocess  # nosec B404 — real interpreter restart for R24/F11, argv only
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent

from test_publish import (
    NOW,
    SpyAttestation,
    latest_pointer,
    make_repo,
    mutate_db,
    pin,
    publish_build,
    seed_db,
)

from populus.client.snapshot import (
    FetchError,
    GitHubRepoFetcher,
    LocalRepoFetcher,
    SnapshotClient,
)
from populus.publish.attestation import StagingNoop
from populus.publish.build import LocalDirBackend, run_publish
from populus.publish.pointer import (
    TrustTupleError,
    build_pointer,
    evaluate_pointer,
    load_tuple,
    persist_tuple,
    render_pointer,
    validate_pointer,
)


def _load_monitor():
    """scripts/monitor.py is a standalone script, loaded by path (the
    repository's script-module pattern, like dep_guard)."""
    import importlib.util

    repo_root = Path(__file__).resolve().parent.parent
    spec = importlib.util.spec_from_file_location(
        "populus_monitor", repo_root / "scripts" / "monitor.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


monitor = _load_monitor()
run_monitor = monitor.run_monitor

NOOP = StagingNoop()


def make_pointer_bytes(
    *,
    version: int = 1,
    build_id: str = "20260722.1",
    issued: datetime | None = None,
    manifest_sha256: str = "ab" * 32,
    mutate=None,
) -> bytes:
    pointer = build_pointer(
        pointer_version=version,
        issued_at=issued or (NOW - timedelta(hours=1)),
        build_id=build_id,
        manifest_sha256=manifest_sha256,
    )
    if mutate is not None:
        mutate(pointer)
    return render_pointer(pointer).encode("utf-8")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# --- validate_pointer / the trust tuple --------------------------------------


def test_validate_pointer_accepts_the_settled_schema():
    pointer = json.loads(make_pointer_bytes())
    assert validate_pointer(pointer) == []
    assert pointer["expires_at"] == "2026-07-30T11:00:00Z"  # +7d (R6)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda p: p.pop("pointer_version"),
        lambda p: p.update(extra_field=1),
        lambda p: p.update(pointer_version="7"),
        lambda p: p.update(pointer_version=0),
        lambda p: p.update(pointer_version=True),
        lambda p: p.update(issued_at="2026-07-23T11:00:00+00:00"),  # offset ≠ Z
        lambda p: p.update(issued_at="2026-07-23T11:00:00.123Z"),  # fractional
        lambda p: p.update(build_id="2026-07-22.1"),
        lambda p: p.update(manifest_path="builds/20260799.9/manifest.json"),
        lambda p: p.update(manifest_sha256="XY" * 32),
        lambda p: p.update(expires_at="2026-07-22T10:00:00Z"),  # before issued
        # R6: exactly +7 days — a shorter or longer window is rejected (F6).
        lambda p: p.update(expires_at="2026-07-29T11:00:00Z"),  # +6d (short)
        lambda p: p.update(expires_at="2026-07-31T11:00:00Z"),  # +8d (long)
    ],
)
def test_validate_pointer_rejects_schema_violations(mutate):
    pointer = json.loads(make_pointer_bytes())
    mutate(pointer)
    assert validate_pointer(pointer) != []


def test_trust_tuple_round_trip_and_exact_two_fields(tmp_path):
    path = tmp_path / "trust.json"
    assert load_tuple(path) is None
    persist_tuple(path, 7, "cd" * 32)
    assert load_tuple(path) == (7, "cd" * 32)
    document = json.loads(path.read_text(encoding="utf-8"))
    assert set(document) == {"pointer_version", "pointer_sha256"}  # exactly two
    assert path.read_text(encoding="utf-8").endswith("\n")


@pytest.mark.parametrize(
    "content",
    [
        "garbage",
        json.dumps({"pointer_version": 1}),
        json.dumps({"pointer_version": 1, "pointer_sha256": "zz"}),
        json.dumps({"pointer_version": 1, "pointer_sha256": "ab" * 32, "x": 1}),
        json.dumps({"pointer_version": "1", "pointer_sha256": "ab" * 32}),
        # A zero or negative version is corrupt state, not a low trusted
        # floor (F8) — it must raise, so the monitor fails closed.
        json.dumps({"pointer_version": 0, "pointer_sha256": "ab" * 32}),
        json.dumps({"pointer_version": -5, "pointer_sha256": "ab" * 32}),
        json.dumps({"pointer_version": True, "pointer_sha256": "ab" * 32}),
    ],
)
def test_trust_tuple_corruption_raises(tmp_path, content):
    path = tmp_path / "trust.json"
    path.write_text(content, encoding="utf-8")
    with pytest.raises(TrustTupleError):
        load_tuple(path)


# --- evaluate_pointer: universal checks first, then the four-way branch ------


def test_universal_checks_precede_version_branch():
    trust = (1, sha(make_pointer_bytes()))
    # (g) Equal version, identical bytes, but EXPIRED: stale, never idempotent.
    expired = make_pointer_bytes(issued=NOW - timedelta(days=8))
    decision = evaluate_pointer(
        expired, now=NOW, trust=(1, sha(expired)), attestation=NOOP
    )
    assert decision.status == "stale"
    # (h) Future-issued beyond skew.
    future = make_pointer_bytes(issued=NOW + timedelta(hours=1))
    decision = evaluate_pointer(future, now=NOW, trust=trust, attestation=NOOP)
    assert decision.status == "future_issued"
    # Within the small skew is accepted.
    near = make_pointer_bytes(issued=NOW + timedelta(seconds=60))
    decision = evaluate_pointer(near, now=NOW, trust=None, attestation=NOOP)
    assert decision.status == "bootstrap"
    # Schema-invalid.
    decision = evaluate_pointer(b"not json", now=NOW, trust=trust, attestation=NOOP)
    assert decision.status == "invalid"
    # Attestation seam runs before the version branch (R20).
    spy = SpyAttestation(fail_verify={"latest.json"})
    decision = evaluate_pointer(
        make_pointer_bytes(), now=NOW, trust=trust, attestation=spy
    )
    assert decision.status == "attestation_rejected"
    assert ("verify", "latest.json") in spy.calls


def test_version_branch_four_ways():
    current = make_pointer_bytes(version=5)
    trust = (5, sha(current))
    lower = make_pointer_bytes(version=4)
    assert (
        evaluate_pointer(lower, now=NOW, trust=trust, attestation=NOOP).status
        == "replay"
    )
    assert (
        evaluate_pointer(current, now=NOW, trust=trust, attestation=NOOP).status
        == "idempotent"
    )
    different = make_pointer_bytes(version=5, manifest_sha256="cd" * 32)
    assert (
        evaluate_pointer(different, now=NOW, trust=trust, attestation=NOOP).status
        == "equivocation"
    )
    higher = make_pointer_bytes(version=6)
    assert (
        evaluate_pointer(higher, now=NOW, trust=trust, attestation=NOOP).status
        == "install"
    )


def test_no_tuple_is_bootstrap():
    decision = evaluate_pointer(
        make_pointer_bytes(), now=NOW, trust=None, attestation=NOOP
    )
    assert decision.status == "bootstrap"


# --- the snapshot client (R8/R22/R24) ----------------------------------------


@pytest.fixture
def served(tmp_path):
    """A published local repo + a client cache root."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    report = publish_build(db, repo)
    cache = tmp_path / "cache"
    return db, repo, cache, report.build_id


def make_client(cache, repo, *, moment=NOW, **kwargs):
    return SnapshotClient(
        cache, LocalRepoFetcher(repo), now=pin(moment), **kwargs
    )


@pytest.mark.parametrize(
    "bad_module",
    [
        "/abs",          # absolute
        "..",            # traversal
        "../evil",       # traversal + separator
        "a/b",           # separator
        "a\\b",          # backslash separator
        "Congress",      # uppercase (not the grammar)
        "",              # empty
        "1leading",      # must start with a letter
        "has space",     # space
        "x" * 65,        # too long (>64)
    ],
)
def test_client_rejects_bad_module_name_at_construction(tmp_path, bad_module):
    """F2: `module` becomes a cache directory name — a non-identifier (absolute,
    traversal, separator, …) is rejected at construction with ValueError, and
    nothing is created (the cache root is not even touched)."""
    cache = tmp_path / "cache"
    with pytest.raises(ValueError, match="not a valid module name"):
        SnapshotClient(cache, LocalRepoFetcher(tmp_path), now=pin(), module=bad_module)
    assert not cache.exists()  # validation precedes any filesystem creation
    assert not (tmp_path / "abs").exists()
    assert not (tmp_path / "evil").exists()


def test_client_rejects_symlinked_module_dir_escape(tmp_path):
    """F2: even a grammar-valid module whose `cache_root/<module>` is a symlink
    escaping the realpath'd cache root is refused at construction — nothing is
    created through the link."""
    cache = tmp_path / "cache"
    cache.mkdir()
    external = tmp_path / "external"
    external.mkdir()
    (cache / "congress").symlink_to(external, target_is_directory=True)
    with pytest.raises(ValueError, match="escapes"):
        SnapshotClient(cache, LocalRepoFetcher(tmp_path), now=pin())
    assert list(external.iterdir()) == []  # nothing created through the symlink


def test_client_install_layout_perms_and_tuple(served):
    _db, repo, cache, build_id = served
    client = make_client(cache, repo)
    result = client.refresh()
    assert result.status == "installed"
    assert result.build_id == build_id
    module_dir = cache / "congress"
    build_dir = module_dir / build_id
    assert (build_dir / "congress.db").is_file()
    assert (build_dir / "manifest.json").is_file()
    assert stat.S_IMODE(os.stat(module_dir).st_mode) == 0o700
    assert stat.S_IMODE(os.stat(build_dir).st_mode) == 0o700
    assert stat.S_IMODE(os.stat(build_dir / "congress.db").st_mode) == 0o600
    trust = json.loads((module_dir / "trust.json").read_text(encoding="utf-8"))
    assert set(trust) == {"pointer_version", "pointer_sha256"}  # two-field (R7)
    assert client.current_build() == build_id
    assert client.db_path() == build_dir / "congress.db"


def test_client_unchanged_repoll_is_idempotent(served):
    _db, repo, cache, build_id = served
    client = make_client(cache, repo)
    assert client.refresh().status == "installed"
    tuple_before = (cache / "congress" / "trust.json").read_bytes()
    result = client.refresh()
    assert result.status == "idempotent"
    assert result.build_id == build_id
    assert (cache / "congress" / "trust.json").read_bytes() == tuple_before


def test_client_follows_second_publish_without_mixing_builds(served, tmp_path):
    db, repo, cache, first_build = served
    client = make_client(cache, repo)
    client.refresh()
    first_feed = cache / "congress" / first_build / "congress" / "feed.json"
    first_feed_sha = sha(first_feed.read_bytes())

    mutate_db(db)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    later = NOW + timedelta(days=1, hours=1)
    result = make_client(cache, repo, moment=later).refresh()
    assert result.status == "installed"
    second_build = result.build_id
    assert second_build != first_build
    # Identity-scoped cache: builds never mix; the prior build is untouched.
    assert (cache / "congress" / second_build / "congress" / "feed.json").is_file()
    assert sha(first_feed.read_bytes()) == first_feed_sha
    assert load_tuple(cache / "congress" / "trust.json")[0] == 2


def test_client_tamper_detected_prior_cache_and_tuple_retained(served):
    db, repo, cache, first_build = served
    client = make_client(cache, repo)
    client.refresh()
    tuple_before = load_tuple(cache / "congress" / "trust.json")

    mutate_db(db)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    second_build = latest_pointer(repo)["build_id"]
    target = repo / "builds" / second_build / "congress" / "feed.json"
    target.write_bytes(target.read_bytes().replace(b"NVDA", b"XVDA", 1))

    result = make_client(cache, repo, moment=NOW + timedelta(days=1)).refresh()
    assert result.status == "refused"
    assert "untouched" in result.message
    fresh = make_client(cache, repo, moment=NOW + timedelta(days=1))
    assert fresh.current_build() == first_build
    assert load_tuple(cache / "congress" / "trust.json") == tuple_before
    assert not (cache / "congress" / second_build).exists()
    assert not list((cache / "congress").glob(".tmp-*"))


def test_client_refuses_hash_consistent_corrupt_db_prior_cache_intact(served):
    """F4: a database whose bytes hash to the manifest but is NOT a valid SQLite
    file fails PRAGMA integrity_check inside install. The refusal is clean —
    temp install removed, prior cache + trust tuple untouched, last verified
    build keeps serving (R8/R14). Before the fix, sqlite3.DatabaseError escaped
    the cleanup handler and crashed refresh."""
    db, repo, cache, first_build = served
    client = make_client(cache, repo)
    assert client.refresh().status == "installed"
    tuple_before = load_tuple(cache / "congress" / "trust.json")

    mutate_db(db)
    second = publish_build(db, repo, moment=NOW + timedelta(days=1)).build_id
    # Corrupt the published database but keep it hash-consistent with a valid
    # (re-minted) manifest + pointer, so hash/size verification passes and only
    # integrity_check can catch it.
    db_asset = repo / "releases" / f"data-{second}" / "congress.db"
    garbage = b"hash-consistent bytes that are not a real sqlite database"
    db_asset.write_bytes(garbage)
    manifest_path = repo / "builds" / second / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for entry in manifest["modules"]["congress"]["artifacts"]:
        if entry["name"] == "congress.db":
            entry["sha256"] = sha(garbage)
            entry["bytes"] = len(garbage)
    manifest_text = (
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    )
    manifest_path.write_text(manifest_text, encoding="utf-8")
    pointer = build_pointer(
        pointer_version=2,
        issued_at=NOW + timedelta(days=1),
        build_id=second,
        manifest_sha256=sha(manifest_text.encode("utf-8")),
    )
    (repo / "latest.json").write_text(render_pointer(pointer), encoding="utf-8")

    moment = NOW + timedelta(days=1, hours=1)
    result = make_client(cache, repo, moment=moment).refresh()
    assert result.status == "refused"
    fresh = make_client(cache, repo, moment=moment)
    assert fresh.current_build() == first_build  # prior verified build serving
    assert load_tuple(cache / "congress" / "trust.json") == tuple_before
    assert not (cache / "congress" / second).exists()  # no partial install
    assert not list((cache / "congress").glob(".tmp-*"))  # temp removed


def test_client_refuses_partial_build_missing_required_artifact(served):
    """F6: a semantically partial build (a required artifact omitted from the
    manifest) is refused — the client keeps serving the prior build and never
    persists a higher pointer for an incomplete build (R2/R3/R8/R10)."""
    db, repo, cache, first_build = served
    client = make_client(cache, repo)
    assert client.refresh().status == "installed"
    tuple_before = load_tuple(cache / "congress" / "trust.json")

    mutate_db(db)
    second = publish_build(db, repo, moment=NOW + timedelta(days=1)).build_id
    # Drop a required artifact (stats.json) from the published manifest and
    # re-mint a matching higher pointer, so hash checks pass and only the
    # mandatory-artifact rule can catch it.
    manifest_path = repo / "builds" / second / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["modules"]["congress"]["artifacts"] = [
        entry
        for entry in manifest["modules"]["congress"]["artifacts"]
        if entry["name"] != "congress/stats.json"
    ]
    manifest_text = (
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    )
    manifest_path.write_text(manifest_text, encoding="utf-8")
    pointer = build_pointer(
        pointer_version=2,
        issued_at=NOW + timedelta(days=1),
        build_id=second,
        manifest_sha256=sha(manifest_text.encode("utf-8")),
    )
    (repo / "latest.json").write_text(render_pointer(pointer), encoding="utf-8")

    moment = NOW + timedelta(days=1, hours=1)
    result = make_client(cache, repo, moment=moment).refresh()
    assert result.status == "refused"
    fresh = make_client(cache, repo, moment=moment)
    assert fresh.current_build() == first_build  # prior build keeps serving
    assert load_tuple(cache / "congress" / "trust.json") == tuple_before
    assert not (cache / "congress" / second).exists()  # no partial install


def test_client_rejects_replay_and_equivocation(served):
    db, repo, cache, _first = served
    v1_bytes = (repo / "latest.json").read_bytes()
    mutate_db(db)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    moment = NOW + timedelta(days=1, hours=1)
    client = make_client(cache, repo, moment=moment)
    assert client.refresh().status == "installed"

    # Replay: the older, once-legitimate pointer bytes return.
    (repo / "latest.json").write_bytes(v1_bytes)
    result = make_client(cache, repo, moment=moment).refresh()
    assert result.status == "refused" and "replay" in result.message

    # Equivocation: same version, different bytes (rebuilt so expires_at
    # stays exactly issued_at + 7 days, R6).
    v1 = json.loads(v1_bytes)
    equivocating = build_pointer(
        pointer_version=2,
        issued_at=NOW + timedelta(days=1, minutes=59),
        build_id=v1["build_id"],
        manifest_sha256=v1["manifest_sha256"],
    )
    (repo / "latest.json").write_text(
        render_pointer(equivocating), encoding="utf-8"
    )
    result = make_client(cache, repo, moment=moment).refresh()
    assert result.status == "refused" and "equivocation" in result.message


def test_client_expired_pointer_is_stale_g(served):
    _db, repo, cache, build_id = served
    client = make_client(cache, repo)
    client.refresh()
    # (g) The unchanged pointer, past expiry: refresh fails with a stale
    # status; the last verified build keeps serving.
    late = make_client(cache, repo, moment=NOW + timedelta(days=8))
    result = late.refresh()
    assert result.status == "refused" and "stale" in result.message
    assert late.current_build() == build_id


def test_client_future_issued_rejected_h(served):
    _db, repo, cache, build_id = served
    make_client(cache, repo).refresh()
    current = latest_pointer(repo)
    future = build_pointer(
        pointer_version=2,
        issued_at=NOW + timedelta(hours=2),  # NOW + 2h, beyond the skew window
        build_id=current["build_id"],
        manifest_sha256=current["manifest_sha256"],
    )
    (repo / "latest.json").write_text(render_pointer(future), encoding="utf-8")
    result = make_client(cache, repo).refresh()
    assert result.status == "refused" and "future" in result.message
    assert make_client(cache, repo).current_build() == build_id


def test_client_state_loss_bootstrap_accepts_one_unexpired_pointer_i(served):
    """TD-7: an ABSENT anchor is genuine bootstrap — one unexpired pointer is
    accepted. A PRESENT-BUT-CORRUPT anchor is NOT (see the test below): that
    distinction is new, and deliberate."""
    _db, repo, cache, build_id = served
    make_client(cache, repo).refresh()
    # Delete the tuple + record: nothing was ever established, so bootstrap.
    # Genuinely fresh: no state files AND no cached builds.
    shutil.rmtree(cache / "congress")
    result = make_client(cache, repo).refresh()
    assert result.status == "installed"
    assert result.build_id == build_id


def test_a_corrupt_anchor_refuses_instead_of_re_bootstrapping(served):
    """CHANGED BEHAVIOUR (owner-visible). Previously a corrupt `trust.json` was
    treated as state loss and the client re-bootstrapped from any unexpired
    pointer. That is now REFUSED.

    Why it changed: `serving_build()` fails closed on a corrupt anchor, so
    laundering the same file into "no anchor" on the refresh path made the
    client read one file two contradictory ways — fail-open on the write path.
    Without a valid anchor there is NO replay protection, so a stale but still
    attested pointer could reinstate a build the current published manifest
    withholds, and the resolver would stamp it `inst_from_published_manifest=
    True` with the >=95% coverage guarantee. Absence of proof is absence of
    service (lifecycle spec §1), and a corrupt anchor is absence of proof.

    The cost is that a corrupt anchor now needs the module's cache cleared
    rather than self-healing; the refusal message says exactly that."""
    _db, repo, cache, _build_id = served
    make_client(cache, repo).refresh()
    (cache / "congress" / "trust.json").write_text("garbage", encoding="utf-8")

    result = make_client(cache, repo).refresh()
    assert result.status == "refused"
    assert "corrupt" in result.message
    assert "remove the ENTIRE directory" in result.message   # safe remediation
    assert make_client(cache, repo).serving_build() is None   # fails closed

    # Clearing the module cache restores normal bootstrap.
    shutil.rmtree(cache / "congress")
    assert make_client(cache, repo).refresh().status == "installed"


def test_client_accepts_authorized_rollback(served):
    db, repo, cache, first_build = served
    mutate_db(db)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    moment = NOW + timedelta(days=1, hours=1)
    client = make_client(cache, repo, moment=moment)
    client.refresh()
    run_publish(
        repo,
        now=pin(NOW + timedelta(days=1, hours=2)),
        backend=LocalDirBackend(repo),
        rollback_to=first_build,
    )
    result = make_client(cache, repo, moment=NOW + timedelta(days=1, hours=3)).refresh()
    assert result.status == "installed"
    assert result.build_id == first_build
    assert result.pointer_version == 3


def test_client_compat_refusal_keeps_serving_r22(tmp_path):
    """R22: a build requiring a newer client must be REFUSED as incompatible,
    with the prior verified build still serving.

    History: the original forced manifest re-evaluation by deleting
    `trust.json`, which the serving-lifecycle rewrite turned into state loss. My
    replacement tampered with a published manifest post-hoc — so the digest
    check refused it BEFORE compat was ever evaluated, and the assertion had to
    be widened to `in ("incompatible", "refused")`. That made the test VACUOUS:
    an independent review deleted the entire `if not compatible:` branch and the
    full suite still passed, silently disarming a shipped M1 safety property.

    The published `client_compat` is `>=0.0.1,<1`, so an honest client version of
    `0.0.0` reaches the branch with the manifest untouched.
    """
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    publish_build(db, repo)
    cache = tmp_path / "cache"
    assert make_client(cache, repo).refresh().status == "installed"
    serving = make_client(cache, repo).current_build()
    assert serving is not None

    mutate_db(db)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    moment = NOW + timedelta(days=1, hours=1)

    incompatible = make_client(cache, repo, client_version="0.0.0", moment=moment)
    result = incompatible.refresh()
    assert result.status == "incompatible", result
    assert "client_compat" in result.message
    assert "0.0.0" in result.message
    # The prior verified build is untouched and keeps serving.
    assert incompatible.current_build() == serving
    assert make_client(cache, repo, moment=moment).current_build() == serving


def test_client_attestation_sites_pointer_and_manifest(served):
    _db, repo, cache, _build = served
    spy = SpyAttestation()
    client = SnapshotClient(
        cache, LocalRepoFetcher(repo), now=pin(), attestation=spy
    )
    client.refresh()
    assert ("verify", "latest.json") in spy.calls
    assert ("verify", "manifest.json") in spy.calls
    failing = SpyAttestation(fail_verify={"manifest.json"})
    client = SnapshotClient(
        cache / "second", LocalRepoFetcher(repo), now=pin(), attestation=failing
    )
    assert client.refresh().status == "refused"


# --- cross-build binding (R10/R17/R24/F3) ------------------------------------


def cross_bind(repo: Path, build_a: str, b_manifest_bytes: bytes, *, version: int,
               issued: datetime) -> None:
    """Place build B's (valid, sha-matching) manifest under build A's path and
    mint an A-pointer that authenticates it — the hash-consistent cross-build
    attack the identity check must reject."""
    (repo / "builds" / build_a / "manifest.json").write_bytes(b_manifest_bytes)
    crafted = build_pointer(
        pointer_version=version,
        issued_at=issued,
        build_id=build_a,
        manifest_sha256=sha(b_manifest_bytes),
    )
    (repo / "latest.json").write_text(render_pointer(crafted), encoding="utf-8")


def test_client_rejects_cross_build_manifest_binding(served):
    db, repo, cache, build_a = served
    client = make_client(cache, repo)
    client.refresh()  # installs A, tuple v1
    tuple_before = load_tuple(cache / "congress" / "trust.json")

    mutate_db(db)
    build_b = publish_build(db, repo, moment=NOW + timedelta(days=1)).build_id
    b_manifest = (repo / "builds" / build_b / "manifest.json").read_bytes()
    cross_bind(
        repo, build_a, b_manifest, version=3, issued=NOW + timedelta(days=1)
    )
    moment = NOW + timedelta(days=1, hours=1)
    result = make_client(cache, repo, moment=moment).refresh()
    assert result.status == "refused" and "does not match" in result.message
    fresh = make_client(cache, repo, moment=moment)
    assert fresh.current_build() == build_a  # prior verified build kept serving
    assert load_tuple(cache / "congress" / "trust.json") == tuple_before
    assert not (cache / "congress" / build_b).exists()  # no cross-build mixing


def test_client_rejects_cross_build_copied_cache_dir(served):
    """F1: a pre-existing cache dir whose manifest does NOT bind to the freshly-
    authenticated pointer's manifest_sha256 is not served — it is treated as a
    cache miss and re-installed from the authenticated manifest. Defeats copying
    a complete OTHER build's directory under the target build_id (R8/R24)."""
    db, repo, cache, first_build = served
    module = cache / "congress"
    assert make_client(cache, repo).refresh().status == "installed"
    first_db = (module / first_build / "congress.db").read_bytes()

    mutate_db(db)
    second = publish_build(db, repo, moment=NOW + timedelta(days=1)).build_id
    authentic_second_db = (
        repo / "releases" / f"data-{second}" / "congress.db"
    ).read_bytes()
    assert authentic_second_db != first_db

    # ATTACK: plant build A's complete, self-consistent content under build B's
    # id (its manifest hashes to A's manifest_sha256, not B's authenticated one).
    shutil.copytree(module / first_build, module / second)
    assert (module / second / "congress.db").read_bytes() == first_db

    result = make_client(cache, repo, moment=NOW + timedelta(days=1, hours=1)).refresh()
    assert result.status == "installed"
    assert result.build_id == second
    # The unbound copy was rejected and re-installed from the authenticated
    # manifest: build B now holds build B's real DB, never build A's.
    assert (module / second / "congress.db").read_bytes() == authentic_second_db
    assert (module / second / "congress.db").read_bytes() != first_db


def test_monitor_rejects_cross_build_manifest_binding(served, tmp_path):
    db, repo, _cache, build_a = served
    state = tmp_path / "monitor"
    seed_monitor(state, repo)  # floor at A's v1
    mutate_db(db)
    build_b = publish_build(db, repo, moment=NOW + timedelta(hours=6)).build_id
    b_manifest = (repo / "builds" / build_b / "manifest.json").read_bytes()
    cross_bind(repo, build_a, b_manifest, version=3, issued=NOW + timedelta(hours=6))
    alerts = AlertLog()
    code = run_monitor(
        state, monitor_fetcher(repo), now=pin(NOW + timedelta(hours=7)), alert=alerts
    )
    assert code == 1
    assert load_tuple(state / "pointer-tuple.json")[0] == 1  # not persisted


def test_verify_rejects_cross_build_manifest_binding(served):
    db, repo, _cache, build_a = served
    mutate_db(db)
    build_b = publish_build(db, repo, moment=NOW + timedelta(days=1)).build_id
    b_manifest = (repo / "builds" / build_b / "manifest.json").read_bytes()
    cross_bind(repo, build_a, b_manifest, version=3, issued=NOW + timedelta(days=1))
    from populus.publish.build import run_verify

    report = run_verify(repo, now=pin(NOW + timedelta(days=1, hours=1)))
    assert not report.ok
    assert any("does not match the pointer" in error for error in report.errors)


# --- client crash recovery at every boundary (R24) ----------------------------


@pytest.fixture
def two_builds(tmp_path):
    """b1 installed; b2 published and installed; snapshots of both states."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    publish_build(db, repo)
    cache = tmp_path / "cache"
    client = make_client(cache, repo)
    client.refresh()
    module = cache / "congress"
    state_b1 = {
        name: (module / name).read_bytes()
        for name in ("trust.json", "serving.json")
    }
    b1 = client.current_build()
    mutate_db(db)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    moment = NOW + timedelta(days=1, hours=1)
    assert make_client(cache, repo, moment=moment).refresh().status == "installed"
    b2 = latest_pointer(repo)["build_id"]
    return repo, cache, module, state_b1, b1, b2, moment


def _restore(module: Path, state: dict, names) -> None:
    for name in names:
        (module / name).write_bytes(state[name])


def _v1_installed_v2_downloading(tmp_path):
    """A cache with b1 fully installed/trusted/serving and a crash MID-DOWNLOAD
    of b2: a partial `.tmp-<b2>` directory exists, but the trust tuple, sidecar,
    and current marker still all point at b1 (b2 was never renamed in). Returns
    ``(repo, cache, module, b1, b2, tuple_before)``."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    b1 = publish_build(db, repo).build_id
    cache = tmp_path / "cache"
    client = make_client(cache, repo)
    assert client.refresh().status == "installed"
    module = cache / "congress"
    tuple_before = load_tuple(module / "trust.json")  # v1
    # b2 becomes available on the remote, but the client crashed while its temp
    # download was still in flight.
    mutate_db(db)
    b2 = publish_build(db, repo, moment=NOW + timedelta(days=1)).build_id
    tmp = module / f".tmp-{b2}"
    tmp.mkdir()
    (tmp / "congress.db").write_bytes(b"partially downloaded, never verified")
    (module / ".tmp-file").write_text("junk")
    return repo, cache, module, b1, b2, tuple_before


def test_crash_boundary_temp_download_v1_intact(tmp_path):
    """A crash during b2's temp download, while b1 is still the trusted/serving
    build: an in-process reconcile removes the partial temp and leaves b1 fully
    intact — never a half-installed b2, never an advanced tuple (R24)."""
    repo, cache, module, b1, b2, tuple_before = _v1_installed_v2_downloading(tmp_path)
    fresh = make_client(cache, repo, moment=NOW + timedelta(days=1, hours=1))
    fresh.reconcile()
    assert not list(module.glob(".tmp-*"))  # partial download cleaned
    assert fresh.current_build() == b1  # prior build still serving
    assert load_tuple(module / "trust.json") == tuple_before  # tuple still v1
    assert not (module / b2).exists()  # b2 never installed


def test_crash_boundary_renamed_but_no_tuple(two_builds):
    """Artifacts renamed in; crash before the tuple write (the commit)."""
    repo, cache, module, state_b1, b1, b2, moment = two_builds
    _restore(module, state_b1, ("trust.json", "serving.json"))
    fresh = make_client(cache, repo, moment=moment)
    assert fresh.current_build() == b1  # prior verified build serving
    result = fresh.refresh()  # online: higher version, build dir complete
    assert result.status == "installed"
    assert result.build_id == b2
    assert load_tuple(module / "trust.json")[0] == 2
    assert fresh.current_build() == b2


def test_crash_boundary_tuple_written_no_record(two_builds):
    """Tuple persisted (the commit); crash before the serving record.

    The stale record no longer matches the advanced anchor, so the module is
    ABSENT — not still serving b1. That is the spec's deliberate choice: the
    commit has happened, and absence of proof is absence of service. The ONLINE
    idempotent branch then completes the record from the authenticated pointer.
    """
    repo, cache, module, state_b1, b1, b2, moment = two_builds
    _restore(module, state_b1, ("serving.json",))
    fresh = make_client(cache, repo, moment=moment)
    fresh.reconcile()
    assert fresh.serving_build() is None  # anchor ahead of the record
    result = fresh.refresh()
    assert result.status in ("installed", "idempotent")
    assert fresh.current_build() == b2
    rec = json.loads((module / "serving.json").read_text(encoding="utf-8"))
    assert rec["installed_build"] == b2


def test_crash_boundary_all_written_consistent(two_builds):
    repo, cache, _module, _state_b1, _b1, b2, moment = two_builds
    result = make_client(cache, repo, moment=moment).refresh()
    assert result.status == "idempotent"
    assert result.build_id == b2


def test_a_corrupt_serving_record_fails_closed(two_builds):
    """The INVERSION of the old advisory-sidecar behaviour: a corrupt record
    proves nothing, so it yields absence rather than being ignored while some
    other marker keeps serving. Re-verified online on the next refresh."""
    repo, cache, module, _state_b1, _b1, b2, moment = two_builds
    (module / "serving.json").write_text("garbage", encoding="utf-8")
    fresh = make_client(cache, repo, moment=moment)
    fresh.reconcile()
    assert fresh.serving_build() is None
    assert fresh.refresh().status in ("installed", "idempotent")
    assert fresh.current_build() == b2


def _client_in_subprocess(
    cache: Path, repo: Path, moment: datetime, *, action: str = "reconcile"
) -> dict:
    """Drive a SnapshotClient over the same on-disk cache in a genuine
    interpreter restart (R24/F11) and return ``{"status", "current"}``.

    ``action="reconcile"`` exercises the offline read-time heal; ``"refresh"``
    exercises the online heal (install / idempotent branch). No in-process
    object carries over — the process, its imports, and its heap are new.
    """
    script = (
        "import sys, json\n"
        f"sys.path.insert(0, {str(REPO_ROOT / 'src')!r})\n"
        "from datetime import datetime, timezone\n"
        "from populus.client.snapshot import SnapshotClient, LocalRepoFetcher\n"
        f"client = SnapshotClient({str(cache)!r}, LocalRepoFetcher({str(repo)!r}),\n"
        f"    now=lambda: datetime({moment.year}, {moment.month}, {moment.day},"
        f" {moment.hour}, {moment.minute}, tzinfo=timezone.utc))\n"
        f"if {action!r} == 'refresh':\n"
        "    status = client.refresh().status\n"
        "else:\n"
        "    status = None\n"
        "    client.reconcile()\n"
        "print(json.dumps({'status': status, 'current': client.current_build()}))\n"
    )
    result = subprocess.run(  # nosec B603 — fixed interpreter, argv list
        [sys.executable, "-c", script], capture_output=True, text=True
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout.strip().splitlines()[-1])


@pytest.mark.parametrize(
    "boundary,expected_status",
    [
        # artifacts renamed in, anchor not yet advanced → online install.
        ("rename", "installed"),
        # anchor advanced (COMMITTED), record not yet written → online heal.
        ("tuple", None),
        # both written and consistent → online idempotent no-op.
        ("record", "idempotent"),
    ],
)
def test_crash_boundary_real_process_restart(two_builds, boundary, expected_status):
    """R24/F11: EVERY forward-progress crash boundary self-heals to the newest
    verified build through a REAL interpreter restart over the same on-disk
    cache. The lifecycle spec has three boundaries — rename, tuple (the commit),
    record — where the old four-file model had four, and the trust anchor still
    stays exactly two fields. (The temp-download boundary, where the PRIOR build
    stays trusted, is modelled separately below.)"""
    repo, cache, module, state_b1, _b1, b2, moment = two_builds
    if boundary == "rename":
        _restore(module, state_b1, ("trust.json", "serving.json"))
    elif boundary == "tuple":
        _restore(module, state_b1, ("serving.json",))
    # "record": leave the fully consistent state untouched.

    result = _client_in_subprocess(cache, repo, moment, action="refresh")
    assert result["current"] == b2  # healed to the newest verified build
    if expected_status is not None:
        assert result["status"] == expected_status
    assert not list(module.glob(".tmp-*"))  # orphans removed by the restart
    version, _sha256 = load_tuple(module / "trust.json")  # two fields, exactly
    assert version == 2
    rec = json.loads((module / "serving.json").read_text())
    assert rec["installed_build"] == b2
    # A subsequent in-process client agrees over the healed on-disk state.
    assert make_client(cache, repo, moment=moment).current_build() == b2


def test_crash_boundary_temp_download_v1_intact_real_process_restart(tmp_path):
    """R24/F11: the temp-download crash boundary heals through a genuine
    interpreter restart — b1 stays trusted/serving, the partial b2 temp is
    removed, and the tuple is NOT advanced (no forward progress on a crash that
    never completed a verified install)."""
    repo, cache, module, b1, b2, tuple_before = _v1_installed_v2_downloading(tmp_path)
    result = _client_in_subprocess(
        cache, repo, NOW + timedelta(days=1, hours=1), action="reconcile"
    )
    assert result["current"] == b1  # prior build still serving after restart
    assert not list(module.glob(".tmp-*"))  # partial download removed
    assert load_tuple(module / "trust.json") == tuple_before  # tuple still v1
    assert not (module / b2).exists()  # b2 never installed
    assert json.loads((module / "serving.json").read_text())["installed_build"] == b1


# --- GitHubRepoFetcher (R27) --------------------------------------------------


def github_transport(repo: Path, slug: str = "acme/populus-data"):
    """MockTransport serving the local repo through the contents API shape."""
    prefix = f"https://api.github.com/repos/{slug}/contents/"

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer test-token"
        url = str(request.url)
        if url.startswith(prefix):
            assert request.headers["accept"] == "application/vnd.github.raw+json"
            relpath = url[len(prefix) :]
            target = repo / relpath
            if target.is_file():
                return httpx.Response(200, content=target.read_bytes())
            return httpx.Response(404, json={"message": "Not Found"})
        return httpx.Response(500, text="unexpected route")

    return httpx.MockTransport(handler)


def test_github_fetcher_reads_pointer_and_manifest(served):
    _db, repo, _cache, build_id = served
    fetcher = GitHubRepoFetcher(
        "acme/populus-data", "test-token", transport=github_transport(repo)
    )
    pointer = json.loads(fetcher.fetch_path("latest.json"))
    assert pointer["build_id"] == build_id
    manifest = json.loads(fetcher.fetch_path(pointer["manifest_path"]))
    assert manifest["build_id"] == build_id


def test_github_fetcher_error_branches(served):
    _db, repo, _cache, _build = served
    fetcher = GitHubRepoFetcher(
        "acme/populus-data", "test-token", transport=github_transport(repo)
    )
    with pytest.raises(FetchError, match="404"):
        fetcher.fetch_path("nope.json")

    def exploding(request):
        raise httpx.ConnectError("boom")

    broken = GitHubRepoFetcher(
        "acme/populus-data", "test-token", transport=httpx.MockTransport(exploding)
    )
    with pytest.raises(FetchError, match="ConnectError"):
        broken.fetch_path("latest.json")
    # Malformed URLs raise a non-HTTPError branch (httpx.InvalidURL) — both
    # branches must land in FetchError.
    with pytest.raises(FetchError):
        broken.fetch_asset("https://[malformed", Path("/dev/null"))


def test_client_over_github_fetcher_installs(served, tmp_path):
    _db, repo, _cache, build_id = served
    fetcher = GitHubRepoFetcher(
        "acme/populus-data", "test-token", transport=github_transport(repo)
    )
    client = SnapshotClient(tmp_path / "ghcache", fetcher, now=pin())
    result = client.refresh()
    assert result.status == "installed"
    assert result.build_id == build_id


def test_github_fetcher_token_stripped_on_cross_origin_redirect(tmp_path):
    """F5/F3: the bearer token is sent to the api.github.com asset endpoint but
    NOT to the cross-origin blob host it 302-redirects to. This exercises the
    real download path — asset endpoint issues a 302 to a different-origin
    signed URL — and proves httpx strips Authorization on the cross-origin hop,
    the token-safety property F5 relies on. A URL outside the configured repo is
    still refused before any request; the browser-download URL is never used."""
    slug = "acme/populus-data"
    tag = "data-20260723.1"
    tags_url = f"https://api.github.com/repos/{slug}/releases/tags/{tag}"
    asset_url = f"https://api.github.com/repos/{slug}/releases/assets/77"
    # A DIFFERENT origin, as GitHub's signed blob redirects use.
    blob_url = "https://release-assets.example-cdn.net/blob/congress.db?sig=abc123"
    seen: list[tuple[str, bool]] = []  # (url, carried Authorization header)

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        seen.append((url, "authorization" in request.headers))
        if url == tags_url:
            return httpx.Response(
                200,
                json={"assets": [{"name": "congress.db", "id": 77, "url": asset_url}]},
            )
        if url == asset_url:
            assert request.headers["accept"] == "application/octet-stream"
            # GitHub 302-redirects the asset endpoint to a signed, different-
            # origin blob URL; httpx must follow it WITHOUT the token.
            return httpx.Response(302, headers={"location": blob_url})
        if url == blob_url:
            return httpx.Response(200, content=b"asset-bytes")
        return httpx.Response(500, text=f"unexpected route: {url}")

    fetcher = GitHubRepoFetcher(slug, "secret-token", transport=httpx.MockTransport(handler))
    for hostile in (
        "https://evil.example.com/acme/populus-data/releases/download/"
        "data-20260723.1/congress.db",
        "https://github.com.evil.example/acme/populus-data/releases/download/"
        "data-20260723.1/congress.db",
        "https://github.com/other-owner/populus-data/releases/download/"
        "data-20260723.1/congress.db",
    ):
        with pytest.raises(FetchError, match="outside acme/populus-data"):
            fetcher.fetch_asset(hostile, tmp_path / "out.bin")
    assert seen == []  # off-origin refused before any request → no token leaked

    # A canonical URL: tags lookup → asset endpoint → cross-origin 302 → blob.
    dest = tmp_path / "asset.db"
    fetcher.fetch_asset(
        f"https://github.com/{slug}/releases/download/{tag}/congress.db", dest
    )
    assert dest.read_bytes() == b"asset-bytes"  # the redirect was followed
    by_url = dict(seen)
    # The two api.github.com endpoints carried the token...
    assert by_url[tags_url] is True
    assert by_url[asset_url] is True
    # ...and the cross-origin blob request did NOT (token stripped on redirect).
    assert by_url[blob_url] is False
    # The browser-download URL is never requested at all.
    assert not any("releases/download" in url for url, _ in seen)
    # No token ever left api.github.com.
    assert all(
        not had_auth or url.startswith("https://api.github.com/")
        for url, had_auth in seen
    )


def github_url_db_transport(repo: Path, build_id: str, slug: str = "acme/populus-data"):
    """MockTransport serving the whole repo over the contents API, with the DB
    fetched through the Release Assets API (tags lookup → asset-id endpoint).
    Returns ``(transport, seen)`` where ``seen`` records every request URL."""
    contents_prefix = f"https://api.github.com/repos/{slug}/contents/"
    tag = f"data-{build_id}"
    asset_id = 4242
    db_bytes = (repo / "releases" / tag / "congress.db").read_bytes()
    seen: list[tuple[str, bool]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        seen.append((url, "authorization" in request.headers))
        if url.startswith(contents_prefix):
            target = repo / url[len(contents_prefix) :]
            if target.is_file():
                return httpx.Response(200, content=target.read_bytes())
            return httpx.Response(404, json={"message": "Not Found"})
        if url == f"https://api.github.com/repos/{slug}/releases/tags/{tag}":
            return httpx.Response(
                200,
                json={
                    "assets": [
                        {
                            "name": "congress.db",
                            "id": asset_id,
                            "url": f"https://api.github.com/repos/{slug}"
                            f"/releases/assets/{asset_id}",
                        }
                    ]
                },
            )
        if url == f"https://api.github.com/repos/{slug}/releases/assets/{asset_id}":
            assert request.headers["accept"] == "application/octet-stream"
            return httpx.Response(200, content=db_bytes)
        return httpx.Response(500, text=f"unexpected route: {url}")

    return httpx.MockTransport(handler), seen


def test_client_installs_over_github_url_db_artifact(served, tmp_path):
    """F5: a full install where congress.db is a URL (Release) artifact. The DB
    is downloaded through the authenticated Release Assets API; every token-
    bearing request goes to api.github.com and the browser-download URL is never
    requested."""
    _db, repo, _cache, build_id = served
    # Rewrite the DB artifact to a canonical Release URL and re-mint the pointer.
    manifest_path = repo / "builds" / build_id / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for entry in manifest["modules"]["congress"]["artifacts"]:
        if entry["name"] == "congress.db":
            entry.pop("path", None)
            entry["url"] = (
                f"https://github.com/acme/populus-data/releases/download/"
                f"data-{build_id}/congress.db"
            )
    manifest_text = (
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    )
    manifest_path.write_text(manifest_text, encoding="utf-8")
    pointer = build_pointer(
        pointer_version=1,
        issued_at=NOW - timedelta(hours=1),
        build_id=build_id,
        manifest_sha256=sha(manifest_text.encode("utf-8")),
    )
    (repo / "latest.json").write_text(render_pointer(pointer), encoding="utf-8")

    transport, seen = github_url_db_transport(repo, build_id)
    fetcher = GitHubRepoFetcher("acme/populus-data", "test-token", transport=transport)
    client = SnapshotClient(tmp_path / "ghcache", fetcher, now=pin())
    result = client.refresh()
    assert result.status == "installed"
    assert result.build_id == build_id
    installed_db = tmp_path / "ghcache" / "congress" / build_id / "congress.db"
    assert installed_db.is_file()
    # Every token-bearing request went to api.github.com; the browser-download
    # URL was never requested.
    assert seen
    assert all(url.startswith("https://api.github.com/") for url, _ in seen)
    assert all(had_auth for _, had_auth in seen)
    assert not any("releases/download" in url for url, _ in seen)


def test_github_fetcher_rejects_malformed_release_json(tmp_path):
    """Neighborhood 1 (deep shape): the remote release JSON is validated in
    depth — a top-level-valid response with a malformed assets array, a
    non-integer asset id, a missing asset, or non-JSON body fails as FetchError,
    never an index/KeyError/attr traceback."""
    slug = "acme/populus-data"
    tag = "data-20260723.1"
    canonical = f"https://github.com/{slug}/releases/download/{tag}/congress.db"

    def fetcher_for(response: httpx.Response) -> GitHubRepoFetcher:
        def handler(request: httpx.Request) -> httpx.Response:
            assert str(request.url).endswith(f"/releases/tags/{tag}")
            return response

        return GitHubRepoFetcher(slug, "t", transport=httpx.MockTransport(handler))

    with pytest.raises(FetchError, match="no assets array"):
        fetcher_for(httpx.Response(200, json={"assets": "nope"})).fetch_asset(
            canonical, tmp_path / "o1"
        )
    with pytest.raises(FetchError, match="non-integer id"):
        fetcher_for(
            httpx.Response(200, json={"assets": [{"name": "congress.db", "id": "77"}]})
        ).fetch_asset(canonical, tmp_path / "o2")
    with pytest.raises(FetchError, match="no asset named"):
        fetcher_for(httpx.Response(200, json={"assets": [{"id": 5}]})).fetch_asset(
            canonical, tmp_path / "o3"
        )
    with pytest.raises(FetchError, match="not JSON"):
        fetcher_for(httpx.Response(200, content=b"not json at all")).fetch_asset(
            canonical, tmp_path / "o4"
        )


# --- the monitor (R17/R28) ----------------------------------------------------


class AlertLog:
    def __init__(self):
        self.messages: list[str] = []

    def __call__(self, message: str) -> None:
        self.messages.append(message)


def monitor_fetcher(repo: Path) -> GitHubRepoFetcher:
    return GitHubRepoFetcher(
        "acme/populus-data", "test-token", transport=github_transport(repo)
    )


def seed_monitor(state_dir: Path, repo: Path) -> None:
    """Pin the monitor's floor to the currently published pointer."""
    pointer_bytes = (repo / "latest.json").read_bytes()
    pointer = json.loads(pointer_bytes)
    persist_tuple(
        state_dir / "pointer-tuple.json",
        pointer["pointer_version"],
        sha(pointer_bytes),
    )


def test_monitor_fails_closed_on_missing_or_corrupt_tuple(served, tmp_path):
    _db, repo, _cache, _build = served
    state = tmp_path / "monitor"
    alerts = AlertLog()
    code = run_monitor(state, monitor_fetcher(repo), now=pin(), alert=alerts)
    assert code == 2
    assert any("failing closed" in message for message in alerts.messages)
    assert not (state / "pointer-tuple.json").exists()  # never bootstraps

    state.mkdir(parents=True, exist_ok=True)
    (state / "pointer-tuple.json").write_text("garbage", encoding="utf-8")
    alerts = AlertLog()
    assert run_monitor(state, monitor_fetcher(repo), now=pin(), alert=alerts) == 2
    assert any("corrupt" in message for message in alerts.messages)


@pytest.mark.parametrize("owned", ["pointer-tuple.json", "failures"])
def test_monitor_fails_closed_on_symlinked_state_file(served, tmp_path, owned):
    """F4: a Populus-owned monitor state file (tuple/failures) that is a symlink
    fails closed — the write is never redirected outside state_dir."""
    _db, repo, _cache, _build = served
    state = tmp_path / "monitor"
    state.mkdir()
    external = tmp_path / "external"
    external.mkdir()
    victim = external / "target"
    victim.write_text("orig")
    (state / owned).symlink_to(victim)
    alerts = AlertLog()
    code = run_monitor(state, monitor_fetcher(repo), now=pin(), alert=alerts)
    assert code == 2
    assert any("symlink" in message for message in alerts.messages)
    assert victim.read_text() == "orig"  # never written through the symlink


@pytest.mark.parametrize("bad_version", [0, -3])
def test_monitor_fails_closed_on_nonpositive_tuple_version(served, tmp_path, bad_version):
    """F8: a zero/negative tuple version is corrupt state, not a low trusted
    floor — the monitor fails closed instead of silently bootstrapping."""
    _db, repo, _cache, _build = served
    state = tmp_path / "monitor"
    state.mkdir(parents=True, exist_ok=True)
    (state / "pointer-tuple.json").write_text(
        json.dumps({"pointer_version": bad_version, "pointer_sha256": "ab" * 32}),
        encoding="utf-8",
    )
    alerts = AlertLog()
    assert run_monitor(state, monitor_fetcher(repo), now=pin(), alert=alerts) == 2
    assert any("corrupt" in message for message in alerts.messages)


def test_monitor_happy_path_persists_higher_only_after_full_checks(served, tmp_path):
    db, repo, _cache, _b1 = served
    state = tmp_path / "monitor"
    seed_monitor(state, repo)  # floor = v1
    mutate_db(db)
    publish_build(db, repo, moment=NOW + timedelta(hours=6))
    alerts = AlertLog()
    moment = NOW + timedelta(hours=7)
    code = run_monitor(state, monitor_fetcher(repo), now=pin(moment), alert=alerts)
    assert code == 0 and alerts.messages == []
    assert load_tuple(state / "pointer-tuple.json")[0] == 2

    # Idempotent re-poll: a 6-hour cadence must never alarm on sameness —
    # and it still runs the manifest + stats checks (exit 0, no alert).
    code = run_monitor(state, monitor_fetcher(repo), now=pin(moment), alert=alerts)
    assert code == 0 and alerts.messages == []


def test_monitor_stats_tamper_fails_and_preserves_tuple(served, tmp_path):
    db, repo, _cache, _b1 = served
    state = tmp_path / "monitor"
    seed_monitor(state, repo)
    mutate_db(db)
    publish_build(db, repo, moment=NOW + timedelta(hours=6))
    build_id = latest_pointer(repo)["build_id"]
    stats_file = repo / "builds" / build_id / "congress" / "stats.json"
    stats_file.write_bytes(stats_file.read_bytes().replace(b"2026", b"2025", 1))
    alerts = AlertLog()
    code = run_monitor(
        state, monitor_fetcher(repo), now=pin(NOW + timedelta(hours=7)), alert=alerts
    )
    assert code == 1
    assert load_tuple(state / "pointer-tuple.json")[0] == 1  # old tuple preserved


def test_monitor_build_age_alarm(served, tmp_path):
    _db, repo, _cache, _build = served
    state = tmp_path / "monitor"
    seed_monitor(state, repo)
    alerts = AlertLog()
    code = run_monitor(
        state,
        monitor_fetcher(repo),
        now=pin(NOW + timedelta(hours=37)),
        alert=alerts,
    )
    assert code == 1
    assert any("older than 36h" in message for message in alerts.messages)


def test_monitor_watermark_divergence_alarms_and_keeps_tuple(served, tmp_path):
    _db, repo, _cache, build_id = served
    state = tmp_path / "monitor"
    seed_monitor(state, repo)
    # Publisher-error scenario: manifest watermarks diverge from stats.json;
    # the pointer is re-minted (higher version) over the edited manifest.
    manifest_path = repo / "builds" / build_id / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["modules"]["congress"]["watermarks"]["senate_max_filed_date"] = (
        "2026-01-01"
    )
    manifest_text = (
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    )
    manifest_path.write_text(manifest_text, encoding="utf-8")
    pointer = build_pointer(
        pointer_version=2,
        issued_at=NOW + timedelta(hours=1),
        build_id=build_id,
        manifest_sha256=sha(manifest_text.encode("utf-8")),
    )
    (repo / "latest.json").write_text(render_pointer(pointer), encoding="utf-8")
    alerts = AlertLog()
    code = run_monitor(
        state, monitor_fetcher(repo), now=pin(NOW + timedelta(hours=2)), alert=alerts
    )
    assert code == 1
    assert any("watermark" in message for message in alerts.messages)
    assert load_tuple(state / "pointer-tuple.json")[0] == 1  # not persisted


def _republish_edited_stats(repo, build_id, transform, *, moment, version):
    """Re-render stats.json under *transform*, re-hash it into the manifest,
    and mint a fresh higher pointer — so the monitor's sha check passes and
    its freshness logic is exercised on the edited stats (F12)."""
    from populus.publish.manifest import render_manifest
    from populus.stats import render_stats

    stats_path = repo / "builds" / build_id / "congress" / "stats.json"
    stats = json.loads(stats_path.read_text(encoding="utf-8"))
    transform(stats)
    stats_bytes = render_stats(stats).encode("utf-8")
    stats_path.write_bytes(stats_bytes)
    manifest_path = repo / "builds" / build_id / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for entry in manifest["modules"]["congress"]["artifacts"]:
        if entry["name"] == "congress/stats.json":
            entry["sha256"] = sha(stats_bytes)
            entry["bytes"] = len(stats_bytes)
    manifest_bytes = render_manifest(manifest).encode("utf-8")
    manifest_path.write_bytes(manifest_bytes)
    pointer = build_pointer(
        pointer_version=version,
        issued_at=moment,
        build_id=build_id,
        manifest_sha256=sha(manifest_bytes),
    )
    (repo / "latest.json").write_text(render_pointer(pointer), encoding="utf-8")


def test_monitor_fails_closed_on_missing_freshness_key(served, tmp_path):
    """F12: a publication whose stats.json omits a required freshness key
    fails closed (return failure, prior tuple preserved) — not passed as
    fresh via None == None."""
    _db, repo, _cache, build_id = served
    state = tmp_path / "monitor"
    seed_monitor(state, repo)  # floor v1 over the original pointer
    _republish_edited_stats(
        repo,
        build_id,
        lambda s: s["freshness"].pop("senate_db_max_filed_date"),
        moment=NOW + timedelta(hours=1),
        version=2,
    )
    alerts = AlertLog()
    code = run_monitor(
        state, monitor_fetcher(repo), now=pin(NOW + timedelta(hours=2)), alert=alerts
    )
    assert code == 1
    assert any("freshness" in message for message in alerts.messages)
    assert load_tuple(state / "pointer-tuple.json")[0] == 1  # tuple preserved


def test_monitor_fails_closed_on_malformed_stats_freshness(served, tmp_path):
    """F12: a stats.json whose freshness is not an object fails closed."""
    _db, repo, _cache, build_id = served
    state = tmp_path / "monitor"
    seed_monitor(state, repo)
    _republish_edited_stats(
        repo,
        build_id,
        lambda s: s.__setitem__("freshness", "not-an-object"),
        moment=NOW + timedelta(hours=1),
        version=2,
    )
    alerts = AlertLog()
    code = run_monitor(
        state, monitor_fetcher(repo), now=pin(NOW + timedelta(hours=2)), alert=alerts
    )
    assert code == 1
    assert any("freshness" in message for message in alerts.messages)
    assert load_tuple(state / "pointer-tuple.json")[0] == 1


def test_monitor_two_consecutive_failures_alarm(served, tmp_path):
    _db, repo, _cache, _build = served
    state = tmp_path / "monitor"
    seed_monitor(state, repo)

    def failing(request):
        return httpx.Response(500, text="down")

    fetcher = GitHubRepoFetcher(
        "acme/populus-data", "test-token", transport=httpx.MockTransport(failing)
    )
    alerts = AlertLog()
    assert run_monitor(state, fetcher, now=pin(), alert=alerts) == 1
    assert alerts.messages == []  # first failure: recorded, no alert yet
    assert run_monitor(state, fetcher, now=pin(), alert=alerts) == 1
    assert any("2 consecutive failures" in message for message in alerts.messages)
    # Recovery resets the counter.
    alerts = AlertLog()
    assert run_monitor(state, monitor_fetcher(repo), now=pin(), alert=alerts) == 0
    assert (state / "failures").read_text().strip() == "0"


def test_monitor_replay_and_equivocation_across_restarts(served, tmp_path):
    db, repo, _cache, _b1 = served
    state = tmp_path / "monitor"
    seed_monitor(state, repo)
    v1_bytes = (repo / "latest.json").read_bytes()
    mutate_db(db)
    publish_build(db, repo, moment=NOW + timedelta(hours=6))
    moment = NOW + timedelta(hours=7)
    assert (
        run_monitor(state, monitor_fetcher(repo), now=pin(moment), alert=AlertLog())
        == 0
    )  # tuple now v2 — each run_monitor call is a fresh process poll

    # Higher → lower: replay alarms immediately.
    v2_bytes = (repo / "latest.json").read_bytes()
    (repo / "latest.json").write_bytes(v1_bytes)
    alerts = AlertLog()
    assert run_monitor(state, monitor_fetcher(repo), now=pin(moment), alert=alerts) == 1
    assert any("replay" in message for message in alerts.messages)
    assert load_tuple(state / "pointer-tuple.json")[0] == 2

    # Higher → same-version-different-bytes: equivocation alarms (rebuilt so
    # expires_at stays exactly issued_at + 7 days, R6).
    v2 = json.loads(v2_bytes)
    equivocating = build_pointer(
        pointer_version=v2["pointer_version"],
        issued_at=NOW + timedelta(hours=6, minutes=59),
        build_id=v2["build_id"],
        manifest_sha256=v2["manifest_sha256"],
    )
    (repo / "latest.json").write_text(
        render_pointer(equivocating), encoding="utf-8"
    )
    alerts = AlertLog()
    assert run_monitor(state, monitor_fetcher(repo), now=pin(moment), alert=alerts) == 1
    assert any("EQUIVOCATION" in message for message in alerts.messages)
    assert load_tuple(state / "pointer-tuple.json")[0] == 2

    # Higher → equal again: clean idempotent pass.
    (repo / "latest.json").write_bytes(v2_bytes)
    assert (
        run_monitor(state, monitor_fetcher(repo), now=pin(moment), alert=AlertLog())
        == 0
    )


def _publish_malformed_stats(repo, build_id, stats_bytes, *, moment, version):
    """Write RAW (malformed) stats.json bytes, re-hash them into the manifest,
    and mint a matching higher pointer — so the monitor's SHA check passes and
    the JSON parse / root-shape check is what must fail (F3)."""
    from populus.publish.manifest import render_manifest

    stats_path = repo / "builds" / build_id / "congress" / "stats.json"
    stats_path.write_bytes(stats_bytes)
    manifest_path = repo / "builds" / build_id / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for entry in manifest["modules"]["congress"]["artifacts"]:
        if entry["name"] == "congress/stats.json":
            entry["sha256"] = sha(stats_bytes)
            entry["bytes"] = len(stats_bytes)
    manifest_bytes = render_manifest(manifest).encode("utf-8")
    manifest_path.write_bytes(manifest_bytes)
    pointer = build_pointer(
        pointer_version=version,
        issued_at=moment,
        build_id=build_id,
        manifest_sha256=sha(manifest_bytes),
    )
    (repo / "latest.json").write_text(render_pointer(pointer), encoding="utf-8")


@pytest.mark.parametrize(
    "malformed",
    [
        b"{ this is not valid json",  # unparseable → decode/parse failure
        b"[]",  # valid JSON but not an object → structure failure
        b'"a bare string"',  # valid JSON, non-object
        b"42",  # valid JSON, non-object
    ],
)
def test_monitor_two_consecutive_malformed_stats_alarm(served, tmp_path, malformed):
    """F3: a manifest-SHA-consistent but malformed stats.json is a monitored
    FAILURE, not an uncaught traceback — it increments the failure counter, and
    two consecutive such polls trip the second-failure alarm while the higher
    pointer is never persisted (R17/R28)."""
    _db, repo, _cache, build_id = served
    state = tmp_path / "monitor"
    seed_monitor(state, repo)  # floor v1
    _publish_malformed_stats(
        repo, build_id, malformed, moment=NOW + timedelta(hours=1), version=2
    )
    alerts = AlertLog()
    moment = NOW + timedelta(hours=2)
    assert run_monitor(state, monitor_fetcher(repo), now=pin(moment), alert=alerts) == 1
    assert alerts.messages == []  # first failure recorded, no alert yet
    assert run_monitor(state, monitor_fetcher(repo), now=pin(moment), alert=alerts) == 1
    assert any("2 consecutive failures" in message for message in alerts.messages)
    assert load_tuple(state / "pointer-tuple.json")[0] == 1  # tuple preserved


def test_monitor_recovery_tuple_requires_verified_pointer_sha(served, tmp_path):
    """F6: the §13.5 monitor state-recovery command must persist the VERIFIED
    pointer sha256, never a placeholder. A zero-digest tuple at the live pointer
    version reports equivocation and refuses to recover; the correctly-derived
    tuple (what the fixed runbook computes) polls clean."""
    _db, repo, _cache, _build = served
    state = tmp_path / "monitor"
    pointer_bytes = (repo / "latest.json").read_bytes()
    pointer = json.loads(pointer_bytes)
    version = pointer["pointer_version"]

    # The pre-fix runbook placeholder: an all-zero digest → equivocation alarm.
    persist_tuple(state / "pointer-tuple.json", version, "0" * 64)
    alerts = AlertLog()
    assert run_monitor(state, monitor_fetcher(repo), now=pin(), alert=alerts) == 1
    assert any("EQUIVOCATION" in message for message in alerts.messages)

    # The fixed runbook derives sha256(latest.json bytes): a clean idempotent
    # pass, no alert.
    persist_tuple(state / "pointer-tuple.json", version, sha(pointer_bytes))
    alerts = AlertLog()
    assert run_monitor(state, monitor_fetcher(repo), now=pin(), alert=alerts) == 0
    assert alerts.messages == []
