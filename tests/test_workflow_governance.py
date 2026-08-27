"""Workflow governance sweep — RUN PUBLIC-SECURITY-HARDENING PR 1 (R2/R3/R5,
LD3), superseding the RUN M2-11 R7e blanket PR-trigger ban, plus the retained
T13 absence checks for the withdrawn refresh scope (R14/R15).

The repository is now PUBLIC, so fork PRs must run checks before merge. LD3
allows `pull_request` narrowly: ONLY `.github/workflows/checks.yml` may carry
it, and that workflow must be structurally fork-safe — every job on a
GitHub-hosted runner, `permissions: contents: read` and nothing wider, no
job-level `uses:` (reusable workflow), no `environment:`, no `${{ secrets.* }}`
reference anywhere in the file, and `persist-credentials: false` on every
checkout. `pull_request_target` and `issue_comment` remain banned repo-wide,
and the self-hosted label set appears in exactly the allowlisted jobs
(`publish.yml:publish` — the comparison is an equality in both directions).

The checks are written as pure functions over (filename, parsed-doc, raw-text)
so the mutation tests below can prove each one KILLS its regression: a PR job
moved to self-hosted, a secret reference, `contents: write`, a job-level
`uses:`, `pull_request_target`, a shallow Gitleaks checkout, candidate-policy
substitution, removed redaction, a report upload, and a broad ignore entry.

This sweep is read-only; it never writes under `.github/`.
"""

from __future__ import annotations

import copy
import json
import re
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS_DIR = REPO_ROOT / ".github" / "workflows"
RUNNER_RUNBOOK = REPO_ROOT / "docs" / "runbooks" / "self-hosted-runner.md"
DASHBOARD_PACKAGE = REPO_ROOT / "dashboard" / "package.json"
ENTITY_POST_TEST = REPO_ROOT / "dashboard" / "test" / "post" / "entity-orchestration.test.ts"
GITLEAKS_TOML = REPO_ROOT / ".gitleaks.toml"
GITLEAKS_IGNORE = REPO_ROOT / ".gitleaksignore"
CURRENT_RUNNER_VERSION = "2.336.0"
CURRENT_RUNNER_MACOS_ARM64_SHA256 = (
    "8e8839c49b7060b6b2154f4931f815df330c27f167d53ef2239ee3dfce28b079"
)

#: The only workflow allowed to respond to `pull_request` (LD3).
PR_TRIGGER_ALLOWED_WORKFLOWS = {"checks.yml"}

#: Privileged / content-driven trigger classes banned in EVERY workflow.
BANNED_TRIGGERS_EVERYWHERE = {"pull_request_target", "issue_comment"}

#: The four exact required-check contexts the main ruleset binds (R3). These
#: are job `name:` values in checks.yml; renaming one silently unbinds a
#: required check, so the names are pinned literally.
REQUIRED_CHECK_NAMES = {
    "python (pytest)",
    "dashboard (typecheck + unit)",
    "gitleaks (all history)",
    "dependency review",
}

#: (workflow filename, job id) pairs allowed to run self-hosted. The publish
#: job is the only one that needs the 21 GB institutional store. A second
#: entry is a plan revision, not an edit — the assertion is an EQUALITY, so
#: adding a job to the machine without adding it here fails, and adding it
#: here without a plan is a visible diff in a CODEOWNERS-protected file.
ALLOWED_SELF_HOSTED_JOBS: list[tuple[str, str]] = [("publish.yml", "publish")]

#: The immutable multi-platform Gitleaks 8.30.1 image (R5).
GITLEAKS_IMAGE_DIGEST = (
    "ghcr.io/gitleaks/gitleaks@sha256:"
    "c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f"
)

#: Exact-fingerprint shape for .gitleaksignore entries: commit:file:rule:line.
FINGERPRINT_RE = re.compile(r"^[0-9a-f]{40}:[^:*?\[\]]+:[a-z0-9._-]+:\d+$")


def workflow_files() -> list[Path]:
    files = sorted(WORKFLOWS_DIR.glob("*.yml")) + sorted(WORKFLOWS_DIR.glob("*.yaml"))
    assert files, "no workflows found — the sweep would be vacuous"
    return files


def load_workflow(path: Path) -> dict:
    doc = yaml.safe_load(path.read_text())
    assert isinstance(doc, dict), f"{path.name}: not a mapping"
    return doc


def triggers_of(doc: dict, name: str) -> set[str]:
    # YAML 1.1 parses a bare `on:` key as boolean True — both spellings must
    # be swept or a workflow hides its triggers from the sweep by accident.
    on = doc.get("on", doc.get(True))
    assert on is not None, f"{name}: workflow has no trigger block"
    if isinstance(on, str):
        return {on}
    if isinstance(on, list):
        return set(on)
    return set(on.keys())


