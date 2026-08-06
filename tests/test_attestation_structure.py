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
import re
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
PRODUCTION_ROOTS = (REPO_ROOT / "src", REPO_ROOT / "scripts")
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "publish.yml"


def _attestation_taking_names() -> set[str]:
    """Every callable that accepts an ``attestation`` argument, by inspection.

    Derived rather than listed, so adding a new one is automatically covered.

    Discovery walks EVERY module under `populus`, not a hardcoded three — an
    earlier version listed `publish.build`, `publish.pointer` and
    `client.snapshot`, so an attestation-taking function added anywhere else
    would have been invisible and the guard would have passed vacuously.
    """
    import importlib
    import pkgutil

    import populus

    modules = []
    for info in pkgutil.walk_packages(populus.__path__, "populus."):
        try:
            modules.append(importlib.import_module(info.name))
        except Exception:  # pragma: no cover - optional/broken imports
            continue

    names: set[str] = set()
    for module in modules:
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
            # `**kwargs` forwarding is opaque to AST. Treating it as "passing"
            # was a hole: a production call could forward a dict that happens not
            # to contain `attestation` and slip through. Flag it instead — a
            # handful of false positives is the right trade for a guard whose
            # entire job is catching what a search cannot see.
            if any(kw.arg is None for kw in node.keywords):
                rel = path.relative_to(REPO_ROOT)
                offenders.append(
                    f"{rel}:{node.lineno} {name}(**kwargs) — forwards opaquely; "
                    "pass `attestation` explicitly"
                )
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


def _workflow_doc() -> dict:
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def _jobs() -> dict[str, dict]:
    """Every job in the publish workflow, not just ``publish``.

    R21: reading only ``jobs["publish"]`` made a new job invisible to every
    assertion below — a deploy job could hold any permission it liked and no
    guard would notice. Callers that genuinely mean the publish job say so.
    """
    return _workflow_doc()["jobs"]


def _publish_job() -> dict:
    return _jobs()["publish"]


def _steps(job: str = "publish") -> list[dict]:
    return _jobs()[job].get("steps") or []


def _all_steps() -> list[tuple[str, dict]]:
    """``(job name, step)`` across every job."""
    return [(name, step) for name, job in _jobs().items() for step in (job.get("steps") or [])]


def _step_index(name_fragment: str, job: str = "publish") -> int:
    """Index of the uniquely-matching step, or fail.

    Returning the *first* substring match let an unrelated new step capture the
    lookup: a pre-publish gate named "Verify prior generation" placed before
    "Attest published artifacts" would silently become ``_step_index("verify")``
    and flip three unrelated assertions green-to-red for a reason none of them
    names. Requiring uniqueness turns that into one loud, accurate failure.
    """
    matches = [
        i
        for i, step in enumerate(_steps(job))
        if name_fragment.lower() in str(step.get("name", "")).lower()
    ]
    if not matches:
        raise AssertionError(f"no step named like {name_fragment!r} in job {job!r}")
    if len(matches) > 1:
        names = [str(_steps(job)[i].get("name")) for i in matches]
        raise AssertionError(
            f"{name_fragment!r} matches {len(matches)} steps in job {job!r}: {names}. "
            "Rename one, or scope the lookup — an ambiguous match makes every "
            "ordering assertion below meaningless."
        )
    return matches[0]


def _attestation_taking_commands() -> list[str]:
    """CLI subcommands that actually accept ``--attestation``, derived not listed.

    R21: the hardcoded ``["build", "publish", "verify"]`` could not see a new
    entry point, and could not tell that ``populus deploy`` and the pre-publish
    gate legitimately take no such flag. Asking the CLI removes both failure
    modes — a new attestation-taking command joins automatically, and a command
    without the option is never asserted to carry it.
    """
    import click

    from populus.cli import main

    ctx = click.Context(main)
    out = []
    for name in main.list_commands(ctx):
        command = main.get_command(ctx, name)
        if any("--attestation" in getattr(p, "opts", []) for p in command.params):
            out.append(name)
    return sorted(out)


