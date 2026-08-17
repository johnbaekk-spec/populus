"""RUN M2-11 R7e — repo-wide workflow governance sweep, plus the T13 absence
checks for the withdrawn refresh scope (R14/R15).

The runner-isolation model (plan R7, OD-4) EXCLUDES public/untrusted PR
execution by governance, not by hope: this sweep parses every workflow under
``.github/workflows/`` (read-only — this test never writes there) and pins
the two invariants that make the exclusion real:

* no workflow anywhere carries a PR-like trigger (``pull_request``,
  ``pull_request_target``, ``issue_comment``) — the trigger classes through
  which untrusted content reaches a runner;
* the self-hosted label set appears in exactly the jobs allowlisted below.
  Phase D (T7) moved one job — ``publish`` in ``publish.yml`` — onto
  ``[self-hosted, macOS, populus-ops]``; it is listed in
  ``ALLOWED_SELF_HOSTED_JOBS``, and the assertion keeps every OTHER job off
  the self-hosted machine. Dropping the entry does not weaken the sweep, it
  breaks it — the comparison is an equality in both directions.

T13: R14/R15 (nightly institutional refresh) were WITHDRAWN, not deferred
silently — ``docs/build/RUN-M2-12-inst-refresh-stub.md`` carries the scope.
The absence tests here fail the moment refresh code appears without a plan.
"""

from __future__ import annotations

from pathlib import Path
import json

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS_DIR = REPO_ROOT / ".github" / "workflows"
RUNNER_RUNBOOK = REPO_ROOT / "docs" / "runbooks" / "self-hosted-runner.md"
DASHBOARD_PACKAGE = REPO_ROOT / "dashboard" / "package.json"
ENTITY_POST_TEST = REPO_ROOT / "dashboard" / "test" / "post" / "entity-orchestration.test.ts"
CURRENT_RUNNER_VERSION = "2.336.0"
CURRENT_RUNNER_MACOS_ARM64_SHA256 = (
    "8e8839c49b7060b6b2154f4931f815df330c27f167d53ef2239ee3dfce28b079"
)

#: The trigger classes that route untrusted (fork/comment) content into a
#: workflow run. Banned everywhere, not just on self-hosted jobs: a hosted job
#: with a PR trigger is one label edit away from being a self-hosted one.
BANNED_TRIGGERS = {"pull_request", "pull_request_target", "issue_comment"}

#: (workflow filename, job id) pairs allowed to run self-hosted. Phase D / T7
#: added the one entry this list will ever hold: the publish job is the only
#: one that needs the 21 GB institutional store, and R5 pins the other three
#: jobs to ubuntu-latest. A second entry is a plan revision, not an edit —
#: the assertion below is an EQUALITY, so adding a job to the machine without
#: adding it here fails, and adding it here without a plan is a visible diff
#: in a CODEOWNERS-protected file.
ALLOWED_SELF_HOSTED_JOBS: list[tuple[str, str]] = [("publish.yml", "publish")]


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


def test_runner_runbook_pins_current_version_checksum_and_readback():
    text = RUNNER_RUNBOOK.read_text()
    assert f"RUNNER_VERSION={CURRENT_RUNNER_VERSION}" in text
    assert f"RUNNER_SHA256={CURRENT_RUNNER_MACOS_ARM64_SHA256}" in text
    assert "api.github.com/repos/actions/runner/releases/latest" in text
    assert 'image/bin/Runner.Listener --version' in text
    assert "v2.321.0" not in text


def test_full_site_build_uses_the_bounded_heap_wrapper_everywhere():
    """Tail fragmentation is intentionally eager and has a measured 14 GiB
    planning peak. Pin the 32 GiB machine preflight and 24 GiB child heap at the
    package boundary, then require both local gates and publish to use it. The
    workflow itself must not broaden NODE_OPTIONS to unrelated steps."""
    package = json.loads(DASHBOARD_PACKAGE.read_text())
    scripts = package["scripts"]
    bounded = scripts["build:bounded"]
    assert "totalmem()<34359738368" in bounded
    assert "NODE_OPTIONS=--max-old-space-size=24576 astro build" in bounded
    assert "npm run build:bounded" in scripts["gates"]
    assert "npm run build &&" not in scripts["gates"]

    publish_path = WORKFLOWS_DIR / "publish.yml"
    publish = load_workflow(publish_path)
    site_steps = [
        step
        for step in publish["jobs"]["publish"]["steps"]
        if step.get("name") == "Build site"
    ]
    assert len(site_steps) == 1
    assert "npm run build:bounded" in site_steps[0].get("run", "")
    assert "NODE_OPTIONS" not in publish_path.read_text(), (
        "the heap exception belongs only to the bounded build child, not a "
        "workflow/job env that also changes tests and packaging"
    )


