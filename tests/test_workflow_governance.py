"""RUN M2-11 R7e — repo-wide workflow governance sweep, plus the T13 absence
checks for the withdrawn refresh scope (R14/R15).

The runner-isolation model (plan R7, OD-4) EXCLUDES public/untrusted PR
execution by governance, not by hope: this sweep parses every workflow under
``.github/workflows/`` (read-only — this test never writes there) and pins
the two invariants that make the exclusion real:

* no workflow anywhere carries a PR-like trigger (``pull_request``,
  ``pull_request_target``, ``issue_comment``) — the trigger classes through
  which untrusted content reaches a runner;
* the self-hosted label set appears in ZERO jobs today. Phase D (T7) inverts
  this by moving exactly one job — ``publish`` in ``publish.yml`` — onto
  ``[self-hosted, macOS, populus-ops]``; when it does, that job is added to
  ``ALLOWED_SELF_HOSTED_JOBS`` below and the assertion keeps every OTHER job
  off the self-hosted machine.

T13: R14/R15 (nightly institutional refresh) were WITHDRAWN, not deferred
silently — ``docs/build/RUN-M2-12-inst-refresh-stub.md`` carries the scope.
The absence tests here fail the moment refresh code appears without a plan.
"""

from __future__ import annotations

from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS_DIR = REPO_ROOT / ".github" / "workflows"

#: The trigger classes that route untrusted (fork/comment) content into a
#: workflow run. Banned everywhere, not just on self-hosted jobs: a hosted job
#: with a PR trigger is one label edit away from being a self-hosted one.
BANNED_TRIGGERS = {"pull_request", "pull_request_target", "issue_comment"}

#: (workflow filename, job id) pairs allowed to run self-hosted. EMPTY today:
#: Phase A lands the controller before any workflow moves. Phase D / T7 adds
#: exactly one entry — ("publish.yml", "publish") — and nothing else, ever,
#: without a plan revision (R5 pins the other three jobs to ubuntu-latest).
ALLOWED_SELF_HOSTED_JOBS: list[tuple[str, str]] = []


def workflow_files() -> list[Path]:
    files = sorted(WORKFLOWS_DIR.glob("*.yml")) + sorted(WORKFLOWS_DIR.glob("*.yaml"))
    assert files, "no workflows found — the sweep would be vacuous"
    return files


def load_workflow(path: Path) -> dict:
    doc = yaml.safe_load(path.read_text())
    assert isinstance(doc, dict), f"{path.name}: not a mapping"
    return doc


def triggers_of(doc: dict, path: Path) -> set[str]:
    # YAML 1.1 parses a bare `on:` key as boolean True — both spellings must
    # be swept or a workflow hides its triggers from the sweep by accident.
    on = doc.get("on", doc.get(True))
    assert on is not None, f"{path.name}: workflow has no trigger block"
    if isinstance(on, str):
        return {on}
    if isinstance(on, list):
        return set(on)
    return set(on.keys())


def test_no_pr_like_triggers_anywhere():
    for path in workflow_files():
        found = triggers_of(load_workflow(path), path) & BANNED_TRIGGERS
        assert not found, (
            f"{path.name} uses banned trigger(s) {sorted(found)}: PR-like "
            f"triggers route untrusted content toward runners (R7e/OD-4)"
        )


def test_self_hosted_labels_only_in_allowed_jobs():
    actual: list[tuple[str, str]] = []
    for path in workflow_files():
        doc = load_workflow(path)
        for job_id, job in (doc.get("jobs") or {}).items():
            runs_on = job.get("runs-on", "")
            labels = [runs_on] if isinstance(runs_on, str) else list(runs_on)
            if any("self-hosted" in str(label) for label in labels):
                actual.append((path.name, job_id))
    assert sorted(actual) == sorted(ALLOWED_SELF_HOSTED_JOBS), (
        f"self-hosted jobs {actual} != allowed {ALLOWED_SELF_HOSTED_JOBS}; "
        f"moving a job onto the self-hosted machine requires a plan revision"
    )


# ---------------------------------------------------------------------------
# T13 — withdrawn refresh scope stays withdrawn (R14/R15 absence)
# ---------------------------------------------------------------------------

#: Code surfaces swept for the retired arming variable. Documentation is
#: deliberately excluded: the M2-12 stub NAMES the variable precisely so a
#: future plan knows what was retired — naming it in prose is the record,
#: referencing it in code is the regression.
CODE_SURFACES = ("src", "scripts", "dashboard/src", "ops", ".github", "tests")


def test_no_inst_refresh_module_exists():
    assert not (REPO_ROOT / "src" / "populus" / "inst_refresh.py").exists(), (
        "inst_refresh.py exists but R14/R15 were withdrawn — see "
        "docs/build/RUN-M2-12-inst-refresh-stub.md; refresh needs a new plan"
    )


def test_no_code_references_refresh_arming_variable():
    needle = "POPULUS_INST_REFRESH" + "_ARMED"  # split so this file never matches itself
    offenders = []
    for surface in CODE_SURFACES:
        base = REPO_ROOT / surface
        if not base.exists():
            continue
        for p in base.rglob("*"):
            # Skip build/bytecode caches: a compiled copy of THIS test would
            # otherwise trip the sweep on its own needle.
            if not p.is_file() or {"node_modules", "__pycache__"} & set(p.parts):
                continue
            if p.resolve() == Path(__file__).resolve():
                continue
            try:
                text = p.read_text(errors="replace")
            except OSError:
                continue
            if needle in text:
                offenders.append(str(p.relative_to(REPO_ROOT)))
    assert not offenders, (
        f"withdrawn refresh arming variable referenced in code: {offenders}"
    )


def test_refresh_stub_exists_and_carries_retention_obligation():
    stub = REPO_ROOT / "docs" / "build" / "RUN-M2-12-inst-refresh-stub.md"
    assert stub.exists(), "the M2-12 stub is the record that scope was withdrawn, not lost"
    text = stub.read_text()
    # LD-8/TD-7: the retention obligation must be recorded before snapshot v2.
    assert "retention" in text.lower()