def test_publish_job_has_attestation_permissions() -> None:
    """R1 — attesting requires both scopes; R9 — reading requires the third."""
    perms = _publish_job()["permissions"]
    assert perms.get("id-token") == "write", "missing id-token: write"
    assert perms.get("attestations") == "write", "missing attestations: write"


def test_publish_job_permissions_are_least_privilege() -> None:
    """`contents: read` is what bounds the GH_TOKEN relaxation in
    test_publish_workflow_gh_token_step_scoped: any number of steps may now
    carry `github.token`, which is only safe while that token cannot write to
    the repo. A flip to `contents: write` must fail here."""
    perms = _publish_job()["permissions"]
    assert perms.get("contents") == "read", (
        "the publish job's github.token must stay read-only — steps are "
        "permitted to carry it freely on that basis"
    )


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


def test_every_populus_invocation_selects_a_provider() -> None:
    """R14/R21 — a defaultless flag with un-updated callers breaks the very
    workflow that is supposed to prove the chain (round-3 F19).

    The command list is derived from the CLI rather than hardcoded, so a new
    attestation-taking subcommand is covered the day it exists, and a command
    that takes no such option (``populus deploy``, the pre-publish gate) is
    never asserted to carry one.
    """
    commands = _attestation_taking_commands()
    assert commands, "no CLI command takes --attestation — guard is vacuous"
    runs = [str(step.get("run", "")) for _, step in _all_steps()]
    for command in commands:
        invocations = [r for r in runs if f"populus {command}" in r]
        if not invocations:
            # Not every attestation-taking command must appear in the workflow;
            # the ones that do must carry the flag. `test_workflow_invokes_the_
            # attested_pipeline` below pins the ones that must be present.
            continue
        for run in invocations:
            assert "--attestation" in run, f"`populus {command}` omits --attestation"


def test_workflow_invokes_the_attested_pipeline() -> None:
    """The derived list must not let the workflow drop the chain entirely.

    Deriving from the CLI removes drift, but on its own it would also pass a
    workflow that stopped invoking the pipeline at all. These are the entry
    points the deploy chain cannot lose; T5's split renames the first, so this
    set is what must be updated deliberately rather than discovered in CI.
    """
    runs = " ".join(str(step.get("run", "")) for _, step in _all_steps())
    for required in ("populus publish", "populus verify"):
        assert required in runs, f"workflow no longer invokes `{required}`"
    assert (
        "populus build" in runs
        or ("populus stage-build" in runs and "populus finalize-build" in runs)
    ), "workflow invokes neither `populus build` nor the staged build seam"


def test_no_job_holds_both_pages_write_and_github_write() -> None:
    """§14 as amended (R7): the invariant is per-JOB, and every job is checked.

    Reading only ``jobs["publish"]`` meant a deploy job could carry the
    Cloudflare token alongside ``attestations: write`` and no guard would see
    it. The operative property is that a job holding Pages authority cannot
    mint an attestation, which requires ``id-token: write``.
    """
    for name, job in _jobs().items():
        rendered = yaml.safe_dump(job)
        holds_pages_write = "CLOUDFLARE_API_TOKEN" in rendered or "wrangler" in rendered
        if not holds_pages_write:
            continue
        perms = job.get("permissions") or {}
        assert perms.get("id-token") != "write", (
            f"job {name!r} holds Pages authority and `id-token: write` — it can "
            "mint an attestation for bytes it also controls (§14)"
        )
        assert perms.get("attestations") != "write", (
            f"job {name!r} holds Pages authority and `attestations: write` (§14)"
        )
        assert perms.get("contents") != "write", (
            f"job {name!r} holds Pages authority and `contents: write` (§14)"
        )


# --- R1/R2: the site-build seam and its env contract -------------------------