def test_forced_cut_build_has_the_same_machine_and_child_heap_bounds():
    text = ENTITY_POST_TEST.read_text()
    assert "totalmem() >= 34_359_738_368" in text
    assert 'NODE_OPTIONS: "--max-old-space-size=24576"' in text
    assert "timeout: 900_000" in text


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


# ---------------------------------------------------------------------------
# R42/R44 — the corpus loop's shape is part of the governance contract.
#
# Every one of these is a step-ORDER or step-PRESENCE property. They exist
# because the corpus loop is only sound in one arrangement: seed before the
# ingests (nothing to preserve otherwise), floor after the member join (it
# checks join identities) and before the build (a refusal must stop the
# publish, not annotate it).
# ---------------------------------------------------------------------------


def _publish_steps() -> list[dict]:
    document = yaml.safe_load((WORKFLOWS_DIR / "publish.yml").read_text())
    return document["jobs"]["publish"]["steps"]


def _step_index(name_fragment: str) -> int:
    for index, step in enumerate(_publish_steps()):
        if name_fragment in (step.get("name") or ""):
            return index
    raise AssertionError(
        f"no publish step named like {name_fragment!r}: "
        f"{[s.get('name') for s in _publish_steps()]}"
    )


def test_the_corpus_is_seeded_before_the_ingests():
    assert _step_index("Seed the corpus") < _step_index("Ingest (live")


def test_the_corpus_floor_runs_after_the_member_join_and_before_the_build():
    # After the join: the floor checks join identities, which do not exist
    # until it has run. Before the build: a refusal must STOP the publish.
    assert _step_index("Ingest members") < _step_index("Corpus floor")
    assert _step_index("Corpus floor") < _step_index("Stage build")


def test_the_senate_era_backfill_is_bounded_on_both_ends():
    # An unbounded "start -> forever" request is not an era fill; the upper
    # bound is what makes it one.
    step = _publish_steps()[_step_index("Senate era backfill")]
    assert "--submitted-start" in step["run"] and "--submitted-end" in step["run"]
    assert step["if"], "the era backfill must be gated on its dispatch input"


def test_no_fresh_database_fallback_survives_in_the_workflow():
    # The regression this whole milestone exists to prevent: any step that
    # initializes populus.db from nothing puts B25 straight back.
    for step in _publish_steps():
        run = step.get("run") or ""
        assert "populus db init" not in run, (
            f"step {step.get('name')!r} initializes a fresh store — the"
            " fresh-database path is the cause of B24 and B25, never a fallback"
        )


def test_the_corpus_bootstrap_inputs_cannot_reach_a_scheduled_run():
    # `schedule:` carries no inputs at all, so an unattended nightly can
    # neither re-fetch fourteen years of Senate history nor authorize a corpus
    # shrink. Pinned because both would be silent if it ever changed.
    document = yaml.safe_load((WORKFLOWS_DIR / "publish.yml").read_text())
    triggers = document[True]
    assert "inputs" not in (triggers["schedule"] or [{}])[0]
    dispatch_inputs = triggers["workflow_dispatch"]["inputs"]
    assert "senate_era_backfill" in dispatch_inputs
    assert "corpus_floor_allow_reparse" in dispatch_inputs


def test_no_dispatch_input_is_interpolated_into_a_shell_script_body():
    """Round-1 F2: `${{ }}` substitution happens BEFORE the shell parses.

    A free-text dispatch input pasted into a `run:` body lets a single quote
    close the quoting and run the rest as commands — as the runner account, on
    the owner's Mac, which is a persistent self-hosted machine. Inputs must
    reach commands through the ENVIRONMENT, where they are values and never
    script text. `if:` expressions are a different context and are exempt.
    """
    offenders = []
    for step in _publish_steps():
        run = step.get("run") or ""
        if "inputs." in run:
            offenders.append(step.get("name"))
    assert offenders == [], (
        "dispatch inputs interpolated directly into run: bodies "
        f"(pass them via env: instead): {offenders}"
    )


def test_the_reparse_authorization_reaches_the_command_through_the_environment():
    step = _publish_steps()[_step_index("Corpus floor")]
    assert "CORPUS_FLOOR_ALLOW_REPARSE" in (step.get("env") or {})
    assert '"$CORPUS_FLOOR_ALLOW_REPARSE"' in step["run"], (
        "the env value must be expanded as ONE quoted argument"
    )