# ---------------------------------------------------------------------------
# Pure checkers. Each returns a list of violation strings; the real-tree tests
# require [], and the mutation tests require non-[] for every regression.
# ---------------------------------------------------------------------------


def trigger_errors(name: str, doc: dict) -> list[str]:
    """Repo-wide trigger policy: banned classes nowhere; PR only on allowlist."""
    errors = []
    trig = triggers_of(doc, name)
    banned = trig & BANNED_TRIGGERS_EVERYWHERE
    if banned:
        errors.append(f"{name}: banned trigger(s) {sorted(banned)}")
    if "pull_request" in trig and name not in PR_TRIGGER_ALLOWED_WORKFLOWS:
        errors.append(f"{name}: pull_request is allowed only in {PR_TRIGGER_ALLOWED_WORKFLOWS}")
    return errors


def _permissions_write_errors(name: str, where: str, perms: object) -> list[str]:
    if perms is None:
        return []
    if isinstance(perms, str):
        return [] if perms == "read-all" else [f"{name}: {where} permissions {perms!r}"]
    assert isinstance(perms, dict), f"{name}: {where} permissions not a mapping"
    return [
        f"{name}: {where} permission {scope}: {level}"
        for scope, level in perms.items()
        if level != "read"
    ]


def pr_workflow_structure_errors(name: str, doc: dict, text: str) -> list[str]:
    """LD3 structural fork-safety proof for the PR-triggered workflow."""
    errors = []
    if re.search(r"\$\{\{\s*secrets\.", text):
        errors.append(f"{name}: references ${{{{ secrets.* }}}}")
    errors += _permissions_write_errors(name, "workflow-level", doc.get("permissions"))
    if doc.get("permissions") != {"contents": "read"}:
        errors.append(f"{name}: workflow permissions must be exactly contents: read")
    for job_id, job in (doc.get("jobs") or {}).items():
        if "uses" in job:
            errors.append(f"{name}:{job_id}: job-level uses: (reusable workflow) is banned")
            continue
        if "environment" in job:
            errors.append(f"{name}:{job_id}: environment: is banned in the PR workflow")
        errors += _permissions_write_errors(name, f"job {job_id}", job.get("permissions"))
        runs_on = job.get("runs-on")
        labels = [runs_on] if isinstance(runs_on, str) else list(runs_on or [])
        if not labels:
            errors.append(f"{name}:{job_id}: no runs-on")
        for label in labels:
            label = str(label)
            if "self-hosted" in label or not label.startswith(("ubuntu-", "macos-", "windows-")):
                errors.append(f"{name}:{job_id}: non-hosted runner label {label!r}")
        for step in job.get("steps") or []:
            uses = step.get("uses") or ""
            if uses.startswith("actions/checkout@"):
                if (step.get("with") or {}).get("persist-credentials") is not False:
                    errors.append(
                        f"{name}:{job_id}: checkout without persist-credentials: false"
                    )
    return errors


def gitleaks_job_errors(doc: dict, text: str) -> list[str]:
    """R5 structural proof of the full-history secret-scan job."""
    errors = []
    jobs = doc.get("jobs") or {}
    job = next((j for j in jobs.values() if j.get("name") == "gitleaks (all history)"), None)
    if job is None:
        return ["checks.yml: no job named 'gitleaks (all history)'"]
    steps = job.get("steps") or []
    checkout = next((s for s in steps if str(s.get("uses", "")).startswith("actions/checkout@")), None)
    if checkout is None or (checkout.get("with") or {}).get("fetch-depth") != 0:
        errors.append("gitleaks checkout must set fetch-depth: 0 (full history)")
    runs = "\n".join(s.get("run") or "" for s in steps)
    if GITLEAKS_IMAGE_DIGEST not in runs:
        errors.append("gitleaks must run the exact OCI-digest-pinned image")
    if "--redact=100" not in runs:
        errors.append("gitleaks must redact 100%")
    if "--no-banner" not in runs:
        errors.append("gitleaks must pass --no-banner")
    if '--log-opts="--all"' not in runs:
        errors.append("gitleaks must scan every ref (--log-opts=\"--all\")")
    if ":ro" not in runs:
        errors.append("gitleaks mounts must be read-only")
    if "--report-path" in runs or "--report-format" in runs:
        errors.append("gitleaks must not write a report file")
    # PR runs must materialize policy from the TRUSTED base SHA, not the
    # candidate tree: the env plumbing and both `git show <base>:` reads must
    # exist, and the scan must consume the materialized runner-temp policy.
    step_text = json.dumps(steps)
    if "github.event.pull_request.base.sha" not in step_text:
        errors.append("gitleaks PR policy must come from github.event.pull_request.base.sha")
    if ":.gitleaks.toml" not in runs or ":.gitleaksignore" not in runs:
        errors.append("gitleaks must `git show <base>:.gitleaks.toml/.gitleaksignore` on PRs")
    if "--config" not in runs or "--gitleaks-ignore-path" not in runs:
        errors.append("gitleaks must pass --config and --gitleaks-ignore-path explicitly")
    for step in steps:
        if str(step.get("uses", "")).startswith("actions/upload-artifact"):
            errors.append("gitleaks job must not upload artifacts")
    return errors