def test_the_build_seam_is_complete() -> None:
    """R2 — staging without finalizing publishes `site_file_count: null`.

    `require_site_file_count` catches that at publish time, but only once the
    gate is wired; a workflow that stages and never finalizes should not get
    that far. Cheap to check here, and it fails for the right reason.
    """
    runs = " ".join(str(step.get("run", "")) for _, step in _all_steps())
    if "populus stage-build" not in runs:
        return  # single-phase build; nothing to complete
    assert "populus finalize-build" in runs, (
        "the workflow stages a build but never finalizes it — the published "
        "stats.json would carry `site_file_count: null` and describe a site "
        "nobody counted"
    )


def test_the_site_build_supplies_the_whole_env_contract() -> None:
    """R1 — `data.ts` refuses only two of these under CI; the rest fail open.

    `POPULUS_TICKER_MAP` is the dangerous one: unset, `inst.ts` falls back to a
    committed TEST FIXTURE, and the site would serve fixture-derived ticker
    mappings as production data. The served-tree sweep cannot detect that,
    because the served bytes would faithfully match the built bytes.
    """
    site_steps = [
        step
        for _, step in _all_steps()
        if "npm run build" in str(step.get("run", ""))
    ]
    if not site_steps:
        return  # no site build in this workflow yet
    for step in site_steps:
        env = step.get("env") or {}
        for required in (
            "POPULUS_BUILD_DIR",
            "POPULUS_DB",
            "POPULUS_TICKER_MAP",
            "SITE_CODE_SHA",
        ):
            assert required in env, (
                f"site build step {step.get('name')!r} does not set {required} — "
                "see R1; an unset POPULUS_TICKER_MAP silently ships fixture data"
            )
        assert "fixtures" not in str(env["POPULUS_TICKER_MAP"]), (
            "POPULUS_TICKER_MAP points into a fixtures path — that is the "
            "production-data hazard R1 exists to close (TD-7)"
        )
        # R19: the verifier compares populus:code_sha EXACTLY, so a shortened
        # sha would fail every deploy. Pin the full one.
        assert env["SITE_CODE_SHA"] == "${{ github.sha }}", (
            "SITE_CODE_SHA must be the full github.sha — the marker comparison "
            "is exact, never a prefix match"
        )


# --- R16: the documentation regression check ---------------------------------

ARCHITECTURE = REPO_ROOT / "ARCHITECTURE.md"

#: The revision-history table is where corrections are RECORDED, so it quotes
#: the very strings this check forbids. Excluding it is not a loophole — it is
#: the difference between "the spec still claims full coverage" and "the spec
#: records that it once did and was wrong". Deleting the record to satisfy a
#: grep is the silent-drop failure this check exists to prevent, and it has
#: already happened once on this plan (round-2 F8).
_REVISION_TABLE_END = "## "


def _architecture_body() -> list[tuple[int, str]]:
    """`(line number, text)` for every line after the revision-history table."""
    lines = ARCHITECTURE.read_text(encoding="utf-8").splitlines()
    start = next(
        (i for i, line in enumerate(lines) if line.startswith(_REVISION_TABLE_END)),
        0,
    )
    return [(i + 1, line) for i, line in enumerate(lines) if i >= start]


@pytest.mark.parametrize(
    "forbidden,why",
    [
        (
            '"verification_scope": "full"',
            "the served-tree scope is `expected_paths`; `full` was a scope "
            "OVERCLAIM — fetching every inventory path cannot detect ADDED "
            "files or provider controls (round-11 C2, TD-10)",
        ),
        (
            "full served-tree",
            "same overclaim in prose; the verification is inventory-wide, "
            "which is not the same as complete",
        ),
    ],
)
def test_architecture_does_not_reclaim_full_verification_scope(
    forbidden: str, why: str
) -> None:
    """R16 — a correction that can silently revert is not a correction.

    Round 11 corrected this overclaim. Revision 1 of the P3-3b plan dropped the
    correction, round 2 caught it, and it had to be restored. Nothing structural
    stopped that regression, so this is that structure.
    """
    offenders = [
        f"ARCHITECTURE.md:{number}: {line.strip()[:120]}"
        for number, line in _architecture_body()
        if forbidden in line
    ]
    assert offenders == [], (
        f"ARCHITECTURE.md reclaims {forbidden!r} outside the revision history — "
        f"{why}.\n  " + "\n  ".join(offenders)
    )


