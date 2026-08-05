"""Structural guards for the attestation seam (RUN P3-3a, R12/R14).

WHY THIS FILE EXISTS. The defect these guards catch is an *omission* — a call
site that simply does not pass ``attestation`` and therefore silently inherits a
``StagingNoop`` default that answers "verified" to everything. Three successive
plan-review rounds tried to enumerate those sites by grepping for the string
``or StagingNoop()`` and produced three different wrong answers, because **a
missing argument has no string to find**. Two omission-capable parameters
(``run_build``, ``reconcile_inflight``) were named by no round at all.

So the enumeration is computed, not written down: these tests walk signatures and
the AST. A future call site that forgets the argument fails here, permanently,
without anyone having to remember this class of bug exists.

SCOPE. Production code only — ``src/`` and ``scripts/``. Test call sites are
deliberately exempt: they are hermetic (``tests/conftest.py`` forbids network),
they legitimately want the no-op, and they carry no trust posture. Enforcing the
property on ~180 test calls would cost 20x the edits to protect nothing.
"""

from __future__ import annotations

import ast
import inspect
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
PRODUCTION_ROOTS = (REPO_ROOT / "src", REPO_ROOT / "scripts")
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "publish.yml"


def _attestation_taking_names() -> set[str]:
    """Every callable that accepts an ``attestation`` argument, by inspection.

    Derived rather than listed, so adding a new one is automatically covered.
    """
    from populus.client import snapshot as snapshot_mod
    from populus.publish import build as build_mod
    from populus.publish import pointer as pointer_mod

    names: set[str] = set()
    for module in (build_mod, pointer_mod, snapshot_mod):
        for name, obj in vars(module).items():
            if name.startswith("_"):
                continue
            target = obj.__init__ if inspect.isclass(obj) else obj
            if not (inspect.isfunction(target) or inspect.ismethod(target)):
                continue
            try:
                if "attestation" in inspect.signature(target).parameters:
                    names.add(name)
            except (TypeError, ValueError):  # pragma: no cover - builtins
                continue
    # `run_monitor` lives in scripts/, which is not an importable package.
    names.add("run_monitor")
    return names


def _production_files() -> list[Path]:
    return sorted(
        f
        for root in PRODUCTION_ROOTS
        for f in root.rglob("*.py")
        if "__pycache__" not in f.parts
    )


def _omitting_call_sites() -> list[str]:
    """Production calls to an attestation-taking callable that omit it."""
    targets = _attestation_taking_names()
    offenders: list[str] = []
    for path in _production_files():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = (
                func.id
                if isinstance(func, ast.Name)
                else func.attr
                if isinstance(func, ast.Attribute)
                else None
            )
            if name not in targets:
                continue
            if any(kw.arg == "attestation" for kw in node.keywords):
                continue
            # `**kwargs` forwarding is opaque to AST; treat it as passing.
            if any(kw.arg is None for kw in node.keywords):
                continue
            rel = path.relative_to(REPO_ROOT)
            offenders.append(f"{rel}:{node.lineno} {name}(...)")
    return offenders


def test_no_production_call_site_omits_attestation() -> None:
    """R12/R13 — the guard that replaces three rounds of hand-enumeration.

    Every production call that could inherit a `StagingNoop` default must pass a
    provider explicitly. Test call sites are exempt by design (see module docstring).
    """
    offenders = _omitting_call_sites()
    assert offenders == [], (
        "production call sites omit `attestation` and would silently inherit a "
        "no-op verifier:\n  " + "\n  ".join(offenders)
    )


def test_the_guard_actually_detects_an_omission(tmp_path: Path) -> None:
    """The guard's own mutant: if it cannot see a reintroduced omission it is
    decoration, not a mechanism (`mutation-tests-pin-properties`)."""
    targets = _attestation_taking_names()
    assert "run_build" in targets, "signature discovery missed run_build"
    assert "run_verify" in targets, "signature discovery missed run_verify"
    assert "SnapshotClient" in targets, "signature discovery missed SnapshotClient"

    sample = tmp_path / "regression.py"
    sample.write_text("run_build(db, repo, now=now, backend=backend)\n")
    tree = ast.parse(sample.read_text())
    found = [
        n
        for n in ast.walk(tree)
        if isinstance(n, ast.Call)
        and getattr(n.func, "id", None) in targets
        and not any(kw.arg == "attestation" for kw in n.keywords)
    ]
    assert found, "the AST rule failed to flag a call that omits `attestation`"


def test_every_omission_capable_parameter_is_known() -> None:
    """R12 — the discovery set must not silently shrink.

    If a refactor renames or removes one of these, the guard above would pass
    vacuously. Pin the set that the computed scope was derived from.
    """
    names = _attestation_taking_names()
    for expected in (
        "run_build",
        "run_publish",
        "run_verify",
        "reconcile_inflight",
        "SnapshotClient",
        "evaluate_pointer",
        "run_monitor",
    ):
        assert expected in names, f"{expected} no longer discoverable — guard weakened"


# --- R1 / R9 / R14: the workflow contract ----------------------------------


def _publish_job() -> dict:
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    return doc["jobs"]["publish"]


def _steps() -> list[dict]:
    return _publish_job()["steps"]


def _step_index(name_fragment: str) -> int:
    for i, step in enumerate(_steps()):
        if name_fragment.lower() in str(step.get("name", "")).lower():
            return i
    raise AssertionError(f"no step named like {name_fragment!r}")


def test_publish_job_has_attestation_permissions() -> None:
    """R1 — attesting requires both scopes; R9 — reading requires the third."""
    perms = _publish_job()["permissions"]
    assert perms.get("id-token") == "write", "missing id-token: write"
    assert perms.get("attestations") == "write", "missing attestations: write"


def test_attest_step_precedes_verify() -> None:
    """R1 — the ordering IS the enforcement.

    The attest step must run before Verify, because Verify is what fails the job
    and prevents the `Commit manifest and pointer` step from running. Reordering
    these silently removes the only gate on the workflow path.
    """
    assert _step_index("attest") < _step_index("verify")
    assert _step_index("verify") < _step_index("commit")


def test_verify_step_demands_real_attestation() -> None:
    """R1/R14 — a Verify that accepts the no-op gates nothing."""
    verify = _steps()[_step_index("verify")]
    assert "--attestation=sigstore" in verify["run"]


def test_verify_step_is_authenticated() -> None:
    """R9 — unauthenticated attestation lookups are capped at 60/hour shared per
    runner IP. Without a token a quota error is indistinguishable from tampering
    in the step that blocks the pointer commit: a green commit would mean
    "couldn't ask" rather than "checked"."""
    verify = _steps()[_step_index("verify")]
    assert "GH_TOKEN" in (verify.get("env") or {}), "Verify step has no GH_TOKEN"


@pytest.mark.parametrize("command", ["build", "publish", "verify"])
def test_every_populus_invocation_selects_a_provider(command: str) -> None:
    """R14 — a defaultless flag with un-updated callers breaks the very workflow
    that is supposed to prove the chain (round-3 F19)."""
    runs = [str(s.get("run", "")) for s in _steps()]
    invocations = [r for r in runs if f"populus {command}" in r]
    assert invocations, f"no `populus {command}` invocation found"
    for run in invocations:
        assert "--attestation" in run, f"`populus {command}` omits --attestation"