def gitleaksignore_errors(lines: list[str]) -> list[str]:
    """Every non-comment line must be an exact commit:file:rule:line
    fingerprint — a path glob or directory-wide entry is a forbidden broad
    allowlist (R5)."""
    errors = []
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if not FINGERPRINT_RE.match(line):
            errors.append(f".gitleaksignore: not an exact fingerprint: {line!r}")
    return errors


def _checks() -> tuple[dict, str]:
    path = WORKFLOWS_DIR / "checks.yml"
    return load_workflow(path), path.read_text()


# ---------------------------------------------------------------------------
# Real-tree assertions
# ---------------------------------------------------------------------------


def test_trigger_policy_repo_wide():
    for path in workflow_files():
        assert trigger_errors(path.name, load_workflow(path)) == []


def test_only_checks_yml_actually_carries_pull_request():
    # The allowlist must not be vacuous: checks.yml really is PR-triggered.
    doc, _ = _checks()
    assert "pull_request" in triggers_of(doc, "checks.yml")


def test_pr_workflow_is_structurally_fork_safe():
    doc, text = _checks()
    assert pr_workflow_structure_errors("checks.yml", doc, text) == []


def test_required_check_names_are_pinned():
    doc, _ = _checks()
    names = {job.get("name") for job in (doc.get("jobs") or {}).values()}
    missing = REQUIRED_CHECK_NAMES - names
    assert not missing, (
        f"checks.yml is missing required-check job name(s) {sorted(missing)}; "
        f"the main ruleset binds these contexts literally (R3)"
    )


def test_gitleaks_job_structure():
    doc, text = _checks()
    assert gitleaks_job_errors(doc, text) == []


def test_gitleaks_policy_files_are_narrow():
    toml_text = GITLEAKS_TOML.read_text()
    assert "[extend]" in toml_text and "useDefault = true" in toml_text
    assert "[[rules]]" not in toml_text, "custom rules require a plan revision"
    assert "paths" not in toml_text, "path allowlists in .gitleaks.toml are forbidden (R5)"
    assert gitleaksignore_errors(GITLEAKS_IGNORE.read_text().splitlines()) == []


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


def test_production_workflows_have_no_pr_like_trigger():
    for path in workflow_files():
        if path.name in PR_TRIGGER_ALLOWED_WORKFLOWS:
            continue
        trig = triggers_of(load_workflow(path), path.name)
        assert not (trig & ({"pull_request"} | BANNED_TRIGGERS_EVERYWHERE)), (
            f"{path.name}: production workflows must never carry a PR-like trigger"
        )


# ---------------------------------------------------------------------------
# Killing mutations (Task 1 step 3). Each rewrites the REAL checks.yml
# in-memory and proves the corresponding checker fails — so weakening a
# checker without noticing is not possible.
# ---------------------------------------------------------------------------


def _mutant() -> tuple[dict, str]:
    doc, text = _checks()
    return copy.deepcopy(doc), text


def _first_job(doc: dict) -> dict:
    return next(iter(doc["jobs"].values()))


def test_mutation_pr_job_on_self_hosted_is_killed():
    doc, text = _mutant()
    _first_job(doc)["runs-on"] = ["self-hosted", "macOS", "populus-ops"]
    assert pr_workflow_structure_errors("checks.yml", doc, text)


def test_mutation_secret_reference_is_killed():
    doc, text = _mutant()
    assert pr_workflow_structure_errors(
        "checks.yml", doc, text + "\n# env: TOKEN: ${{ secrets.DATA_REPO_PAT }}\n"
    )


def test_mutation_write_permission_is_killed():
    doc, text = _mutant()
    doc["permissions"] = {"contents": "write"}
    assert pr_workflow_structure_errors("checks.yml", doc, text)
    doc, text = _mutant()
    _first_job(doc)["permissions"] = {"id-token": "write"}
    assert pr_workflow_structure_errors("checks.yml", doc, text)