def test_the_revision_history_record_is_still_there() -> None:
    """The other half: the check above must not be satisfiable by DELETING the record.

    Without this, a future run could make the regression check pass by removing
    the round-11 row — trading a visible overclaim for a lost audit trail, which
    is strictly worse.
    """
    head = ARCHITECTURE.read_text(encoding="utf-8").splitlines()
    table = [line for line in head[:40] if line.startswith("|")]
    assert any("full served-tree" in line for line in table), (
        "the revision-history record of the round-11 scope correction is gone — "
        "the correction is only durable while the reason for it survives"
    )


def test_every_needs_output_reference_is_declared() -> None:
    """A `needs.<job>.outputs.<name>` that no job declares resolves to "".

    GitHub does not error on this — the expression is simply empty, so a deploy
    job would download an artifact named `site-` and a signer would attest a
    build id of nothing. Nothing else in this suite would notice, because every
    YAML-shape assertion still passes. Found exactly that way.
    """
    doc = _workflow_doc()
    declared = {
        f"{job_name}.{output}"
        for job_name, job in doc["jobs"].items()
        for output in (job.get("outputs") or {})
    }
    referenced: set[str] = set()
    for job_name, job in doc["jobs"].items():
        for match in re.finditer(
            r"needs\.([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_-]+)",
            yaml.safe_dump(job, width=10**6),
        ):
            referenced.add(f"{match.group(1)}.{match.group(2)}")
    missing = sorted(referenced - declared)
    assert missing == [], (
        "these `needs.*.outputs.*` references resolve to the empty string "
        f"because no job declares them: {missing}"
    )


def test_a_skipped_signer_fails_the_run() -> None:
    """R20 — the asymmetry that makes this necessary.

    `POPULUS_RECORD_SIGN_ARMED` gates the signer at JOB level. Unset while
    publishing stays armed, the job is **skipped and reports success**: the
    deploy completes, no generation is written, and nothing notices until the
    R18 gate fires a day later. `needs.<job>.result` distinguishes `skipped`
    from `success`, but only if something actually asserts on it.

    A skipped DEPLOY job is legitimate — it is `needs: publish`, skipped
    whenever publish is skipped, which is the entire unarmed state. Tightening
    that would make every unarmed nightly a failure. A skipped signer means a
    deployment went live unrecorded; a skipped deploy means nothing went live.
    """
    jobs = _jobs()
    # `width` matters: yaml.safe_dump wraps at 80 columns by default and will
    # split `needs.sign.result` across a line continuation, so a substring
    # search silently finds nothing and this test passes by failing to look.
    guards = {
        name: job
        for name, job in jobs.items()
        if "needs.sign.result" in yaml.safe_dump(job, width=10**6)
    }
    assert guards, (
        "no job asserts on `needs.sign.result` — if the signer is skipped the "
        "run still reports success and a deployment goes live with no attested "
        "generation (R20)"
    )
    for name, job in guards.items():
        # Read the step bodies directly. Re-dumping to YAML and searching the
        # result matches against escaping artifacts (`!= \"success\"`) rather
        # than against what the shell will actually run — the same class of
        # mistake as comparing a re-serialized document to canonical bytes.
        bodies = " ".join(str(step.get("run", "")) for step in (job.get("steps") or []))
        assert "always()" in str(job.get("if", "")), (
            f"job {name!r} guards the signer but is not `if: always()` — it "
            "would itself be skipped in exactly the case it exists to catch"
        )
        assert "!= " in bodies and "success" in bodies, (
            f"job {name!r} must fail on any non-success signer result; "
            "`skipped` is not `failure`, so testing for failure alone misses it"
        )
        assert "= \"failure\"" not in bodies and "= 'failure'" not in bodies, (
            f"job {name!r} tests for `failure` specifically — a SKIPPED signer "
            "is not a failure, and skipped is the case R20 exists for"
        )
        assert "exit 1" in bodies, f"job {name!r} does not fail the run"