def test_mutation_job_level_reusable_workflow_is_killed():
    doc, text = _mutant()
    doc["jobs"]["reused"] = {"uses": "./.github/workflows/record-sign.yml"}
    assert pr_workflow_structure_errors("checks.yml", doc, text)


def test_mutation_environment_is_killed():
    doc, text = _mutant()
    _first_job(doc)["environment"] = "production-pages-deploy"
    assert pr_workflow_structure_errors("checks.yml", doc, text)


def test_mutation_pull_request_target_is_killed():
    doc, _ = _mutant()
    on = doc.get("on", doc.get(True))
    on["pull_request_target"] = None
    assert trigger_errors("checks.yml", doc)


def test_mutation_pull_request_on_production_workflow_is_killed():
    publish = load_workflow(WORKFLOWS_DIR / "publish.yml")
    publish = copy.deepcopy(publish)
    on = publish.get("on", publish.get(True))
    on["pull_request"] = None
    assert trigger_errors("publish.yml", publish)


def test_mutation_persist_credentials_removed_is_killed():
    doc, text = _mutant()
    for job in doc["jobs"].values():
        for step in job.get("steps") or []:
            if str(step.get("uses", "")).startswith("actions/checkout@"):
                step.setdefault("with", {}).pop("persist-credentials", None)
    assert pr_workflow_structure_errors("checks.yml", doc, text)


def _gitleaks_job(doc: dict) -> dict:
    return next(j for j in doc["jobs"].values() if j.get("name") == "gitleaks (all history)")


def _rewrite_runs(job: dict, old: str, new: str) -> None:
    hit = False
    for step in job["steps"]:
        run = step.get("run")
        if run and old in run:
            step["run"] = run.replace(old, new)
            hit = True
    assert hit, f"mutation target {old!r} not found — the mutation would be vacuous"


def test_mutation_shallow_gitleaks_checkout_is_killed():
    doc, text = _mutant()
    job = _gitleaks_job(doc)
    for step in job["steps"]:
        if str(step.get("uses", "")).startswith("actions/checkout@"):
            step["with"].pop("fetch-depth", None)
    assert gitleaks_job_errors(doc, text)


def test_mutation_candidate_policy_substitution_is_killed():
    # A fork editing the scanner policy in the same PR must not be able to
    # feed that candidate policy to the scan: the base-SHA materialization is
    # structural. Simulate replacing it with checked-out-tree policy.
    doc, text = _mutant()
    job = _gitleaks_job(doc)
    for step in job["steps"]:
        if step.get("env") and "github.event.pull_request.base.sha" in json.dumps(step["env"]):
            step["env"] = {}
            step["run"] = 'cp .gitleaks.toml .gitleaksignore "$RUNNER_TEMP/"'
    assert gitleaks_job_errors(doc, text)


def test_mutation_removed_redaction_is_killed():
    doc, text = _mutant()
    _rewrite_runs(_gitleaks_job(doc), "--redact=100", "")
    assert gitleaks_job_errors(doc, text)


def test_mutation_partial_history_scan_is_killed():
    doc, text = _mutant()
    _rewrite_runs(_gitleaks_job(doc), '--log-opts="--all"', "")
    assert gitleaks_job_errors(doc, text)


def test_mutation_report_output_is_killed():
    doc, text = _mutant()
    job = _gitleaks_job(doc)
    _rewrite_runs(job, "--no-banner", "--no-banner --report-path=/tmp/report.json")
    assert gitleaks_job_errors(doc, text)
    doc, text = _mutant()
    job = _gitleaks_job(doc)
    job["steps"].append({"uses": "actions/upload-artifact@v4", "with": {"path": "/tmp"}})
    assert gitleaks_job_errors(doc, text)


def test_mutation_writable_mount_is_killed():
    doc, text = _mutant()
    _rewrite_runs(_gitleaks_job(doc), ":ro", "")
    assert gitleaks_job_errors(doc, text)


def test_mutation_broad_ignore_is_killed():
    lines = GITLEAKS_IGNORE.read_text().splitlines()
    assert gitleaksignore_errors(lines + ["tests/*"])
    assert gitleaksignore_errors(lines + ["tests/test_deploy_record.py"])
    assert gitleaksignore_errors(lines + ["*:tests/test_deploy_record.py:generic-api-key:1"])


# ---------------------------------------------------------------------------
# Retained pre-hardening governance assertions (unchanged below this line).
# ---------------------------------------------------------------------------


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
