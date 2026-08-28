from __future__ import annotations

import copy
import dataclasses
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from typing import Any

import pytest


SCRIPT = Path(__file__).parents[1] / "scripts" / "build_m2_11_qa_bundle.py"

SPEC = importlib.util.spec_from_file_location("m2_11_qa_bundle", SCRIPT)
assert SPEC and SPEC.loader
BUNDLE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BUNDLE
SPEC.loader.exec_module(BUNDLE)

# `scripts/build_m2_11_qa_bundle.py` no longer hardcodes machine paths: the four
# machine roots arrive through the required --expected-root / --orchestrate /
# --evidence-root / --snapshot flags and thread through as one QaBundlePaths.
#
# Pure path-plumbing tests construct their own QaBundlePaths under tmp_path and
# run on any machine. Tests that need the real evidence artifacts (real digests,
# the 23 GB snapshot, the orchestrate checkout) stay host-bound: they run only
# when the operator's marker file exists. The marker file is JSON at
# ~/.config/populus/m2-11-qa-owner-paths.json with the four absolute paths:
# {"expected_root": ..., "orchestrate": ..., "evidence_root": ..., "snapshot": ...}
_HOST_MARKER = Path.home() / ".config" / "populus" / "m2-11-qa-owner-paths.json"


def _load_host_paths() -> Any:
    try:
        data = json.loads(_HOST_MARKER.read_text("utf-8"))
        paths = BUNDLE.QaBundlePaths(
            expected_root=Path(data["expected_root"]),
            orchestrate=Path(data["orchestrate"]),
            evidence_root=Path(data["evidence_root"]),
            snapshot=Path(data["snapshot"]),
        )
    except (OSError, ValueError, KeyError, TypeError):
        return None
    if not (paths.orchestrate.exists() and paths.evidence_root.is_dir()):
        return None
    return paths


OWNER = _load_host_paths()
requires_owner_machine = pytest.mark.skipif(
    OWNER is None,
    reason=(
        "needs the host machine's real M2-11 evidence artifacts; declare them "
        "in the ~/.config/populus/m2-11-qa-owner-paths.json marker file"
    ),
)

# Two further host preconditions surfaced by the first hosted-CI run of this
# suite (it self-skipped wholesale before the QaBundlePaths refactor, so no CI
# had ever executed these tests). Same self-skip pattern as above: the
# precondition is declared at the test, never in a CI ignore-list.
requires_zsh = pytest.mark.skipif(
    shutil.which("zsh") is None,
    reason="drives real zsh command lines; the hosted CI image carries no zsh",
)


def _git_object_available(oid: str) -> bool:
    return (
        subprocess.run(
            ["git", "cat-file", "-e", oid],
            cwd=Path(__file__).parents[1],
            capture_output=True,
            check=False,
        ).returncode
        == 0
    )


requires_round7_history = pytest.mark.skipif(
    not _git_object_available("de5068f0da644bd543fc7433d14b1f46ba3f9d3f"),
    reason=(
        "needs the round-7 approved tree object in local git history; a "
        "shallow or partial CI clone does not carry it"
    ),
)


def make_paths(
    tmp_path: Path,
    *,
    expected_root: Path | None = None,
    orchestrate: Path | None = None,
    evidence_root: Path | None = None,
    snapshot: Path | None = None,
) -> Any:
    """A synthetic QaBundlePaths rooted under tmp_path for hermetic tests."""
    return BUNDLE.QaBundlePaths(
        expected_root=expected_root or tmp_path / "worktree",
        orchestrate=orchestrate or tmp_path / "orchestrate-tool" / "orchestrate.sh",
        evidence_root=evidence_root or tmp_path / "evidence",
        snapshot=snapshot or tmp_path / "snapshots" / "inst-source-v1.db",
    )


def paths_argv(paths: Any) -> list[str]:
    """The four required machine-root flags for BUNDLE.main invocations."""
    return [
        "--expected-root", str(paths.expected_root),
        "--orchestrate", str(paths.orchestrate),
        "--evidence-root", str(paths.evidence_root),
        "--snapshot", str(paths.snapshot),
    ]


EXPECTED_ADOPTION_NAMES = (
    "approved-tree.json",
    "baseline-diff.redacted.patch",
    "candidate-state.json",
    "changed-files.json",
    "combined-candidate-token.json",
    "dev-notes.md",
    "docs-commit.manifest.json",
    "docs-commit.md",
    "external-changes.json",
    "external-diff.redacted.patch",
    "external-state.json",
    "gate-ledger.json",
    "gate-results.json",
    "isolated-feature.json",
    "owner-decision.md",
    "plan.md",
    "qa-gates.core.manifest.json",
    "qa-gates.manifest.json",
    "qa-report.md",
    "qa-review-input.manifest.json",
    "qa-synthesis.core.manifest.json",
    "qa-synthesis.manifest.json",
    "source-preservation.json",
)
EXPECTED_PHASE_NAMES = (
    "qa-gates.manifest.json",
    "qa-review-input.manifest.json",
    "qa-synthesis.manifest.json",
)
EXPECTED_PHASE_BASE_NAMES = (
    "approved-tree",
    "baseline-diff",
    "candidate-state",
    "changed-files",
    "combined-candidate-token",
    "dev-notes",
    "docs-commit",
    "external-changes",
    "external-diff",
    "external-state",
    "gate-ledger",
    "gate-results",
    "isolated-feature",
    "owner-exception",
    "plan",
    "qa-report",
    "source-preservation",
)
EXPECTED_PHASE_OUTPUTS = {
    "qa-gates.manifest.json": "gate-results",
    "qa-review-input.manifest.json": "qa-report",
    "qa-synthesis.manifest.json": "qa-report",
}
EXPECTED_ROUND7_EXTRAS = (
    "prior-bundle-adoption",
    "prior-qa-review",
    "resolution-notes",
)
EXPECTED_HISTORICAL_NAMES = (
    "qa-v9-finalization-round-1",
    "qa-v9-finalization-round-4",
    "qa-v9-round-1",
    "qa-v9-round-2",
    "qa-v9-round-3",
)
EXPECTED_PRIOR_GATE_NAMES = (
    "prior-gate-baseline-diff.redacted.patch",
    "prior-gate-changed-files.json",
    "prior-gate-dev-notes.md",
    "prior-gate-external-changes.json",
    "prior-gate-external-diff.redacted.patch",
    "prior-gate-external-state.json",
    "prior-gate-gate-diff-check.log",
    "prior-gate-gate-ledger.json",
    "prior-gate-gate-recovery-tests.log",
    "prior-gate-isolated-feature.json",
    "prior-gate-owner-decision.md",
    "prior-gate-plan.md",
    "prior-gate-source-preservation.json",
)
EXPECTED_PREDECESSORS = {
    "recovery-r2": ("prior-qa-review", "resolution-notes"),
    "recovery-r3": ("prior-qa-review", "resolution-notes"),
    "finalization-r4": (*EXPECTED_PRIOR_GATE_NAMES, "resolution-notes"),
    "finalization-r5": (
        "prior-qa-review",
        "prior-review-manifest",
        "resolution-notes",
    ),
    "finalization-r6": (
        "prior-qa-review",
        "prior-review-manifest",
        "resolution-notes",
    ),
    "finalization-r7": EXPECTED_ROUND7_EXTRAS,
}
FALSE_PHASE_DEFECTS = (
    "qa-gates.manifest.json: declared workflow-artifacts/v1, expected m2-11-phase-manifest/v1",
    "qa-review-input.manifest.json: declared workflow-artifacts/v1, expected m2-11-phase-manifest/v1",
    "qa-synthesis.manifest.json: declared workflow-artifacts/v1, expected m2-11-phase-manifest/v1",
)
OWNER_HEADING_DEFECT_LITERAL = (
    "owner-decision.md: owner-decision-v1 heading/metadata contract mismatch"
)
OWNER_CONTROLLING_DEFECT_LITERAL = (
    "owner-decision.md: owner-decision-v1 controlling-plan contract mismatch"
)
EXPECTED_DEFECT_SETS = {
    "qa-v9-round-1": tuple(sorted((*FALSE_PHASE_DEFECTS, OWNER_HEADING_DEFECT_LITERAL))),
    "qa-v9-round-2": tuple(sorted((*FALSE_PHASE_DEFECTS, OWNER_HEADING_DEFECT_LITERAL))),
    "qa-v9-round-3": tuple(sorted((*FALSE_PHASE_DEFECTS, OWNER_HEADING_DEFECT_LITERAL))),
    "qa-v9-finalization-round-1": tuple(sorted(FALSE_PHASE_DEFECTS)),
    "qa-v9-finalization-round-4": tuple(sorted(FALSE_PHASE_DEFECTS)),
    "qa-v9-finalization-round-5": tuple(
        sorted((*FALSE_PHASE_DEFECTS, OWNER_CONTROLLING_DEFECT_LITERAL))
    ),
}
RECORD_MUTATIONS = (
    "content-stale-digest",
    "cross-path-same-content",
    "digest-only",
    "wrong-schema",
)
PREDECESSOR_MUTATIONS = (
    "content-stale-digest",
    "cross-path-same-content",
    "digest-only",
    "duplicate",
    "missing",
    "relabel",
)
HISTORICAL_PINS = (
    "adoption-sha",
    "decision-sha",
    "namespace",
    "token-file-sha",
    "token-value",
)
ROUND6_REVIEW_MUTATIONS = (
    "approved-verdict",
    "cross-path-same-content",
    "extra-f6",
    "missing-f4",
    "missing-f5",
    "relabel-heading",
    "wrong-fingerprint",
    "wrong-review-digest",
    "wrong-token",
)

EXPECTED_REFUSAL_IDS = frozenset(
    [
        f"adoption::{name}::{mutation}"
        for name in EXPECTED_ADOPTION_NAMES
        for mutation in RECORD_MUTATIONS
    ]
    + [
        f"phase::{manifest}::{slot}:{name}::{mutation}"
        for manifest in EXPECTED_PHASE_NAMES
        for slot, names in (
            ("input", (*EXPECTED_PHASE_BASE_NAMES, *EXPECTED_ROUND7_EXTRAS)),
            ("output", (EXPECTED_PHASE_OUTPUTS[manifest],)),
        )
        for name in names
        for mutation in RECORD_MUTATIONS
    ]
    + [
        f"history::{namespace}::{pin}"
        for namespace in EXPECTED_HISTORICAL_NAMES
        for pin in HISTORICAL_PINS
    ]
    + [
        f"defects::{namespace}::{mutation}"
        for namespace in EXPECTED_DEFECT_SETS
        for mutation in ("extra", "missing")
    ]
    + [
        f"predecessor::{shape}::{name}::{mutation}"
        for shape, names in EXPECTED_PREDECESSORS.items()
        for name in names
        for mutation in PREDECESSOR_MUTATIONS
    ]
    + [f"predecessor::{shape}::extra-record" for shape in EXPECTED_PREDECESSORS]
    + [f"review::round6::{mutation}" for mutation in ROUND6_REVIEW_MUTATIONS]
)
EXPECTED_HAPPY_IDS = frozenset(
    ["happy::adoption::round6"]
    + [f"happy::phase::{name}" for name in EXPECTED_PHASE_NAMES]
    + [f"happy::history::{name}" for name in EXPECTED_HISTORICAL_NAMES]
    + [f"happy::defects::{name}" for name in EXPECTED_DEFECT_SETS]
    + [f"happy::predecessor::{shape}" for shape in EXPECTED_PREDECESSORS]
    + ["happy::review::round6", "happy::bundle::synthetic-round7"]
)
EXPECTED_ALL_IDS = EXPECTED_REFUSAL_IDS | EXPECTED_HAPPY_IDS
EXECUTED_F4_F5_IDS: set[str] = set()

RELEASE_F1_BYTE_TARGETS = (
    ("docs/build/RUN-M2-11-QA-origin-decision.md", 3),
    ("docs/build/RUN-M2-11-QA-origin-decision.md", 4),
    ("docs/build/RUN-M2-11-QA-finalization-decision.md", 3),
    ("docs/build/RUN-M2-11-QA-finalization-exception-decision.md", 3),
    ("docs/build/RUN-M2-11-QA-finalization-repair-decision.md", 3),
    ("docs/build/RUN-M2-11-QA-finalization-repair-plan.md", 3),
    ("docs/build/RUN-M2-11-QA-finalization-repair-plan.md", 6),
    ("docs/build/RUN-M2-11-QA-finalization-repair-plan.md", 7),
    ("docs/build/RUN-M2-11-QA-finalization-F3-decision.md", 3),
    ("docs/build/RUN-M2-11-QA-finalization-F3-plan.md", 4),
    ("docs/build/RUN-M2-11-QA-finalization-F3-plan.md", 5),
    ("docs/build/RUN-M2-11-QA-finalization-F3-plan.md", 7),
    ("docs/build/RUN-M2-11-QA-finalization-F4-F5-decision.md", 3),
)
RELEASE_F1_BYTE_MUTATIONS = (
    "extra-byte",
    "lossy-body",
    "missing-edit",
    "tab-suffix",
)
RELEASE_F1_OWNER_REFUSALS = (
    "crlf",
    "duplicate-date",
    "empty-authorization",
    "foreign-plan",
    "missing-date",
    "missing-final-newline",
    "missing-plan",
    "spaced-v1-date",
    "v1-as-v2",
    "v2-as-v1",
    "verdict-line",
    "wrong-date",
)
RELEASE_F1_ROUND7_PIN_FILES = (
    "adoption",
    "approved-tree",
    "docs-input",
    "docs-review",
    "docs-review-manifest",
    "qa-review",
    "qa-review-manifest",
    "token-file",
)
RELEASE_F1_ROUND7_RECORDS = (
    "adoption-manifest",
    "combined-candidate-token",
    "final-docs-tree",
    "qa-review",
    "qa-review-manifest",
)
RELEASE_F1_ROUND7_IDENTITIES = (
    "attempt",
    "docs-fingerprint",
    "path-count",
    "qa-fingerprint",
    "round",
    "token",
    "tree-oid",
    "verdict",
)
RELEASE_F1_ROUND8_PIN_FILES = (
    "adoption",
    "approved-tree",
    "candidate-state",
    "qa-review",
    "qa-review-manifest",
    "token-file",
)
RELEASE_F1_ROUND8_VALUES = (
    "fingerprint",
    "path-count",
    "round",
    "token",
    "tree-oid",
)
RELEASE_F1_ROUND8_REVIEW = ("extra-f2", "missing-f1", "verdict")
RELEASE_F1_ROUND8_MANIFEST = ("digest", "path")
RELEASE_F1_ROUND8_AUTHORITY = ("decision-digest", "plan-digest")
RELEASE_F1_DOCS_REFUSALS = (
    "attempt-4",
    "foreign-approved-predecessor",
    "generic-cycle-bypass",
    "occupied-output",
    "unsealed-qa",
    "wrong-prior-docs-path",
    "wrong-resolution",
    "wrong-round",
)
RELEASE_F1_PRIVATE_REFUSALS = (
    "fingerprint-drift",
    "output-before-preflight",
    "real-index-mismatch",
    "whitespace-refusal",
)

EXPECTED_RELEASE_F1_REFUSAL_IDS = frozenset(
    [
        f"byte::{path}:{line}::{mutation}"
        for path, line in RELEASE_F1_BYTE_TARGETS
        for mutation in RELEASE_F1_BYTE_MUTATIONS
    ]
    + [f"owner-v2::{mutation}" for mutation in RELEASE_F1_OWNER_REFUSALS]
    + [
        f"round7-pin::{name}::{mutation}"
        for name in RELEASE_F1_ROUND7_PIN_FILES
        for mutation in ("digest", "path")
    ]
    + ["round7-final-message::digest", "round7-final-message::path"]
    + [
        f"round7-record::{name}::{mutation}"
        for name in RELEASE_F1_ROUND7_RECORDS
        for mutation in ("digest", "path")
    ]
    + [f"round7-identity::{name}" for name in RELEASE_F1_ROUND7_IDENTITIES]
    + [
        f"round8-pin::{name}::{mutation}"
        for name in RELEASE_F1_ROUND8_PIN_FILES
        for mutation in ("digest", "path")
    ]
    + [f"round8-value::{name}" for name in RELEASE_F1_ROUND8_VALUES]
    + [f"round8-review::{name}" for name in RELEASE_F1_ROUND8_REVIEW]
    + [f"round8-manifest::{name}" for name in RELEASE_F1_ROUND8_MANIFEST]
    + [f"round8-authority::{name}" for name in RELEASE_F1_ROUND8_AUTHORITY]
    + [f"docs-a3::{name}" for name in RELEASE_F1_DOCS_REFUSALS]
    + [f"private-release::{name}" for name in RELEASE_F1_PRIVATE_REFUSALS]
)
EXPECTED_RELEASE_F1_HAPPY_IDS = frozenset((
    "happy::byte",
    "happy::docs-a3",
    "happy::owner-v1",
    "happy::owner-v2",
    "happy::private-compute",
    "happy::private-write",
    "happy::rollout-fences",
    "happy::round7-predecessor",
    "happy::round8-predecessor",
))
EXPECTED_RELEASE_F1_IDS = (
    EXPECTED_RELEASE_F1_REFUSAL_IDS | EXPECTED_RELEASE_F1_HAPPY_IDS
)
EXECUTED_RELEASE_F1_IDS: set[str] = set()


def git(repo: Path, *args: str) -> bytes:
    return subprocess.run(["git", *args], cwd=repo, check=True, stdout=subprocess.PIPE).stdout


def write(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")


def copy_round_three_failed_bundle(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[Path, Any]:
    assert OWNER is not None
    paths = dataclasses.replace(OWNER, evidence_root=tmp_path)
    source = OWNER.evidence_root / "qa-v9-finalization-round-3"
    bundle = tmp_path / "qa-v9-finalization-round-3"
    shutil.copytree(source, bundle)
    ledger_path = bundle / "gate-ledger.json"
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    for entry in ledger["entries"]:
        entry["log_path"] = str((bundle / f"gate-{entry['id']}.log").resolve())
    ledger_path.write_bytes(BUNDLE.canonical_json_bytes(ledger))
    monkeypatch.setattr(
        BUNDLE,
        "ROUND3_FAILED_LEDGER_SHA256",
        BUNDLE.sha256_file(ledger_path),
    )
    return bundle, paths


def seal_docs_fixture(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    round_no: int = 3,
    exception_scope: tuple[str, ...] | None = None,
    presealed: bool = True,
    review_verdict: str = "APPROVED",
    bundle_name: str = "bundle",
) -> dict[str, Any]:
    paths = make_paths(tmp_path, evidence_root=tmp_path)
    bundle = tmp_path / bundle_name
    bundle.mkdir(parents=True)
    adoption = {
        "schema_version": "adoption-qa-manifest/v1",
        "round": round_no,
        "owner_exception": True,
        "exception_scope": list(
            BUNDLE.FINALIZATION_EXCEPTION_SCOPE
            if exception_scope is None
            else exception_scope
        ),
        "base_ref": BUNDLE.EXPECTED_BASE,
        "worktree_digest": "final-docs-fingerprint",
        "combined_candidate_token": "sha256:" + "1" * 64,
        "core_manifest_digests": {},
        "artifacts": [],
        "prior_round": {},
    }
    adoption_path = bundle / "adoption-manifest.json"
    adoption_path.write_bytes(BUNDLE.canonical_json_bytes(adoption))
    candidate = bundle / "candidate-state.json"
    candidate.write_bytes(BUNDLE.canonical_json_bytes({"state": "exact", "docs_attempt": 1}))
    base_input = {
        "name": "candidate-state",
        "path": str(candidate.resolve()),
        "digest": "sha256:" + BUNDLE.sha256_file(candidate),
        "schema": "candidate-state/v1",
        "required": True,
    }
    approved_tree_value = {
        "schema_version": "approved-tree/v1",
        "baseline_commit": BUNDLE.EXPECTED_HEAD,
        "tree_oid": "a" * 40,
        "expected_paths": list(BUNDLE.EXPECTED_RELEASE_PATHS),
        "real_index_before_sha256": "sha256:" + "1" * 64,
        "real_index_after_sha256": "sha256:" + "1" * 64,
        "private_object_dir_removed": True,
    }
    approved_tree_input = bundle / "approved-tree.synthetic.json"
    approved_tree_input.write_bytes(BUNDLE.canonical_json_bytes(approved_tree_value))
    base_inputs = [
        base_input,
        {
            "name": "approved-tree",
            "path": str(approved_tree_input.resolve()),
            "digest": "sha256:" + BUNDLE.sha256_file(approved_tree_input),
            "schema": "approved-tree/v1",
            "required": True,
        },
    ]
    for name, schema in (
        ("dev-notes", "dev-notes-v1"),
        ("qa-report", "qa-report-v1"),
        ("changed-files", "changed-files/v1"),
        ("baseline-diff", "redacted-diff-v1"),
    ):
        path = bundle / f"{name}.synthetic"
        path.write_text(f"synthetic {name}\n", encoding="utf-8")
        base_inputs.append({
            "name": name,
            "path": str(path.resolve()),
            "digest": "sha256:" + BUNDLE.sha256_file(path),
            "schema": schema,
            "required": True,
        })
    qa_input = bundle / "qa-review-input.manifest.json"
    qa_input.write_bytes(BUNDLE.canonical_json_bytes({"inputs": base_inputs}))
    review_source = tmp_path / "qa-review-source.md"
    if review_verdict == "CHANGES_REQUESTED":
        write_blocker_review(review_source, ["F1", "F2"])
    else:
        review_source.write_text(
            "## Verdict\n\nSynthetic approved review.\n\nVERDICT: APPROVED\n",
            encoding="utf-8",
        )
    review = bundle / f"qa-review.round-{round_no}.md"
    if presealed:
        review.write_bytes(review_source.read_bytes())
    adoption_record = {
        "name": "adoption-manifest",
        "path": str(adoption_path.resolve()),
        "digest": "sha256:" + BUNDLE.sha256_file(adoption_path),
        "schema": "adoption-qa-manifest/v1",
        "required": True,
    }
    sealed = {
        "schema_version": "m2-11-phase-manifest/v1",
        "phase": "qa-review",
        "round": round_no,
        "base_ref": adoption["base_ref"],
        "worktree_digest": adoption["worktree_digest"],
        "output": {
            "name": "qa-review",
            "path": str(review.resolve()),
            "digest": "sha256:" + BUNDLE.sha256_file(review_source),
            "schema": "review-output-v1",
            "required": True,
        },
        "inputs": sorted([*base_inputs, adoption_record], key=lambda item: os.fsencode(item["name"])),
    }
    sealed_path = bundle / "qa-review.manifest.json"
    if presealed:
        sealed_path.write_bytes(BUNDLE.canonical_json_bytes(sealed))
    final_commit = tmp_path / f"final-docs-commit.finalization-r{round_no}-a1.md"
    final_commit.write_text("Rationale.\n\nCOMMIT_MESSAGE: feat(inst): publish bounded institutional data\n", encoding="utf-8")
    provisional = bundle / "docs-commit.md"
    provisional.write_text("COMMIT_MESSAGE: provisional\n", encoding="utf-8")

    bundle_validations: list[tuple[Path, bool]] = []

    def validate_bundle(_paths: Any, bundle_path: Path, live_repo: bool = True) -> None:
        bundle_validations.append((bundle_path, live_repo))

    monkeypatch.setattr(BUNDLE, "validate_bundle", validate_bundle)
    commands: list[list[str]] = []

    def checked(argv: list[str], *_args: Any, **_kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        commands.append(argv)
        return subprocess.CompletedProcess([], 0, b"", b"")

    monkeypatch.setattr(BUNDLE, "run_checked", checked)
    monkeypatch.setattr(BUNDLE, "external_worktree_fingerprint", lambda _paths, _repo: "final-docs-fingerprint")

    def fixed_state(
        _paths: Any,
        _repo: Path,
        round_no: int,
        expected_paths: tuple[str, ...],
        allowed_rounds: tuple[int, ...],
    ) -> dict[str, Any]:
        assert round_no == adoption["round"]
        assert expected_paths == BUNDLE.EXPECTED_RELEASE_PATHS
        assert allowed_rounds == (round_no,)
        return {"fingerprint": "final-docs-fingerprint"}

    def compute_tree(_state: dict[str, Any]) -> dict[str, Any]:
        return dict(approved_tree_value)

    def approved_tree(record: dict[str, Any], output: Path) -> str:
        tree = output / "approved-tree.json"
        tree.write_bytes(BUNDLE.canonical_json_bytes(record))
        return "a" * 40

    monkeypatch.setattr(BUNDLE, "validate_fixed_state", fixed_state)
    monkeypatch.setattr(BUNDLE, "compute_approved_tree", compute_tree)
    monkeypatch.setattr(BUNDLE, "write_approved_tree", approved_tree)
    return {
        "paths": paths,
        "bundle": bundle,
        "review": review,
        "review_source": review_source,
        "sealed": sealed_path,
        "candidate": candidate,
        "final_commit": final_commit,
        "provisional": provisional,
        "output": tmp_path / f"docs-v9-finalization-r{round_no}-a1",
        "commands": commands,
        "bundle_validations": bundle_validations,
    }


def run_seal_docs(fixture: dict[str, Any], **overrides: Path) -> int:
    values = {**fixture, **overrides}
    argv = [
        *paths_argv(values["paths"]),
        "seal-docs",
        "--bundle", str(values["bundle"]),
        "--qa-review", str(values["review"]),
        "--final-docs-commit", str(values["final_commit"]),
        "--attempt", str(values.get("attempt", 1)),
        "--output", str(values["output"]),
    ]
    if values.get("prior_docs_review"):
        argv.extend(["--prior-docs-review", str(values["prior_docs_review"])])
    if values.get("resolution_notes"):
        argv.extend(["--resolution-notes", str(values["resolution_notes"])])
    return BUNDLE.main(argv)


def artifact_record(name: str, path: Path, schema: str) -> dict[str, Any]:
    return {
        "name": name,
        "path": str(path.resolve()),
        "digest": "sha256:" + BUNDLE.sha256_file(path),
        "schema": schema,
        "required": True,
    }


def mutate_record(
    actual: dict[str, Any],
    expected: dict[str, Any],
    mutation: str,
    tmp_path: Path,
) -> None:
    path = Path(expected["path"])
    if mutation == "cross-path-same-content":
        foreign = tmp_path / "foreign" / path.name
        foreign.parent.mkdir(parents=True, exist_ok=True)
        foreign.write_bytes(path.read_bytes())
        actual["path"] = str(foreign.resolve())
    elif mutation == "wrong-schema":
        actual["schema"] = "wrong-schema/v1"
    elif mutation == "content-stale-digest":
        path.write_bytes(path.read_bytes() + b"mutated")
    elif mutation == "digest-only":
        actual["digest"] = "sha256:" + "f" * 64
    else:
        raise AssertionError(f"unknown record mutation: {mutation}")


def release_f1_byte_fixture(tmp_path: Path) -> dict[str, bytes]:
    by_path: dict[str, list[int]] = {}
    for name, line in RELEASE_F1_BYTE_TARGETS:
        by_path.setdefault(name, []).append(line)
    old_files: dict[str, bytes] = {}
    for name, targets in by_path.items():
        lines = [f"line-{index}\n".encode() for index in range(1, max(targets) + 2)]
        for line in targets:
            lines[line - 1] = f"line-{line}  \n".encode()
        old_files[name] = b"".join(lines)
        repaired = list(lines)
        for line in targets:
            repaired[line - 1] = repaired[line - 1][:-3] + b"\n"
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"".join(repaired))
    return old_files


def release_f1_owner_v2_text() -> str:
    return (
        "# RUN M2-11 — Release-Hygiene F1 Verification Owner Decision\n\n"
        "**Date:** 2026-08-11\n"
        "**Owner authorization:** “Synthetic bounded authorization.”\n\n"
        "The controlling plan is\n"
        "`docs/build/RUN-M2-11-QA-finalization-release-hygiene-F1-plan.md`.\n"
    )


def copy_for_path_mutation(source: Path, tmp_path: Path, name: str) -> Path:
    target = tmp_path / "path-mutations" / name / source.name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(source.read_bytes())
    return target


def patch_path_read_text(
    monkeypatch: pytest.MonkeyPatch,
    target: Path,
    replacement: str,
) -> None:
    original = Path.read_text

    def read_text(path: Path, *args: Any, **kwargs: Any) -> str:
        if path.resolve() == target.resolve():
            return replacement
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", read_text)


def release_f1_docs_fixture(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    *,
    presealed: bool = False,
) -> dict[str, Any]:
    fixture = seal_docs_fixture(
        tmp_path,
        monkeypatch,
        round_no=9,
        exception_scope=BUNDLE.FINALIZATION_RELEASE_HYGIENE_F1_EXCEPTION_SCOPE,
        presealed=presealed,
        bundle_name="qa-v9-finalization-round-9",
    )
    adoption_path = fixture["bundle"] / "adoption-manifest.json"
    adoption = json.loads(adoption_path.read_text())
    plan = fixture["bundle"] / "plan.synthetic.md"
    plan.write_text("synthetic plan\n", encoding="utf-8")
    adoption["artifacts"] = [{
        "name": "plan.md",
        "path": str(plan.resolve()),
        "digest": "sha256:" + BUNDLE.PINNED_DIGESTS[
            BUNDLE.FINALIZATION_RELEASE_HYGIENE_F1_PLAN
        ],
        "schema": "plan-v1",
        "required": True,
    }]
    prior_qa = tmp_path / "qa-v9-finalization-round-8" / "qa-review.round-8.md"
    prior_qa.parent.mkdir(parents=True)
    prior_qa.write_text("VERDICT: CHANGES_REQUESTED\n", encoding="utf-8")
    prior_qa_manifest = prior_qa.parent / "qa-review.manifest.json"
    prior_qa_manifest.write_text("{}\n", encoding="utf-8")
    f1_resolution = tmp_path / "resolution-notes.finalization-r8-F1.md"
    f1_resolution.write_text("## F1: resolved\n", encoding="utf-8")
    adoption["prior_round"] = {
        "prior-qa-review": artifact_record(
            "prior-qa-review", prior_qa, "review-output-v1"
        ),
        "prior-review-manifest": artifact_record(
            "prior-review-manifest",
            prior_qa_manifest,
            "m2-11-phase-manifest/v1",
        ),
        "resolution-notes": artifact_record(
            "resolution-notes", f1_resolution, "resolution-notes-v1"
        ),
    }
    adoption_path.write_bytes(BUNDLE.canonical_json_bytes(adoption))
    candidate = json.loads(fixture["candidate"].read_text())
    candidate["docs_attempt"] = 3
    fixture["candidate"].write_bytes(BUNDLE.canonical_json_bytes(candidate))
    qa_input_path = fixture["bundle"] / "qa-review-input.manifest.json"
    qa_input = json.loads(qa_input_path.read_text())
    candidate_record = next(
        record for record in qa_input["inputs"] if record["name"] == "candidate-state"
    )
    candidate_record["digest"] = "sha256:" + BUNDLE.sha256_file(fixture["candidate"])
    qa_input_path.write_bytes(BUNDLE.canonical_json_bytes(qa_input))
    final_commit = tmp_path / "final-docs-commit.finalization-r9-a3.md"
    final_commit.write_text(
        "First rationale.\n\nSecond rationale.\n\n"
        "COMMIT_MESSAGE: feat(inst): publish bounded institutional data\n",
        encoding="utf-8",
    )
    fixture["final_commit"] = final_commit
    fixture["output"] = tmp_path / "docs-v9-finalization-r9-a3"
    prior_docs_dir = tmp_path / "docs-v9-finalization-r7-a2"
    prior_docs_dir.mkdir()
    prior_docs = prior_docs_dir / "docs-review.attempt-2.md"
    prior_docs.write_text("VERDICT: APPROVED\n", encoding="utf-8")
    prior_docs_manifest = prior_docs_dir / "docs-review.manifest.json"
    prior_docs_manifest.write_text("{}\n", encoding="utf-8")
    release_resolution = tmp_path / "resolution-notes.finalization-r7-release.md"
    release_resolution.write_text("## gate-release-diff-check: resolved\n", encoding="utf-8")
    fixture.update({
        "prior_docs_review": prior_docs,
        "prior_docs_manifest": prior_docs_manifest,
        "resolution_notes": release_resolution,
        "prior_qa_review": prior_qa,
    })
    monkeypatch.setattr(BUNDLE, "finalization_docs_attempts", lambda _paths: {
        1: (7, tmp_path / "docs-v9-finalization-r7-a1"),
        2: (7, prior_docs_dir.resolve()),
    })
    monkeypatch.setattr(BUNDLE, "next_finalization_docs_attempt", lambda _paths: 3)
    monkeypatch.setattr(
        BUNDLE,
        "validate_release_hygiene_predecessor",
        lambda _paths, value: {
            "review": value.resolve(),
            "manifest": prior_docs_manifest.resolve(),
            "round": 7,
            "attempt": 2,
            "adoption_record": {"different": "candidate"},
            "input": {"base_ref": BUNDLE.EXPECTED_BASE},
        },
    )
    monkeypatch.setattr(
        BUNDLE,
        "validate_release_hygiene_f1_predecessor",
        lambda _paths, value: {
            "review": value.resolve(),
            "manifest": prior_qa_manifest.resolve(),
            "round": 8,
        },
    )
    monkeypatch.setattr(
        BUNDLE, "validate_release_hygiene_resolution", lambda _paths, value: value.resolve()
    )
    return fixture


def extract_plan_fence(plan: str, preceding: str) -> str:
    start = plan.index(preceding)
    match = re.search(r"```bash\n(.*?)\n```", plan[start:], re.DOTALL)
    assert match is not None
    return match.group(1)


PREDECESSOR_BUNDLES = {
    "recovery-r2": "qa-v9-round-2",
    "recovery-r3": "qa-v9-round-3",
    "finalization-r4": "qa-v9-finalization-round-4",
    "finalization-r5": "qa-v9-finalization-round-5",
    "finalization-r6": "qa-v9-finalization-round-6",
}


def retained_predecessor_records(shape: str) -> dict[str, dict[str, Any]]:
    assert OWNER is not None
    if shape == "finalization-r7":
        return {
            "prior-qa-review": artifact_record(
                "prior-qa-review", OWNER.round6_review, "review-output-v1"
            ),
            "prior-bundle-adoption": artifact_record(
                "prior-bundle-adoption",
                OWNER.evidence_root
                / "qa-v9-finalization-round-6/adoption-manifest.json",
                "adoption-qa-manifest/v1",
            ),
            "resolution-notes": {
                "name": "resolution-notes",
                "path": str(
                    OWNER.evidence_root / "resolution-notes.finalization-r6-qa.md"
                ),
                "digest": "sha256:" + "0" * 64,
                "schema": "resolution-notes-v1",
                "required": True,
            },
        }
    bundle = OWNER.evidence_root / PREDECESSOR_BUNDLES[shape]
    adoption = json.loads((bundle / "adoption-manifest.json").read_text("utf-8"))
    prior = adoption["prior_round"]
    if shape in {"recovery-r2", "recovery-r3"}:
        result = {
            "prior-qa-review": {**prior["prior-review"], "name": "prior-qa-review"},
            "resolution-notes": dict(prior["resolution-notes"]),
        }
    elif shape == "finalization-r4":
        result = {item["name"]: dict(item) for item in prior["artifacts"]}
        result["resolution-notes"] = dict(prior["resolution-notes"])
    else:
        result = {name: dict(record) for name, record in prior.items()}
    assert tuple(sorted(result, key=os.fsencode)) == tuple(
        sorted(EXPECTED_PREDECESSORS[shape], key=os.fsencode)
    )
    return result


def synthetic_predecessor_records(
    shape: str,
    tmp_path: Path,
) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for ordinal, name in enumerate(EXPECTED_PREDECESSORS[shape]):
        path = tmp_path / shape / f"{ordinal:02d}.artifact"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"{shape}:{name}\n", encoding="utf-8")
        result[name] = artifact_record(name, path, "test-predecessor/v1")
    return result


def write_round6_review_fixture(path: Path) -> None:
    path.write_text(
        "## Findings\n\n"
        "#### F4 [BLOCKER]\n\n- Status: open\n\n"
        "#### F5 [BLOCKER]\n\n- Status: open\n\n"
        f"Token {BUNDLE.ROUND6_TOKEN}\n\n"
        f"Fingerprint {BUNDLE.ROUND6_FINGERPRINT}\n\n"
        "## Verdict\n\nVERDICT: CHANGES_REQUESTED\n",
        encoding="utf-8",
    )


def test_canonical_json_is_stable_and_has_one_lf() -> None:
    assert BUNDLE.canonical_json_bytes({"z": 1, "a": "x"}) == b'{"a":"x","z":1}\n'


def test_combined_token_algorithm_is_tagged() -> None:
    parts = {"a": "sha256:" + "0" * 64}
    expected = "sha256:" + hashlib.sha256(
        b"populus-m2-11-adoption-candidate-v1\0" + BUNDLE.canonical_json_bytes(parts)
    ).hexdigest()
    assert expected.startswith("sha256:") and len(expected) == 71


def test_changed_paths_is_nul_safe_sorted_and_rejects_parent(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "config", "user.email", "qa@example.invalid")
    git(repo, "config", "user.name", "QA")
    write(repo / "tracked.txt", "one\n")
    git(repo, "add", "tracked.txt")
    git(repo, "commit", "-qm", "base")
    write(repo / "tracked.txt", "two\n")
    write(repo / "space name.txt", "new\n")
    assert BUNDLE.changed_paths(repo) == ["space name.txt", "tracked.txt"]


@requires_owner_machine
def test_complete_diff_redacts_credential_values(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "config", "user.email", "qa@example.invalid")
    git(repo, "config", "user.name", "QA")
    write(repo / "config.txt", "SAFE=1\n")
    git(repo, "add", "config.txt")
    git(repo, "commit", "-qm", "base")
    write(repo / "config.txt", "SAFE=1\nSERVICE_TOKEN=abcdefghijk\n")
    output = tmp_path / "diff.patch"
    BUNDLE.write_complete_redacted_diff(OWNER, repo, output)
    text = output.read_text()
    assert "abcdefghijk" not in text
    assert "[redacted-credential-value]" in text
    assert oct(output.stat().st_mode & 0o777) == "0o600"


def test_output_collision_refuses_without_overwrite(tmp_path: Path) -> None:
    output = tmp_path / "bundle"
    output.mkdir()
    with pytest.raises(FileExistsError):
        output.mkdir(mode=0o700)


def test_validate_rejects_missing_manifest(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="adoption manifest"):
        BUNDLE.validate_bundle(make_paths(tmp_path), tmp_path, live_repo=False)


def test_validate_rejects_duplicate_json_key(tmp_path: Path) -> None:
    (tmp_path / "adoption-manifest.json").write_text(
        '{"schema_version":"adoption-qa-manifest/v1","schema_version":"duplicate"}\n'
    )
    with pytest.raises(RuntimeError, match="duplicate JSON key"):
        BUNDLE.validate_bundle(make_paths(tmp_path), tmp_path, live_repo=False)


def test_main_rejects_unpaired_prior_inputs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    paths = make_paths(tmp_path, evidence_root=tmp_path)
    message = tmp_path / "final-docs-commit.finalization-r2-a1.md"
    message.write_text("COMMIT_MESSAGE: feat(inst): test\n", encoding="utf-8")
    monkeypatch.setattr(BUNDLE, "run_checked", lambda *_args, **_kwargs: subprocess.CompletedProcess([], 0, b"", b""))
    rc = BUNDLE.main([*paths_argv(paths), "run", "--cycle", "finalization", "--round", "2", "--final-docs-commit", str(message), "--prior-review", str(tmp_path / "review.md"), "--output", str(tmp_path / "out")])
    assert rc == 1
    assert "paired" in capsys.readouterr().err


def test_main_rejects_round_outside_cap(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    monkeypatch.setattr(BUNDLE, "validate_fixed_state", lambda _paths, _repo, _round: (_ for _ in ()).throw(RuntimeError("QA round must be 1, 2, or 3")))
    rc = BUNDLE.main([*paths_argv(make_paths(tmp_path)), "run", "--cycle", "finalization", "--round", "4", "--final-docs-commit", str(tmp_path / "final-docs-commit.finalization-r4-a1.md"), "--prior-review", str(tmp_path / "review.md"), "--resolution-notes", str(tmp_path / "notes.md"), "--output", str(tmp_path / "out")])
    assert rc == 1
    assert "QA round" in capsys.readouterr().err


def test_external_empty_token_matches_locked_formula() -> None:
    token = "sha256:" + hashlib.sha256(b"populus-m2-11-external-state-v1\0[]\n").hexdigest()
    assert token == "sha256:6eff8f7e726c52b282876d2d222ec5b9260155a3f163bdf01f6ffcf6ccf291e7"


def write_blocker_review(path: Path, ids: list[str], verdict: str = "CHANGES_REQUESTED") -> None:
    findings = "\n\n".join(
        f"#### {finding} [BLOCKER]\n\n- Status: open" for finding in ids
    ) or "No open blocker."
    path.write_text(f"## Findings\n\n{findings}\n\n## Verdict\n\nVERDICT: {verdict}\n", encoding="utf-8")


@pytest.mark.parametrize("ids", [["F7"], ["F1", "F2", "F4", "F12"]])
def test_resolution_notes_match_every_open_blocker_id(tmp_path: Path, ids: list[str]) -> None:
    review = tmp_path / "review.md"
    notes = tmp_path / "notes.md"
    write_blocker_review(review, ids)
    notes.write_text("\n".join(f"## {finding}: resolved\n" for finding in ids), encoding="utf-8")
    BUNDLE.validate_resolution_notes(make_paths(tmp_path), review, notes)


@pytest.mark.parametrize("resolved", [["F1"], ["F1", "F2", "F3"], ["F1", "F9"]])
def test_resolution_notes_reject_missing_extra_or_relabelled_ids(tmp_path: Path, resolved: list[str]) -> None:
    review = tmp_path / "review.md"
    notes = tmp_path / "notes.md"
    write_blocker_review(review, ["F1", "F2"])
    notes.write_text("\n".join(f"## {finding}: resolved\n" for finding in resolved), encoding="utf-8")
    with pytest.raises(RuntimeError, match="exactly match"):
        BUNDLE.validate_resolution_notes(make_paths(tmp_path), review, notes)


def test_resolution_notes_reject_approved_prior_review(tmp_path: Path) -> None:
    review = tmp_path / "review.md"
    notes = tmp_path / "notes.md"
    write_blocker_review(review, [], verdict="APPROVED")
    notes.write_text("", encoding="utf-8")
    with pytest.raises(RuntimeError, match="open-blocker"):
        BUNDLE.validate_resolution_notes(make_paths(tmp_path), review, notes)


@requires_owner_machine
def test_validator_paths_are_data_and_metacharacters_never_execute(tmp_path: Path) -> None:
    source = OWNER.evidence_root / "qa-review.finalization-r1.canonical.md"
    valid = tmp_path / "review; touch injected.md"
    valid.write_bytes(source.read_bytes())
    BUNDLE.validate_content(OWNER, "review-output-v1", valid, "qa-review", tmp_path)
    assert not (tmp_path / "injected.md").exists()
    assert not (tmp_path / "qa-review").exists()

    invalid = tmp_path / "bad review; touch invalid-injected.md"
    invalid.write_text("not a review\n", encoding="utf-8")
    with pytest.raises(RuntimeError, match="command failed"):
        BUNDLE.validate_content(OWNER, "review-output-v1", invalid, "qa-review", tmp_path)
    assert not (tmp_path / "invalid-injected.md").exists()


def test_global_docs_attempts_are_unique_gap_free_and_capped(tmp_path: Path) -> None:
    paths = make_paths(tmp_path, evidence_root=tmp_path)
    assert BUNDLE.next_finalization_docs_attempt(paths) == 1
    (tmp_path / "docs-v9-finalization-r1-a1").mkdir()
    assert BUNDLE.next_finalization_docs_attempt(paths) == 2
    (tmp_path / "docs-v9-finalization-r2-a2").mkdir()
    assert BUNDLE.next_finalization_docs_attempt(paths) == 3
    (tmp_path / "docs-v9-finalization-r3-a3").mkdir()
    with pytest.raises(RuntimeError, match="cap"):
        BUNDLE.next_finalization_docs_attempt(paths)


def test_global_docs_attempts_reject_skip_and_duplicate(tmp_path: Path) -> None:
    paths = make_paths(tmp_path, evidence_root=tmp_path)
    (tmp_path / "docs-v9-finalization-r2-a2").mkdir()
    with pytest.raises(RuntimeError, match="gap-free"):
        BUNDLE.finalization_docs_attempts(paths)
    (tmp_path / "docs-v9-finalization-r1-a1").mkdir()
    (tmp_path / "docs-v9-finalization-r2-a1").mkdir()
    with pytest.raises(RuntimeError, match="duplicate"):
        BUNDLE.finalization_docs_attempts(paths)


def test_docs_rejection_repo_repair_advances_round_and_attempt_before_output(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    fixture = seal_docs_fixture(tmp_path, monkeypatch, round_no=1)
    assert run_seal_docs(fixture) == 0
    seal_synthetic_docs_review(fixture, tmp_path, verdict="CHANGES_REQUESTED")
    notes = tmp_path / "resolution.md"
    notes.write_text("## F1: resolved\n", encoding="utf-8")
    message = tmp_path / "final-docs-commit.finalization-r2-a2.md"
    message.write_text(fixture["final_commit"].read_text(), encoding="utf-8")
    output = tmp_path / "qa-v9-finalization-round-2"
    monkeypatch.setattr(
        BUNDLE,
        "validate_fixed_state",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("STOP AFTER DOCS PREDECESSOR")),
    )
    assert BUNDLE.main([
        *paths_argv(fixture["paths"]),
        "run",
        "--cycle", "finalization",
        "--round", "2",
        "--final-docs-commit", str(message),
        "--prior-docs-review", str(fixture["output"] / "docs-review.attempt-1.md"),
        "--resolution-notes", str(notes),
        "--output", str(output),
    ]) == 1
    assert "STOP AFTER DOCS PREDECESSOR" in capsys.readouterr().err
    assert not output.exists()


@requires_owner_machine
def test_failed_gate_bundle_and_resolution_are_exact() -> None:
    root = OWNER.evidence_root
    failed = BUNDLE.validate_failed_gate_bundle(OWNER, root / "qa-v9-finalization-round-2", 2)
    assert failed["failed_ids"] == ("recovery-tests",)
    assert len(failed["artifacts"]) == 13
    BUNDLE.validate_gate_resolution_notes(
        OWNER,
        failed,
        root / "resolution-notes.finalization-r2-gates.v2.md",
    )


@requires_owner_machine
def test_round_three_failed_gate_bundle_matches_all_exact_pins_and_schemas() -> None:
    root = OWNER.evidence_root
    bundle = root / "qa-v9-finalization-round-3"
    failed = BUNDLE.validate_failed_gate_bundle(OWNER, bundle, 3)
    assert BUNDLE.sha256_file(bundle / "gate-ledger.json") == BUNDLE.ROUND3_FAILED_LEDGER_SHA256
    assert failed["ledger"]["origin_worktree_fingerprint"] == BUNDLE.ROUND3_FAILED_FINGERPRINT
    assert [entry["id"] for entry in failed["ledger"]["entries"]] == [
        "diff-check",
        "recovery-tests",
    ]
    assert failed["failed_ids"] == ("recovery-tests",)
    assert len(failed["artifacts"]) == 13


@pytest.mark.parametrize(
    "mutation",
    [
        "fingerprint",
        "count",
        "order",
        "id",
        "kind",
        "command",
        "scope",
        "status",
        "exit-code",
        "log-path",
        "log-digest",
    ],
)
@requires_owner_machine
def test_round_three_failed_gate_identity_mutations_refuse(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    mutation: str,
) -> None:
    bundle, paths = copy_round_three_failed_bundle(tmp_path, monkeypatch)
    ledger_path = bundle / "gate-ledger.json"
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    if mutation == "fingerprint":
        ledger["origin_worktree_fingerprint"] = "f" * 64
    elif mutation == "count":
        ledger["entries"] = ledger["entries"][:1]
    elif mutation == "order":
        ledger["entries"].reverse()
    elif mutation == "exit-code":
        ledger["entries"][1]["exit_code"] = 2
    elif mutation == "log-path":
        ledger["entries"][1]["log_path"] = str((bundle / "other.log").resolve())
    elif mutation == "log-digest":
        ledger["entries"][1]["log_digest"] = "sha256:" + "f" * 64
    else:
        field = {"exit-code": "exit_code", "log-path": "log_path"}.get(
            mutation,
            mutation,
        )
        ledger["entries"][1][field] = "mutated"
    ledger_path.write_bytes(BUNDLE.canonical_json_bytes(ledger))
    monkeypatch.setattr(
        BUNDLE,
        "ROUND3_FAILED_LEDGER_SHA256",
        BUNDLE.sha256_file(ledger_path),
    )
    with pytest.raises(RuntimeError):
        BUNDLE.validate_failed_gate_bundle(paths, bundle, 3)


@requires_owner_machine
def test_round_three_failed_gate_ledger_digest_mutation_refuses_before_schema(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bundle, paths = copy_round_three_failed_bundle(tmp_path, monkeypatch)
    ledger_path = bundle / "gate-ledger.json"
    pinned = BUNDLE.ROUND3_FAILED_LEDGER_SHA256
    ledger_path.write_bytes(ledger_path.read_bytes() + b" ")
    monkeypatch.setattr(BUNDLE, "ROUND3_FAILED_LEDGER_SHA256", pinned)
    with pytest.raises(RuntimeError, match="ledger digest"):
        BUNDLE.validate_failed_gate_bundle(paths, bundle, 3)


@requires_owner_machine
def test_owner_decision_v1_local_grammar_and_separate_digest_identity(
    tmp_path: Path,
) -> None:
    actual = (
        OWNER.evidence_root
        / "qa-v9-finalization-round-1/owner-decision.md"
    )
    BUNDLE.validate_failed_gate_artifact(OWNER, actual, "owner-decision-v1")
    substituted = tmp_path / "owner-decision.md"
    substituted.write_text(
        "# RUN M2-11 — Synthetic Owner Decision\n\n"
        "**Date:** 2026-08-11  \n"
        "**Owner authorization:** “Synthetic bounded authorization.”\n\n"
        "The controlling plan is\n"
        "`docs/build/RUN-M2-11-synthetic-plan.md`.\n",
        encoding="utf-8",
    )
    BUNDLE.validate_failed_gate_artifact(OWNER, substituted, "owner-decision-v1")
    assert BUNDLE.sha256_file(substituted) != BUNDLE.PINNED_DIGESTS[
        BUNDLE.FINALIZATION_DECISION
    ]

    release = (
        Path(__file__).parents[1]
        / BUNDLE.FINALIZATION_RELEASE_HYGIENE_DECISION
    )
    BUNDLE.validate_failed_gate_artifact(OWNER, release, "owner-decision-v2")
    with pytest.raises(RuntimeError, match="owner-decision-v1 heading"):
        BUNDLE.validate_failed_gate_artifact(OWNER, release, "owner-decision-v1")


@pytest.mark.parametrize(
    "mutation",
    [
        "oversize",
        "utf8",
        "crlf",
        "final-newline",
        "h1",
        "duplicate-h1",
        "date",
        "duplicate-date",
        "authorization",
        "controlling-plan",
        "verdict",
    ],
)
def test_owner_decision_v1_malformed_cases_refuse(
    tmp_path: Path,
    mutation: str,
) -> None:
    path = tmp_path / "owner-decision.md"
    text = (
        "# RUN M2-11 — Synthetic Owner Decision\n\n"
        "**Date:** 2026-08-11  \n"
        "**Owner authorization:** “Synthetic bounded authorization.”\n\n"
        "The controlling plan is\n"
        "`docs/build/RUN-M2-11-synthetic-plan.md`.\n"
    )
    if mutation == "oversize":
        path.write_bytes(b"x" * 1_048_577)
    elif mutation == "utf8":
        path.write_bytes(b"\xff\n")
    elif mutation == "crlf":
        path.write_bytes(text.replace("\n", "\r\n").encode("utf-8"))
    elif mutation == "final-newline":
        path.write_text(text.rstrip("\n"), encoding="utf-8")
    elif mutation == "h1":
        path.write_text(text.replace("Owner Decision", "Decision"), encoding="utf-8")
    elif mutation == "duplicate-h1":
        path.write_text(text + "# RUN M2-11 — Other Owner Decision\n", encoding="utf-8")
    elif mutation == "date":
        path.write_text(text.replace("2026-08-11", "August 11"), encoding="utf-8")
    elif mutation == "duplicate-date":
        path.write_text(
            text.replace(
                "**Owner authorization:**",
                "**Date:** 2026-08-11  \n**Owner authorization:**",
            ),
            encoding="utf-8",
        )
    elif mutation == "authorization":
        path.write_text(text.replace("Synthetic bounded authorization.", ""), encoding="utf-8")
    elif mutation == "controlling-plan":
        path.write_text(text.replace("The controlling plan is", "The plan is"), encoding="utf-8")
    else:
        path.write_text(text + "VERDICT: APPROVED\n", encoding="utf-8")
    with pytest.raises(RuntimeError):
        BUNDLE.validate_failed_gate_artifact(make_paths(tmp_path), path, "owner-decision-v1")


@pytest.mark.parametrize(
    ("file_name", "schema", "mutation"),
    [
        ("changed-files.json", "changed-files/v1", "drop-key"),
        ("external-state.json", "external-state/v1", "wrong-scope"),
        ("external-changes.json", "external-changes/v1", "nonempty"),
        ("source-preservation.json", "adopted-source-state/v1", "wrong-claim"),
        ("isolated-feature.json", "isolated-feature-adoption/v1", "wrong-paths"),
    ],
)
@requires_owner_machine
def test_failed_gate_custom_json_schema_mutations_refuse(
    tmp_path: Path,
    file_name: str,
    schema: str,
    mutation: str,
) -> None:
    source = (
        OWNER.evidence_root
        / "qa-v9-finalization-round-3"
        / file_name
    )
    value = json.loads(source.read_text(encoding="utf-8"))
    if mutation == "drop-key":
        value.pop("schema_version")
    elif mutation == "wrong-scope":
        value["scope"] = "user"
    elif mutation == "nonempty":
        value["changes"] = ["unexpected"]
    elif mutation == "wrong-claim":
        value["claim"] = "historical-proof"
    else:
        value["expected_paths"] = ["../escape"]
    target = tmp_path / file_name
    target.write_bytes(BUNDLE.canonical_json_bytes(value))
    with pytest.raises(RuntimeError):
        BUNDLE.validate_failed_gate_artifact(OWNER, target, schema)


@pytest.mark.parametrize(
    "content",
    [b"bad\xff\n", b"bad\r\n", b"bad\x00log\n"],
)
def test_gate_log_v1_malformed_text_refuses(tmp_path: Path, content: bytes) -> None:
    path = tmp_path / "gate.log"
    path.write_bytes(content)
    with pytest.raises(RuntimeError):
        BUNDLE.validate_failed_gate_artifact(make_paths(tmp_path), path, "gate-log/v1")


@pytest.mark.parametrize(
    "content",
    [
        "## F1: resolved",
        "## F1: resolved\r\n",
        "## F1: resolved\n## F1: resolved\n",
        "## F0: resolved\n",
        "## F1: resolved\nVERDICT: APPROVED\n",
        "## unexpected: resolved\n",
    ],
)
def test_resolution_notes_v1_malformed_cases_refuse(
    tmp_path: Path,
    content: str,
) -> None:
    path = tmp_path / "resolution.md"
    path.write_bytes(content.encode("utf-8"))
    with pytest.raises(RuntimeError):
        BUNDLE.validate_failed_gate_artifact(make_paths(tmp_path), path, "resolution-notes-v1")


def test_recovery_and_finalization_authority_are_distinct() -> None:
    assert BUNDLE.RECOVERY_EXCEPTION_SCOPE != BUNDLE.FINALIZATION_EXCEPTION_SCOPE
    assert BUNDLE.FINALIZATION_EXCEPTION_SCOPE != BUNDLE.FINALIZATION_RETRY_EXCEPTION_SCOPE
    assert BUNDLE.FINALIZATION_RETRY_EXCEPTION_SCOPE != BUNDLE.FINALIZATION_REPAIR_EXCEPTION_SCOPE
    assert BUNDLE.FINALIZATION_REPAIR_EXCEPTION_SCOPE != BUNDLE.FINALIZATION_F3_EXCEPTION_SCOPE
    assert "same-run-provisional-docs-origin" in BUNDLE.RECOVERY_EXCEPTION_SCOPE
    assert "same-run-provisional-docs-origin" not in BUNDLE.FINALIZATION_EXCEPTION_SCOPE
    assert "owner-authorized-fourth-finalization-retry" in BUNDLE.FINALIZATION_RETRY_EXCEPTION_SCOPE
    assert "owner-authorized-fifth-finalization-repair" in BUNDLE.FINALIZATION_REPAIR_EXCEPTION_SCOPE
    assert "owner-authorized-sixth-finalization-f3-repair" in BUNDLE.FINALIZATION_F3_EXCEPTION_SCOPE
    assert BUNDLE.FINALIZATION_F3_EXCEPTION_SCOPE == tuple(
        sorted(BUNDLE.FINALIZATION_F3_EXCEPTION_SCOPE, key=os.fsencode)
    )
    assert BUNDLE.PINNED_DIGESTS[BUNDLE.FINALIZATION_PLAN] == "82509b7c41e890dab69920abe8b26daac0104fad0c657a5e22aca4864161f742"
    assert BUNDLE.PINNED_DIGESTS[BUNDLE.FINALIZATION_EXCEPTION_PLAN] == "71ca0c1f4eaadb165d49655de4dd838cbbb3ed9b681df815bd170d03f018faf3"
    assert BUNDLE.PINNED_DIGESTS[BUNDLE.FINALIZATION_REPAIR_PLAN] == "5cdd1fef209331f779f3fb28fb718891c2371319d49ef7be2928382623a264e5"
    assert BUNDLE.PINNED_DIGESTS[BUNDLE.FINALIZATION_REPAIR_DECISION] == "ba8c1653144d683e70c497ad1d7e899bf9c21cba9b3b870897f891fa0c5fe4f8"
    assert BUNDLE.PINNED_DIGESTS[BUNDLE.FINALIZATION_F3_PLAN] == "105f5c4966d8d50d9f2737b779ff378b841198c74819c3597f71e9454ecd01d6"
    assert BUNDLE.PINNED_DIGESTS[BUNDLE.FINALIZATION_F3_DECISION] == "148a522d1e4d153744469004c88fd109e4469a30826c344f0fa63ebdf26e72fa"


@pytest.mark.parametrize(
    ("cycle", "round_no"),
    [
        ("finalization", 4),
        ("finalization", 5),
        ("finalization", 6),
        ("finalization-exception", 1),
        ("finalization-exception", 3),
        ("finalization-exception", 5),
        ("finalization-exception", 6),
        ("finalization-repair-exception", 1),
        ("finalization-repair-exception", 4),
        ("finalization-repair-exception", 6),
        ("finalization-repair-exception", 7),
        ("finalization-f3-exception", 1),
        ("finalization-f3-exception", 5),
        ("finalization-f3-exception", 7),
    ],
)
def test_cycle_scoped_round_caps_reject_every_unapproved_round_before_output(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    cycle: str,
    round_no: int,
) -> None:
    paths = make_paths(tmp_path, evidence_root=tmp_path)
    output = tmp_path / f"qa-v9-finalization-round-{round_no}"
    assert BUNDLE.main([
        *paths_argv(paths),
        "run",
        "--cycle", cycle,
        "--round", str(round_no),
        "--final-docs-commit", str(tmp_path / f"final-docs-commit.finalization-r{round_no}-a1.md"),
        "--output", str(output),
    ]) == 1
    assert not output.exists()


def test_exception_round_four_inner_transition_is_hermetic_from_existing_outer_bundle(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    outer_root = tmp_path / "outer-evidence"
    outer_bundle = outer_root / "qa-v9-finalization-round-4"
    outer_bundle.mkdir(parents=True)
    sentinel = outer_bundle / "outer-sentinel"
    sentinel.write_text("unchanged\n", encoding="utf-8")

    inner_root = tmp_path / "inner-evidence"
    inner_root.mkdir()
    paths = make_paths(tmp_path, evidence_root=inner_root)
    final_message = inner_root / "final-docs-commit.finalization-r4-a1.md"
    final_message.write_text(
        "Rationale.\n\nCOMMIT_MESSAGE: feat(inst): publish bounded institutional data\n",
        encoding="utf-8",
    )
    notes = inner_root / "resolution-notes.finalization-r3-gates.md"
    notes.write_text("## gate-recovery-tests: resolved\n", encoding="utf-8")
    predecessor_path = inner_root / "qa-v9-finalization-round-3"
    monkeypatch.setattr(BUNDLE, "validate_content", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        BUNDLE,
        "validate_failed_gate_bundle",
        lambda _paths, path, expected_round: {
            "bundle": path,
            "round": expected_round,
            "artifacts": [],
            "failed_ids": ("recovery-tests",),
        },
    )
    monkeypatch.setattr(BUNDLE, "validate_gate_resolution_notes", lambda *_args: None)

    def stop_after_predecessor(
        _paths: Any,
        _repo: Path,
        round_no: int,
        expected_paths: tuple[str, ...],
        allowed_rounds: tuple[int, ...],
    ) -> dict[str, Any]:
        assert round_no == 4
        assert expected_paths == BUNDLE.EXPECTED_QA_PATHS
        assert allowed_rounds == (4,)
        raise RuntimeError("STOP AFTER ISOLATED ROUND-4 PREDECESSOR")

    monkeypatch.setattr(BUNDLE, "validate_fixed_state", stop_after_predecessor)
    inner_output = inner_root / "qa-v9-finalization-round-4"
    assert BUNDLE.main([
        *paths_argv(paths),
        "run",
        "--cycle", "finalization-exception",
        "--round", "4",
        "--final-docs-commit", str(final_message),
        "--prior-gate-bundle", str(predecessor_path),
        "--resolution-notes", str(notes),
        "--output", str(inner_output),
    ]) == 1
    assert "STOP AFTER ISOLATED ROUND-4 PREDECESSOR" in capsys.readouterr().err
    assert not inner_output.exists()
    assert sentinel.read_text(encoding="utf-8") == "unchanged\n"


def test_exception_round_four_rejects_review_predecessor_before_output(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = make_paths(tmp_path, evidence_root=tmp_path)
    final_message = tmp_path / "final-docs-commit.finalization-r4-a1.md"
    final_message.write_text(
        "Rationale.\n\nCOMMIT_MESSAGE: feat(inst): publish bounded institutional data\n",
        encoding="utf-8",
    )
    notes = tmp_path / "resolution.md"
    notes.write_text("## F1: resolved\n", encoding="utf-8")
    monkeypatch.setattr(BUNDLE, "validate_content", lambda *_args, **_kwargs: None)
    output = tmp_path / "qa-v9-finalization-round-4"
    assert BUNDLE.main([
        *paths_argv(paths),
        "run",
        "--cycle", "finalization-exception",
        "--round", "4",
        "--final-docs-commit", str(final_message),
        "--prior-review", str(tmp_path / "review.md"),
        "--resolution-notes", str(notes),
        "--output", str(output),
    ]) == 1
    assert not output.exists()


def test_obsolete_round_five_authority_now_refuses_invalid_decision_before_output(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    fixture = seal_docs_fixture(
        tmp_path,
        monkeypatch,
        round_no=4,
        exception_scope=BUNDLE.FINALIZATION_RETRY_EXCEPTION_SCOPE,
        review_verdict="CHANGES_REQUESTED",
        bundle_name="qa-v9-finalization-round-4",
    )
    final_message = tmp_path / "final-docs-commit.finalization-r5-a1.md"
    final_message.write_text(
        "Rationale.\n\nCOMMIT_MESSAGE: feat(inst): publish bounded institutional data\n",
        encoding="utf-8",
    )
    notes = tmp_path / "resolution-notes.finalization-r4-qa.md"
    notes.write_text("## F1: resolved\n## F2: resolved\n", encoding="utf-8")

    def stop_after_predecessor(
        _paths: Any,
        _repo: Path,
        round_no: int,
        expected_paths: tuple[str, ...],
        allowed_rounds: tuple[int, ...],
    ) -> dict[str, Any]:
        assert round_no == 5
        assert expected_paths == BUNDLE.EXPECTED_QA_PATHS
        assert allowed_rounds == (5,)
        raise RuntimeError("STOP AFTER SEALED ROUND-4 QA PREDECESSOR")

    monkeypatch.setattr(BUNDLE, "validate_fixed_state", stop_after_predecessor)
    output = tmp_path / "qa-v9-finalization-round-5"
    assert BUNDLE.main([
        *paths_argv(fixture["paths"]),
        "run",
        "--cycle", "finalization-repair-exception",
        "--round", "5",
        "--final-docs-commit", str(final_message),
        "--prior-review", str(fixture["review"]),
        "--resolution-notes", str(notes),
        "--output", str(output),
    ]) == 1
    assert "STOP AFTER SEALED ROUND-4 QA PREDECESSOR" in capsys.readouterr().err
    assert not output.exists()


def test_f3_round_six_accepts_only_exact_qa_predecessor_before_output(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    paths = make_paths(tmp_path, evidence_root=tmp_path)
    monkeypatch.setattr(BUNDLE, "validate_content", lambda *_args, **_kwargs: None)
    prior_bundle = tmp_path / "qa-v9-finalization-round-5"
    prior_bundle.mkdir()
    prior_review = prior_bundle / "qa-review.round-5.md"
    write_blocker_review(prior_review, ["F3"])
    prior_manifest = prior_bundle / "qa-review.manifest.json"
    prior_manifest.write_bytes(BUNDLE.canonical_json_bytes({"sealed": True}))
    monkeypatch.setattr(
        BUNDLE,
        "validate_known_invalid_round5_qa_review",
        lambda _paths, review: {
            "review": review.resolve(),
            "manifest": prior_manifest.resolve(),
            "candidate": {"docs_attempt": 1},
            "marker": "known-invalid-round5-f3",
        },
    )
    final_message = tmp_path / "final-docs-commit.finalization-r6-a1.md"
    final_message.write_text(
        "Rationale.\n\nCOMMIT_MESSAGE: feat(inst): publish bounded institutional data\n",
        encoding="utf-8",
    )
    notes = tmp_path / "resolution-notes.finalization-r5-qa.md"
    notes.write_text("## F3: resolved\n", encoding="utf-8")

    def stop_after_predecessor(
        _paths: Any,
        _repo: Path,
        round_no: int,
        expected_paths: tuple[str, ...],
        allowed_rounds: tuple[int, ...],
    ) -> dict[str, Any]:
        assert round_no == 6
        assert expected_paths == BUNDLE.EXPECTED_QA_PATHS
        assert allowed_rounds == (6,)
        raise RuntimeError("STOP AFTER EXACT ROUND-5 F3 PREDECESSOR")

    monkeypatch.setattr(BUNDLE, "validate_fixed_state", stop_after_predecessor)
    output = tmp_path / "qa-v9-finalization-round-6"
    assert BUNDLE.main([
        *paths_argv(paths),
        "run",
        "--cycle", "finalization-f3-exception",
        "--round", "6",
        "--final-docs-commit", str(final_message),
        "--prior-review", str(prior_review),
        "--resolution-notes", str(notes),
        "--output", str(output),
    ]) == 1
    assert "STOP AFTER EXACT ROUND-5 F3 PREDECESSOR" in capsys.readouterr().err
    assert not output.exists()


def test_f4_f5_round_seven_accepts_only_exact_unsealed_predecessor_before_output(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    paths = make_paths(tmp_path, evidence_root=tmp_path)
    monkeypatch.setattr(BUNDLE, "validate_content", lambda *_args, **_kwargs: None)
    prior_review = tmp_path / "qa-review.finalization-r6.canonical.md"
    write_blocker_review(prior_review, ["F4", "F5"])
    prior_adoption = tmp_path / "qa-v9-finalization-round-6/adoption-manifest.json"
    prior_adoption.parent.mkdir()
    prior_adoption.write_bytes(BUNDLE.canonical_json_bytes({"round": 6}))
    monkeypatch.setattr(
        BUNDLE,
        "validate_rejected_round6_qa_review",
        lambda _paths, review: {
            "review": review.resolve(),
            "adoption": prior_adoption.resolve(),
            "candidate": {"docs_attempt": 1},
            "marker": "rejected-round6-f4-f5",
        },
    )
    final_message = tmp_path / "final-docs-commit.finalization-r7-a1.md"
    final_message.write_text(
        "Rationale.\n\nCOMMIT_MESSAGE: feat(inst): publish bounded institutional data\n",
        encoding="utf-8",
    )
    notes = tmp_path / "resolution-notes.finalization-r6-qa.md"
    notes.write_text("## F4: resolved\n## F5: resolved\n", encoding="utf-8")

    def stop_after_predecessor(
        _paths: Any,
        _repo: Path,
        round_no: int,
        expected_paths: tuple[str, ...],
        allowed_rounds: tuple[int, ...],
    ) -> dict[str, Any]:
        assert round_no == 7
        assert expected_paths == BUNDLE.EXPECTED_QA_PATHS
        assert allowed_rounds == (7,)
        raise RuntimeError("STOP AFTER EXACT UNSEALED ROUND-6 F4/F5 PREDECESSOR")

    monkeypatch.setattr(BUNDLE, "validate_fixed_state", stop_after_predecessor)
    output = tmp_path / "qa-v9-finalization-round-7"
    assert BUNDLE.main([
        *paths_argv(paths),
        "run",
        "--cycle", "finalization-f4-f5-exception",
        "--round", "7",
        "--final-docs-commit", str(final_message),
        "--prior-review", str(prior_review),
        "--resolution-notes", str(notes),
        "--output", str(output),
    ]) == 1
    assert "STOP AFTER EXACT UNSEALED ROUND-6 F4/F5 PREDECESSOR" in (
        capsys.readouterr().err
    )
    assert not output.exists()


@requires_owner_machine
def test_f4_f5_authority_is_round_seven_only_and_round_eight_refuses(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert BUNDLE.FINALIZATION_F4_F5_EXCEPTION_SCOPE == tuple(sorted((
        "current-tree-adoption-instead-of-historical-pre-build-origin",
        "owner-authorized-fifth-finalization-repair",
        "owner-authorized-fourth-finalization-retry",
        "owner-authorized-qa-docs-finalization-cycle",
        "owner-authorized-seventh-finalization-f4-f5-repair",
        "owner-authorized-sixth-finalization-f3-repair",
        "repo-local-custom-schema-validator",
    ), key=os.fsencode))
    assert BUNDLE.PINNED_DIGESTS[BUNDLE.FINALIZATION_F4_F5_PLAN] == (
        BUNDLE.sha256_file(Path(__file__).parents[1] / BUNDLE.FINALIZATION_F4_F5_PLAN)
    )
    assert BUNDLE.PINNED_DIGESTS[BUNDLE.FINALIZATION_F4_F5_DECISION] == (
        BUNDLE.sha256_file(
            OWNER.evidence_root
            / "qa-v9-finalization-round-7/owner-decision.md"
        )
    )
    paths = make_paths(tmp_path, evidence_root=tmp_path)
    output = tmp_path / "qa-v9-finalization-round-8"
    assert BUNDLE.main([
        *paths_argv(paths),
        "run",
        "--cycle", "finalization-f4-f5-exception",
        "--round", "8",
        "--final-docs-commit", str(tmp_path / "unused.md"),
        "--output", str(output),
    ]) == 1
    assert "must be exactly 7" in capsys.readouterr().err
    assert not output.exists()


@pytest.mark.parametrize("predecessor", ["gate", "docs"])
def test_repair_round_five_rejects_non_qa_predecessor_before_output(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    predecessor: str,
) -> None:
    paths = make_paths(tmp_path, evidence_root=tmp_path)
    final_message = tmp_path / "final-docs-commit.finalization-r5-a1.md"
    final_message.write_text(
        "Rationale.\n\nCOMMIT_MESSAGE: feat(inst): publish bounded institutional data\n",
        encoding="utf-8",
    )
    notes = tmp_path / "resolution-notes.finalization-r4-qa.md"
    notes.write_text("## F1: resolved\n## F2: resolved\n", encoding="utf-8")
    output = tmp_path / "qa-v9-finalization-round-5"
    flag = "--prior-gate-bundle" if predecessor == "gate" else "--prior-docs-review"
    assert BUNDLE.main([
        *paths_argv(paths),
        "run",
        "--cycle", "finalization-repair-exception",
        "--round", "5",
        "--final-docs-commit", str(final_message),
        flag, str(tmp_path / "wrong-predecessor"),
        "--resolution-notes", str(notes),
        "--output", str(output),
    ]) == 1
    assert not output.exists()


@requires_owner_machine
@pytest.mark.parametrize("name", sorted(BUNDLE.HISTORICAL_POLICIES))
def test_historical_bundle_is_publicly_rejected_and_privately_pinned(name: str) -> None:
    bundle = OWNER.evidence_root / name
    with pytest.raises(RuntimeError, match="declared current-artifact schema defects"):
        BUNDLE.validate_bundle(OWNER, bundle, live_repo=False)
    result = BUNDLE.validate_historical_bundle(OWNER, bundle)
    assert result["marker"] == BUNDLE.HISTORICAL_POLICIES[name]["marker"]
    assert result["defects"] == BUNDLE.HISTORICAL_POLICIES[name]["defects"]


@requires_owner_machine
def test_round_five_is_publicly_rejected_and_exact_f3_predecessor_validates() -> None:
    bundle = OWNER.evidence_root / "qa-v9-finalization-round-5"
    expected = tuple(sorted((*BUNDLE.FALSE_CUSTOM_LABEL_DEFECTS, BUNDLE.OWNER_CONTROLLING_DEFECT)))
    with pytest.raises(RuntimeError, match="declared current-artifact schema defects") as exc:
        BUNDLE.validate_bundle(OWNER, bundle, live_repo=False)
    assert all(defect in str(exc.value) for defect in expected)
    result = BUNDLE.validate_known_invalid_round5_bundle(OWNER, bundle)
    assert result == {
        "bundle": bundle.resolve(),
        "marker": "known-invalid-round5-f3",
        "defects": expected,
    }
    review = BUNDLE.validate_known_invalid_round5_qa_review(
        OWNER, bundle / "qa-review.round-5.md"
    )
    assert review["marker"] == "known-invalid-round5-f3"
    assert BUNDLE.open_blocker_ids(bundle / "qa-review.round-5.md") == ("F3",)


@requires_owner_machine
def test_current_artifact_schema_map_is_exact_all_twenty_three() -> None:
    assert len(BUNDLE.CURRENT_ARTIFACT_SCHEMAS) == 23
    assert set(BUNDLE.CURRENT_ARTIFACT_SCHEMAS) == {
        item["name"]
        for item in json.loads(
            (
                OWNER.evidence_root
                / "qa-v9-finalization-round-5/adoption-manifest.json"
            ).read_text(encoding="utf-8")
        )["artifacts"]
    }
    assert {
        name: BUNDLE.CURRENT_ARTIFACT_SCHEMAS[name]
        for name in BUNDLE.CUSTOM_PHASE_MANIFESTS
    } == {
        name: "m2-11-phase-manifest/v1"
        for name in BUNDLE.CUSTOM_PHASE_MANIFESTS
    }


def test_f4_f5_independent_oracles_are_exact_and_non_vacuous() -> None:
    assert tuple(BUNDLE.CURRENT_ARTIFACT_SCHEMAS) == EXPECTED_ADOPTION_NAMES
    assert tuple(BUNDLE.CUSTOM_PHASE_MANIFESTS) == EXPECTED_PHASE_NAMES
    assert tuple(BUNDLE.PHASE_BASE_INPUTS) == EXPECTED_PHASE_BASE_NAMES
    assert tuple(BUNDLE.PRIOR_GATE_PHASE_SCHEMAS) == EXPECTED_PRIOR_GATE_NAMES
    assert tuple(sorted(BUNDLE.HISTORICAL_POLICIES)) == tuple(
        sorted(EXPECTED_HISTORICAL_NAMES)
    )
    for namespace in EXPECTED_HISTORICAL_NAMES:
        assert BUNDLE.HISTORICAL_POLICIES[namespace]["defects"] == (
            EXPECTED_DEFECT_SETS[namespace]
        )
    expected_round5 = EXPECTED_DEFECT_SETS["qa-v9-finalization-round-5"]
    assert expected_round5 == tuple(
        sorted((*BUNDLE.FALSE_CUSTOM_LABEL_DEFECTS, BUNDLE.OWNER_CONTROLLING_DEFECT))
    )
    assert sum(len(names) for names in EXPECTED_PREDECESSORS.values()) == 27
    assert len(EXPECTED_REFUSAL_IDS) == 558
    assert len(EXPECTED_HAPPY_IDS) == 23
    assert EXPECTED_REFUSAL_IDS.isdisjoint(EXPECTED_HAPPY_IDS)
    assert len(EXPECTED_ALL_IDS) == 581


@pytest.mark.parametrize("case_id", sorted(EXPECTED_ALL_IDS), ids=str)
def test_f4_f5_locked_matrix_case(
    case_id: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    EXECUTED_F4_F5_IDS.add(case_id)
    parts = case_id.split("::")
    family = parts[0]

    if family == "adoption":
        _, name, mutation = parts
        bundle = tmp_path / "bundle"
        path = bundle / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"{name}\n", encoding="utf-8")
        actual = artifact_record(
            name, path, BUNDLE.CURRENT_ARTIFACT_SCHEMAS[name]
        )
        expected = dict(actual)
        mutate_record(actual, expected, mutation, tmp_path)
        match = {
            "wrong-schema": "schema mismatch",
            "cross-path-same-content": "path mismatch",
            "content-stale-digest": "digest mismatch",
            "digest-only": "digest mismatch",
        }[mutation]
        with pytest.raises(RuntimeError, match=match):
            BUNDLE.validate_adoption_record(bundle, actual)
        return

    if family == "phase":
        _, manifest, slot_name, mutation = parts
        slot, name = slot_name.split(":", 1)
        path = tmp_path / manifest / slot / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"{manifest}:{slot}:{name}\n", encoding="utf-8")
        expected = artifact_record(name, path, "test-phase/v1")
        actual = dict(expected)
        mutate_record(actual, expected, mutation, tmp_path)
        match = "digest stale" if mutation == "content-stale-digest" else "record mismatch"
        with pytest.raises(RuntimeError, match=match):
            BUNDLE.validate_exact_record(actual, expected, "phase")
        return

    if family == "history":
        _, namespace, pin = parts
        policies = {
            name: dict(policy) for name, policy in BUNDLE.HISTORICAL_POLICIES.items()
        }
        if pin == "namespace":
            policies[namespace + "-foreign"] = policies.pop(namespace)
        else:
            field = {
                "adoption-sha": "adoption",
                "decision-sha": "decision",
                "token-file-sha": "token_file",
                "token-value": "token",
            }[pin]
            policies[namespace][field] = (
                "sha256:" + "f" * 64 if field == "token" else "f" * 64
            )
        monkeypatch.setattr(BUNDLE, "HISTORICAL_POLICIES", policies)
        if OWNER is None:
            pytest.skip("needs the host machine's real M2-11 evidence artifacts")
        match = "outside" if pin == "namespace" else "pin mismatch"
        with pytest.raises(RuntimeError, match=match):
            BUNDLE.validate_historical_bundle(OWNER, OWNER.evidence_root / namespace)
        return

    if family == "defects":
        _, namespace, mutation = parts
        expected = EXPECTED_DEFECT_SETS[namespace]
        actual = (
            expected[:-1]
            if mutation == "missing"
            else tuple(sorted((*expected, "unexpected-defect")))
        )
        with pytest.raises(RuntimeError, match="defect set mismatch"):
            BUNDLE.validate_exact_defect_set(actual, expected)
        return

    if family == "predecessor":
        _, shape, *detail = parts
        expected = synthetic_predecessor_records(shape, tmp_path)
        actual = [dict(expected[name]) for name in sorted(expected, key=os.fsencode)]
        if detail == ["extra-record"]:
            extra_path = tmp_path / shape / "extra.artifact"
            extra_path.write_text("extra\n", encoding="utf-8")
            actual.append(artifact_record("unexpected-record", extra_path, "test/v1"))
            actual.sort(key=lambda item: os.fsencode(item["name"]))
            with pytest.raises(RuntimeError, match="record set mismatch"):
                BUNDLE.validate_exact_record_set(actual, expected, "predecessor")
            return
        name, mutation = detail
        index = next(i for i, item in enumerate(actual) if item["name"] == name)
        if mutation == "missing":
            actual.pop(index)
        elif mutation == "duplicate":
            actual.append(dict(actual[index]))
            actual.sort(key=lambda item: os.fsencode(item["name"]))
        elif mutation == "relabel":
            actual[index]["name"] = "relabeled-record"
            actual.sort(key=lambda item: os.fsencode(item["name"]))
        else:
            mutate_record(actual[index], expected[name], mutation, tmp_path)
        match = (
            "digest stale"
            if mutation == "content-stale-digest"
            else "record mismatch"
            if mutation in {"cross-path-same-content", "digest-only"}
            else "record set mismatch"
        )
        with pytest.raises(RuntimeError, match=match):
            BUNDLE.validate_exact_record_set(actual, expected, "predecessor")
        return

    if family == "review":
        _, round_name, mutation = parts
        assert round_name == "round6"
        review = tmp_path / "qa-review.finalization-r6.canonical.md"
        write_round6_review_fixture(review)
        expected_path = review
        expected_digest = BUNDLE.sha256_file(review)
        if mutation == "cross-path-same-content":
            foreign = tmp_path / "foreign-review.md"
            foreign.write_bytes(review.read_bytes())
            review = foreign
        elif mutation == "wrong-review-digest":
            expected_digest = "f" * 64
        else:
            text = review.read_text("utf-8")
            replacements = {
                "missing-f4": ("#### F4 [BLOCKER]\n\n- Status: open\n\n", ""),
                "missing-f5": ("#### F5 [BLOCKER]\n\n- Status: open\n\n", ""),
                "relabel-heading": ("#### F4 [BLOCKER]", "#### F4 [MAJOR]"),
                "approved-verdict": (
                    "VERDICT: CHANGES_REQUESTED",
                    "VERDICT: APPROVED",
                ),
                "wrong-token": (BUNDLE.ROUND6_TOKEN, "sha256:" + "e" * 64),
                "wrong-fingerprint": (BUNDLE.ROUND6_FINGERPRINT, "e" * 64),
            }
            if mutation == "extra-f6":
                text = text.replace(
                    "## Verdict",
                    "#### F6 [BLOCKER]\n\n- Status: open\n\n## Verdict",
                )
            else:
                old, new = replacements[mutation]
                text = text.replace(old, new)
            review.write_text(text, encoding="utf-8")
            expected_digest = BUNDLE.sha256_file(review)
        match = (
            "path/digest mismatch"
            if mutation in {"cross-path-same-content", "wrong-review-digest"}
            else "verdict/open-blocker/marker mismatch"
        )
        with pytest.raises(RuntimeError, match=match):
            BUNDLE.validate_rejected_review_identity(
                review,
                expected_path,
                expected_digest,
                ("F4", "F5"),
                BUNDLE.ROUND6_TOKEN,
                BUNDLE.ROUND6_FINGERPRINT,
            )
        return

    assert family == "happy"
    happy_kind, name = parts[1:]
    if happy_kind == "adoption":
        assert name == "round6"
        if OWNER is None:
            pytest.skip("needs the host machine's real M2-11 evidence artifacts")
        BUNDLE.validate_bundle(
            OWNER,
            OWNER.evidence_root / "qa-v9-finalization-round-6",
            live_repo=False,
        )
    elif happy_kind == "phase":
        if OWNER is None:
            pytest.skip("needs the host machine's real M2-11 evidence artifacts")
        bundle = OWNER.evidence_root / "qa-v9-finalization-round-6"
        adoption = BUNDLE.load_canonical_file(bundle / "adoption-manifest.json")
        records = {item["name"]: item for item in adoption["artifacts"]}
        predecessors = retained_predecessor_records("finalization-r6")
        BUNDLE.validate_phase_manifest(
            bundle / name, adoption, records, predecessors
        )
    elif happy_kind == "history":
        if OWNER is None:
            pytest.skip("needs the host machine's real M2-11 evidence artifacts")
        assert BUNDLE.validate_historical_bundle(
            OWNER, OWNER.evidence_root / name
        )["marker"].startswith("known-invalid-")
    elif happy_kind == "defects":
        expected = EXPECTED_DEFECT_SETS[name]
        BUNDLE.validate_exact_defect_set(expected, expected)
    elif happy_kind == "predecessor":
        if name != "finalization-r7" and OWNER is None:
            pytest.skip("needs the host machine's real M2-11 evidence artifacts")
        expected = (
            synthetic_predecessor_records(name, tmp_path)
            if name == "finalization-r7"
            else retained_predecessor_records(name)
        )
        BUNDLE.validate_exact_record_set(
            [expected[key] for key in sorted(expected, key=os.fsencode)],
            expected,
            "predecessor",
        )
    elif happy_kind == "review":
        assert name == "round6"
        if OWNER is None:
            pytest.skip("needs the host machine's real M2-11 evidence artifacts")
        assert BUNDLE.validate_rejected_round6_qa_review(OWNER, OWNER.round6_review)[
            "marker"
        ] == "rejected-round6-f4-f5"
    else:
        assert (happy_kind, name) == ("bundle", "synthetic-round7")
        expected = synthetic_predecessor_records("finalization-r7", tmp_path)
        adoption = {"round": 7, "prior_round": expected}
        assert BUNDLE.phase_expected_predecessors(
            "qa-v9-finalization-round-7", adoption
        ) == expected


def test_f4_f5_all_locked_ids_executed() -> None:
    assert EXECUTED_F4_F5_IDS == EXPECTED_ALL_IDS


@requires_owner_machine
def test_historical_policy_pin_mutation_refuses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    name = "qa-v9-round-3"
    policies = {key: dict(value) for key, value in BUNDLE.HISTORICAL_POLICIES.items()}
    policies[name]["adoption"] = "f" * 64
    monkeypatch.setattr(BUNDLE, "HISTORICAL_POLICIES", policies)
    with pytest.raises(RuntimeError, match="pin mismatch"):
        BUNDLE.validate_historical_bundle(OWNER, OWNER.evidence_root / name)


def test_qa_inventory_is_exact_unique_and_sorted() -> None:
    assert len(BUNDLE.EXPECTED_QA_PATHS) == 76
    assert len(set(BUNDLE.EXPECTED_QA_PATHS)) == 76
    assert list(BUNDLE.EXPECTED_QA_PATHS) == sorted(BUNDLE.EXPECTED_QA_PATHS, key=os.fsencode)
    assert "scripts/build_m2_11_qa_bundle.py" in BUNDLE.EXPECTED_QA_PATHS
    assert "tests/test_m2_11_qa_bundle.py" in BUNDLE.EXPECTED_QA_PATHS


def test_release_inventory_is_the_exact_same_finalization_tree() -> None:
    assert len(BUNDLE.EXPECTED_RELEASE_PATHS) == 76
    assert BUNDLE.EXPECTED_RELEASE_PATHS == BUNDLE.EXPECTED_QA_PATHS
    assert "docs/build/RUN-M2-11-QA-finalization-decision.md" in BUNDLE.EXPECTED_QA_PATHS
    assert "docs/build/RUN-M2-11-QA-finalization-delta-plan.md" in BUNDLE.EXPECTED_QA_PATHS
    assert "docs/build/RUN-M2-11-QA-finalization-exception-decision.md" in BUNDLE.EXPECTED_QA_PATHS
    assert "docs/build/RUN-M2-11-QA-finalization-exception-plan.md" in BUNDLE.EXPECTED_QA_PATHS
    assert "docs/build/RUN-M2-11-QA-finalization-repair-decision.md" in BUNDLE.EXPECTED_QA_PATHS
    assert "docs/build/RUN-M2-11-QA-finalization-repair-plan.md" in BUNDLE.EXPECTED_QA_PATHS
    assert "docs/build/RUN-M2-11-QA-finalization-F3-decision.md" in BUNDLE.EXPECTED_QA_PATHS
    assert "docs/build/RUN-M2-11-QA-finalization-F3-plan.md" in BUNDLE.EXPECTED_QA_PATHS
    assert "docs/build/RUN-M2-11-QA-finalization-F4-F5-decision.md" in BUNDLE.EXPECTED_QA_PATHS
    assert "docs/build/RUN-M2-11-QA-finalization-F4-F5-plan.md" in BUNDLE.EXPECTED_QA_PATHS
    assert "docs/build/RUN-M2-11-QA-finalization-release-hygiene-decision.md" in BUNDLE.EXPECTED_QA_PATHS
    assert "docs/build/RUN-M2-11-QA-finalization-release-hygiene-plan.md" in BUNDLE.EXPECTED_QA_PATHS
    assert "docs/build/RUN-M2-11-QA-finalization-closeout-decision.md" in BUNDLE.EXPECTED_QA_PATHS
    assert "docs/build/RUN-M2-11-QA-finalization-closeout-plan.md" in BUNDLE.EXPECTED_QA_PATHS


def test_seal_docs_requires_final_message_argument() -> None:
    with pytest.raises(SystemExit):
        BUNDLE.main([
            "seal-docs",
            "--bundle", "/tmp/bundle",
            "--qa-review", "/tmp/review",
            "--output", "/tmp/docs",
        ])


def test_devnotes_bind_historical_round_nine_and_only_pending_round_ten_command() -> None:
    text = (Path(__file__).parents[1] / "docs/build/RUN-M2-11-devnotes.md").read_text()
    assert "--cycle finalization-release-hygiene-f1-exception --round 9" in text
    assert "--prior-review \"$root/qa-v9-finalization-round-8/qa-review.round-8.md\"" in text
    assert "final-docs-commit.finalization-r9-a3.md" in text
    assert "resolution-notes.finalization-r8-F1.md" in text
    assert "qa-v9-finalization-round-9" in text
    assert "--cycle finalization-closeout-exception --round 10" in text
    assert "--prior-gate-bundle \"$root/qa-v9-finalization-round-9\"" in text
    assert "final-docs-commit.finalization-r10-a3.md" in text
    assert "resolution-notes.finalization-r9-gate2.md" in text
    assert "qa-v9-finalization-round-10" in text
    assert "cannot create or authorize round 11" in text


def test_validate_fixed_state_accepts_explicit_inventory() -> None:
    assert BUNDLE.validate_fixed_state.__defaults__ == (
        BUNDLE.EXPECTED_QA_PATHS,
        (1, 2, 3),
    )
    assert len(BUNDLE.EXPECTED_RELEASE_PATHS) == 76


def test_generated_qa_report_is_cycle_aware_and_preserves_historical_wording(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = make_paths(tmp_path)
    validations: list[tuple[str, str]] = []
    monkeypatch.setattr(
        BUNDLE,
        "validate_content",
        lambda _paths, schema, _path, phase, *_args: validations.append((schema, phase)),
    )
    final_message = tmp_path / "final-message.md"
    final_message.write_text(
        "Rationale.\n\nCOMMIT_MESSAGE: feat(inst): publish bounded institutional data\n",
        encoding="utf-8",
    )
    dev_notes = tmp_path / "dev-notes.md"
    dev_notes.write_text("synthetic dev notes\n", encoding="utf-8")

    exception_output = tmp_path / "exception"
    exception_output.mkdir()
    exception_artifacts = {"dev-notes.md": dev_notes}
    BUNDLE.write_markdown_artifacts(
        paths,
        {
            "cycle": "finalization-exception",
            "round": 4,
            "repo": tmp_path,
            "final_docs_commit": final_message,
        },
        exception_artifacts,
        exception_output,
    )
    exception_report = (exception_output / "qa-report.md").read_text(encoding="utf-8")
    assert "Logical finalization round 4" in exception_report
    assert "64-path current candidate" in exception_report
    assert "exceptional retry decision" in exception_report
    assert "TD-QA-ORIGIN-1 through TD-QA-ORIGIN-5" in exception_report
    assert "Independent QA review remains pending and authoritative." in exception_report

    repair_output = tmp_path / "repair"
    repair_output.mkdir()
    repair_artifacts = {"dev-notes.md": dev_notes}
    BUNDLE.write_markdown_artifacts(
        paths,
        {
            "cycle": "finalization-repair-exception",
            "round": 5,
            "repo": tmp_path,
            "final_docs_commit": final_message,
        },
        repair_artifacts,
        repair_output,
    )
    repair_report = (repair_output / "qa-report.md").read_text(encoding="utf-8")
    assert "Logical finalization round 5" in repair_report
    assert "66-path F1/F2 repair candidate" in repair_report
    assert "exceptional repair decision" in repair_report
    assert "TD-QA-ORIGIN-1 through TD-QA-ORIGIN-6" in repair_report
    assert "Independent QA review remains pending and authoritative." in repair_report

    f3_output = tmp_path / "f3"
    f3_output.mkdir()
    f3_artifacts = {"dev-notes.md": dev_notes}
    BUNDLE.write_markdown_artifacts(
        paths,
        {
            "cycle": "finalization-f3-exception",
            "round": 6,
            "repo": tmp_path,
            "final_docs_commit": final_message,
        },
        f3_artifacts,
        f3_output,
    )
    f3_report = (f3_output / "qa-report.md").read_text(encoding="utf-8")
    assert "Logical finalization round 6" in f3_report
    assert "68-path F3-only repair candidate" in f3_report
    assert "exceptional F3 decision" in f3_report
    assert "TD-QA-ORIGIN-1 through TD-QA-ORIGIN-7" in f3_report
    assert "Independent QA review remains pending and authoritative." in f3_report

    f4_f5_output = tmp_path / "f4-f5"
    f4_f5_output.mkdir()
    f4_f5_artifacts = {"dev-notes.md": dev_notes}
    BUNDLE.write_markdown_artifacts(
        paths,
        {
            "cycle": "finalization-f4-f5-exception",
            "round": 7,
            "repo": tmp_path,
            "final_docs_commit": final_message,
        },
        f4_f5_artifacts,
        f4_f5_output,
    )
    f4_f5_report = (f4_f5_output / "qa-report.md").read_text(encoding="utf-8")
    assert "Logical finalization round 7" in f4_f5_report
    assert "70-path F4/F5-only repair candidate" in f4_f5_report
    assert "exceptional F4/F5 decision" in f4_f5_report
    assert "TD-QA-ORIGIN-1 through TD-QA-ORIGIN-8" in f4_f5_report
    assert "Independent QA review remains pending and authoritative." in f4_f5_report

    release_output = tmp_path / "release-hygiene"
    release_output.mkdir()
    release_artifacts = {"dev-notes.md": dev_notes}
    BUNDLE.write_markdown_artifacts(
        paths,
        {
            "cycle": "finalization-release-hygiene-exception",
            "round": 8,
            "repo": tmp_path,
            "final_docs_commit": final_message,
        },
        release_artifacts,
        release_output,
    )
    release_report = (release_output / "qa-report.md").read_text(encoding="utf-8")
    assert "Logical finalization round 8" in release_report
    assert "72-path release-hygiene-only repair candidate" in release_report
    assert "exceptional release-hygiene decision" in release_report
    assert "TD-QA-ORIGIN-1 through TD-QA-ORIGIN-9" in release_report
    assert "no product or T0 change" in release_report
    assert "No round 9 is authorized." in release_report

    closeout_output = tmp_path / "closeout"
    closeout_output.mkdir()
    closeout_artifacts = {"dev-notes.md": dev_notes}
    BUNDLE.write_markdown_artifacts(
        paths,
        {
            "cycle": "finalization-closeout-exception",
            "round": 10,
            "repo": tmp_path,
            "final_docs_commit": final_message,
        },
        closeout_artifacts,
        closeout_output,
    )
    closeout_report = (closeout_output / "qa-report.md").read_text(
        encoding="utf-8"
    )
    assert "Logical finalization round 10" in closeout_report
    assert "76-path consolidated closeout candidate" in closeout_report
    assert "TD-QA-ORIGIN-1 through TD-QA-ORIGIN-11" in closeout_report
    assert "no product or T0 change" in closeout_report
    assert "No round 11 is authorized." in closeout_report

    historical_output = tmp_path / "historical"
    historical_output.mkdir()
    historical_artifacts = {"dev-notes.md": dev_notes}
    BUNDLE.write_markdown_artifacts(
        paths,
        {
            "cycle": "finalization",
            "round": 3,
            "repo": tmp_path,
            "final_docs_commit": final_message,
        },
        historical_artifacts,
        historical_output,
    )
    historical_report = (historical_output / "qa-report.md").read_text(encoding="utf-8")
    assert "R1-R7 of the approved QA/docs finalization plan" in historical_report
    assert "TD-QA-ORIGIN-1 through TD-QA-ORIGIN-4" in historical_report
    assert "TD-QA-ORIGIN-5" not in historical_report
    assert validations.count(("qa-report-v1", "qa-synthesis")) == 7


def test_exception_core_manifests_record_owner_overridden_round_cap(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(BUNDLE, "validate_manifest", lambda *_args, **_kwargs: None)
    output = tmp_path / "bundle"
    output.mkdir()
    artifacts: dict[str, Path] = {}
    for name in (
        "plan.md",
        "owner-decision.md",
        "dev-notes.md",
        "changed-files.json",
        "baseline-diff.redacted.patch",
        "external-state.json",
        "external-changes.json",
        "external-diff.redacted.patch",
        "source-preservation.json",
        "isolated-feature.json",
        "gate-ledger.json",
        "gate-results.json",
        "approved-tree.json",
        "candidate-state.json",
        "docs-commit.md",
        "qa-report.md",
    ):
        path = output / name
        path.write_text(f"synthetic {name}\n", encoding="utf-8")
        artifacts[name] = path
    token_path = output / "combined-candidate-token.json"
    token_path.write_bytes(BUNDLE.canonical_json_bytes({"token": "sha256:" + "1" * 64}))
    artifacts[token_path.name] = token_path
    BUNDLE.write_phase_and_adoption_manifests(
        make_paths(tmp_path),
        {
            "round": 4,
            "run_id": "RUN-M2-11-QA-finalization-exception",
            "base": BUNDLE.EXPECTED_BASE,
            "fingerprint": "f" * 64,
            "repo": tmp_path,
            "task_digest": BUNDLE.PINNED_DIGESTS[BUNDLE.FINALIZATION_EXCEPTION_PLAN],
            "exception_scope": BUNDLE.FINALIZATION_RETRY_EXCEPTION_SCOPE,
            "qa_round_cap": 4,
            "qa_round_override": True,
        },
        artifacts,
        output,
    )
    expected_caps = {
        "plan_reviews": 3,
        "qa_rounds": 4,
        "explicit_overrides": {"plan_reviews": False, "qa_rounds": True},
    }
    for name in (
        "docs-commit.manifest.json",
        "qa-gates.core.manifest.json",
        "qa-synthesis.core.manifest.json",
    ):
        assert json.loads((output / name).read_text())["automated_caps"] == expected_caps


def test_repair_core_manifests_record_owner_overridden_round_five_cap(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(BUNDLE, "validate_manifest", lambda *_args, **_kwargs: None)
    output = tmp_path / "bundle"
    output.mkdir()
    artifacts: dict[str, Path] = {}
    for name in (
        "plan.md",
        "owner-decision.md",
        "dev-notes.md",
        "changed-files.json",
        "baseline-diff.redacted.patch",
        "external-state.json",
        "external-changes.json",
        "external-diff.redacted.patch",
        "source-preservation.json",
        "isolated-feature.json",
        "gate-ledger.json",
        "gate-results.json",
        "approved-tree.json",
        "candidate-state.json",
        "docs-commit.md",
        "qa-report.md",
    ):
        path = output / name
        path.write_text(f"synthetic {name}\n", encoding="utf-8")
        artifacts[name] = path
    token_path = output / "combined-candidate-token.json"
    token_path.write_bytes(
        BUNDLE.canonical_json_bytes({"token": "sha256:" + "1" * 64})
    )
    artifacts[token_path.name] = token_path
    BUNDLE.write_phase_and_adoption_manifests(
        make_paths(tmp_path),
        {
            "round": 5,
            "run_id": "RUN-M2-11-QA-finalization-repair-exception",
            "base": BUNDLE.EXPECTED_BASE,
            "fingerprint": "f" * 64,
            "repo": tmp_path,
            "task_digest": BUNDLE.PINNED_DIGESTS[BUNDLE.FINALIZATION_REPAIR_PLAN],
            "exception_scope": BUNDLE.FINALIZATION_REPAIR_EXCEPTION_SCOPE,
            "qa_round_cap": 5,
            "qa_round_override": True,
        },
        artifacts,
        output,
    )
    expected_caps = {
        "plan_reviews": 3,
        "qa_rounds": 5,
        "explicit_overrides": {"plan_reviews": False, "qa_rounds": True},
    }
    for name in (
        "docs-commit.manifest.json",
        "qa-gates.core.manifest.json",
        "qa-synthesis.core.manifest.json",
    ):
        assert json.loads((output / name).read_text())["automated_caps"] == expected_caps


def test_f3_manifests_record_round_six_cap_and_honest_custom_labels(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(BUNDLE, "validate_manifest", lambda *_args, **_kwargs: None)
    output = tmp_path / "bundle"
    output.mkdir()
    artifacts: dict[str, Path] = {}
    for name in (
        "plan.md", "owner-decision.md", "dev-notes.md", "changed-files.json",
        "baseline-diff.redacted.patch", "external-state.json", "external-changes.json",
        "external-diff.redacted.patch", "source-preservation.json", "isolated-feature.json",
        "gate-ledger.json", "gate-results.json", "approved-tree.json", "candidate-state.json",
        "docs-commit.md", "qa-report.md",
    ):
        path = output / name
        path.write_text(f"synthetic {name}\n", encoding="utf-8")
        artifacts[name] = path
    token_path = output / "combined-candidate-token.json"
    token_path.write_bytes(BUNDLE.canonical_json_bytes({"token": "sha256:" + "1" * 64}))
    artifacts[token_path.name] = token_path
    prior_review = tmp_path / "qa-review.round-5.md"
    prior_review.write_text("VERDICT: CHANGES_REQUESTED\n", encoding="utf-8")
    prior_manifest = tmp_path / "qa-review.manifest.json"
    prior_manifest.write_bytes(BUNDLE.canonical_json_bytes({"sealed": True}))
    notes = tmp_path / "resolution.md"
    notes.write_text("## F3: resolved\n", encoding="utf-8")
    BUNDLE.write_phase_and_adoption_manifests(
        make_paths(tmp_path),
        {
            "round": 6,
            "run_id": "RUN-M2-11-QA-finalization-f3-exception",
            "base": BUNDLE.EXPECTED_BASE,
            "fingerprint": "f" * 64,
            "repo": tmp_path,
            "task_digest": BUNDLE.PINNED_DIGESTS[BUNDLE.FINALIZATION_F3_PLAN],
            "exception_scope": BUNDLE.FINALIZATION_F3_EXCEPTION_SCOPE,
            "qa_round_cap": 6,
            "qa_round_override": True,
            "prior_review": prior_review,
            "prior_review_manifest": prior_manifest,
            "prior_review_phase": "qa",
            "resolution_notes": notes,
        },
        artifacts,
        output,
    )
    adoption = json.loads((output / "adoption-manifest.json").read_text())
    records = {item["name"]: item for item in adoption["artifacts"]}
    assert len(records) == 23
    for name in BUNDLE.CUSTOM_PHASE_MANIFESTS:
        assert records[name]["schema"] == "m2-11-phase-manifest/v1"
    expected_caps = {
        "plan_reviews": 3,
        "qa_rounds": 6,
        "explicit_overrides": {"plan_reviews": False, "qa_rounds": True},
    }
    for name in (
        "docs-commit.manifest.json",
        "qa-gates.core.manifest.json",
        "qa-synthesis.core.manifest.json",
    ):
        assert json.loads((output / name).read_text())["automated_caps"] == expected_caps


def test_f4_f5_manifests_bind_unsealed_round_six_adoption_and_round_seven_cap(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(BUNDLE, "validate_manifest", lambda *_args, **_kwargs: None)
    output = tmp_path / "bundle"
    output.mkdir()
    artifacts: dict[str, Path] = {}
    for name in (
        "plan.md", "owner-decision.md", "dev-notes.md", "changed-files.json",
        "baseline-diff.redacted.patch", "external-state.json", "external-changes.json",
        "external-diff.redacted.patch", "source-preservation.json", "isolated-feature.json",
        "gate-ledger.json", "gate-results.json", "approved-tree.json", "candidate-state.json",
        "docs-commit.md", "qa-report.md",
    ):
        path = output / name
        path.write_text(f"synthetic {name}\n", encoding="utf-8")
        artifacts[name] = path
    token_path = output / "combined-candidate-token.json"
    token_path.write_bytes(
        BUNDLE.canonical_json_bytes({"token": "sha256:" + "1" * 64})
    )
    artifacts[token_path.name] = token_path
    prior_review = tmp_path / "qa-review.finalization-r6.canonical.md"
    prior_review.write_text("VERDICT: CHANGES_REQUESTED\n", encoding="utf-8")
    prior_adoption = tmp_path / "round6-adoption-manifest.json"
    prior_adoption.write_bytes(BUNDLE.canonical_json_bytes({"round": 6}))
    notes = tmp_path / "resolution-notes.finalization-r6-qa.md"
    notes.write_text("## F4: resolved\n## F5: resolved\n", encoding="utf-8")
    BUNDLE.write_phase_and_adoption_manifests(
        make_paths(tmp_path),
        {
            "round": 7,
            "run_id": "RUN-M2-11-QA-finalization-f4-f5-exception",
            "base": BUNDLE.EXPECTED_BASE,
            "fingerprint": "f" * 64,
            "repo": tmp_path,
            "task_digest": BUNDLE.PINNED_DIGESTS[BUNDLE.FINALIZATION_F4_F5_PLAN],
            "exception_scope": BUNDLE.FINALIZATION_F4_F5_EXCEPTION_SCOPE,
            "qa_round_cap": 7,
            "qa_round_override": True,
            "prior_review": prior_review,
            "prior_bundle_adoption": prior_adoption,
            "prior_review_phase": "qa",
            "resolution_notes": notes,
        },
        artifacts,
        output,
    )
    adoption = json.loads((output / "adoption-manifest.json").read_text())
    assert set(adoption["prior_round"]) == {
        "prior-qa-review", "prior-bundle-adoption", "resolution-notes"
    }
    assert adoption["prior_round"]["prior-bundle-adoption"]["path"] == str(
        prior_adoption.resolve()
    )
    records = {item["name"]: item for item in adoption["artifacts"]}
    assert len(records) == 23
    for name in BUNDLE.CUSTOM_PHASE_MANIFESTS:
        assert records[name]["schema"] == "m2-11-phase-manifest/v1"
        phase = json.loads((output / name).read_text())
        inputs = {item["name"]: item for item in phase["inputs"]}
        for predecessor_name, record in adoption["prior_round"].items():
            assert inputs[predecessor_name] == record
    expected_caps = {
        "plan_reviews": 3,
        "qa_rounds": 7,
        "explicit_overrides": {"plan_reviews": False, "qa_rounds": True},
    }
    for name in (
        "docs-commit.manifest.json",
        "qa-gates.core.manifest.json",
        "qa-synthesis.core.manifest.json",
    ):
        assert json.loads((output / name).read_text())["automated_caps"] == expected_caps


def test_seal_docs_success_binds_final_message_and_review_manifest(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fixture = seal_docs_fixture(tmp_path, monkeypatch)
    assert run_seal_docs(fixture) == 0
    assert fixture["bundle_validations"] == [(fixture["bundle"], True)]
    manifest = json.loads((fixture["output"] / "docs-review-input.manifest.json").read_text())
    inputs = {item["name"]: item for item in manifest["inputs"]}
    assert inputs["final-docs-commit"] == {
        "name": "final-docs-commit",
        "path": str(fixture["final_commit"].resolve()),
        "digest": "sha256:" + BUNDLE.sha256_file(fixture["final_commit"]),
        "schema": "docs-commit-v1",
        "required": True,
    }
    assert inputs["qa-review-manifest"]["path"] == str(fixture["sealed"].resolve())
    assert any("docs-commit-v1" in " ".join(command) for command in fixture["commands"])


def test_exception_round_four_real_qa_seal_to_docs_a1_binds_same_candidate_tree(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixture = seal_docs_fixture(
        tmp_path,
        monkeypatch,
        round_no=4,
        exception_scope=BUNDLE.FINALIZATION_RETRY_EXCEPTION_SCOPE,
        presealed=False,
    )
    assert BUNDLE.main([
        *paths_argv(fixture["paths"]),
        "seal-review",
        "--bundle", str(fixture["bundle"]),
        "--review", str(fixture["review_source"]),
    ]) == 0
    sealed = json.loads(fixture["sealed"].read_text(encoding="utf-8"))
    assert sealed["round"] == 4
    assert sealed["output"]["path"] == str(fixture["review"].resolve())
    sealed_inputs = {item["name"]: item for item in sealed["inputs"]}
    assert sealed_inputs["adoption-manifest"]["path"] == str(
        (fixture["bundle"] / "adoption-manifest.json").resolve()
    )

    assert run_seal_docs(fixture) == 0
    assert fixture["bundle_validations"] == [
        (fixture["bundle"], True),
        (fixture["bundle"], True),
    ]
    docs_manifest = json.loads(
        (fixture["output"] / "docs-review-input.manifest.json").read_text(
            encoding="utf-8"
        )
    )
    docs_inputs = {item["name"]: item for item in docs_manifest["inputs"]}
    assert docs_manifest["round"] == 4
    assert docs_inputs["qa-review"]["digest"] == sealed["output"]["digest"]
    assert docs_inputs["qa-review-manifest"]["path"] == str(
        fixture["sealed"].resolve()
    )
    assert docs_inputs["final-docs-commit"]["path"] == str(
        fixture["final_commit"].resolve()
    )
    approved = json.loads(
        Path(docs_inputs["approved-tree"]["path"]).read_text(encoding="utf-8")
    )
    final_tree = json.loads(
        (fixture["output"] / "approved-tree.json").read_text(encoding="utf-8")
    )
    assert final_tree == approved
    assert docs_manifest["output"]["digest"] == "sha256:" + BUNDLE.sha256_file(
        fixture["output"] / "approved-tree.json"
    )


@pytest.mark.parametrize("substitution", ["review", "manifest"])
def test_exception_round_four_docs_a1_rejects_substituted_qa_seal(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    substitution: str,
) -> None:
    fixture = seal_docs_fixture(
        tmp_path,
        monkeypatch,
        round_no=4,
        exception_scope=BUNDLE.FINALIZATION_RETRY_EXCEPTION_SCOPE,
        presealed=False,
    )
    assert BUNDLE.main([
        *paths_argv(fixture["paths"]),
        "seal-review",
        "--bundle", str(fixture["bundle"]),
        "--review", str(fixture["review_source"]),
    ]) == 0
    overrides: dict[str, Path] = {}
    if substitution == "review":
        foreign = tmp_path / "foreign-review.md"
        foreign.write_bytes(fixture["review"].read_bytes())
        overrides["review"] = foreign
    else:
        manifest = json.loads(fixture["sealed"].read_text(encoding="utf-8"))
        manifest["worktree_digest"] = "substituted-candidate"
        fixture["sealed"].write_bytes(BUNDLE.canonical_json_bytes(manifest))
    assert run_seal_docs(fixture, **overrides) == 1
    assert not fixture["output"].exists()


@pytest.mark.parametrize("collision", ["review", "manifest"])
def test_exception_round_four_qa_seal_collision_is_refusal_atomic(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    collision: str,
) -> None:
    fixture = seal_docs_fixture(
        tmp_path,
        monkeypatch,
        round_no=4,
        exception_scope=BUNDLE.FINALIZATION_RETRY_EXCEPTION_SCOPE,
        presealed=False,
    )
    occupied = fixture["review"] if collision == "review" else fixture["sealed"]
    counterpart = fixture["sealed"] if collision == "review" else fixture["review"]
    occupied.write_text(f"occupied {collision}\n", encoding="utf-8")
    before = occupied.read_bytes()
    assert BUNDLE.main([
        *paths_argv(fixture["paths"]),
        "seal-review",
        "--bundle", str(fixture["bundle"]),
        "--review", str(fixture["review_source"]),
    ]) == 1
    assert occupied.read_bytes() == before
    assert not counterpart.exists()


@pytest.mark.parametrize("message", ["missing final path", "extra final path"])
def test_seal_docs_inventory_refusal_leaves_output_absent(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, message: str) -> None:
    fixture = seal_docs_fixture(tmp_path, monkeypatch)
    monkeypatch.setattr(BUNDLE, "validate_fixed_state", lambda *_args: (_ for _ in ()).throw(RuntimeError(message)))
    assert run_seal_docs(fixture) == 1
    assert not fixture["output"].exists()


def test_seal_docs_rejects_provisional_or_symlink_message_before_output(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fixture = seal_docs_fixture(tmp_path, monkeypatch)
    assert run_seal_docs(fixture, final_commit=fixture["provisional"]) == 1
    assert not fixture["output"].exists()
    link = tmp_path / "message-link.md"
    link.symlink_to(fixture["final_commit"])
    assert run_seal_docs(fixture, final_commit=link) == 1
    assert not fixture["output"].exists()


def test_seal_docs_rejects_cross_path_review_before_output(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fixture = seal_docs_fixture(tmp_path, monkeypatch)
    other = tmp_path / "other-review.md"
    other.write_text(fixture["review"].read_text(), encoding="utf-8")
    assert run_seal_docs(fixture, review=other) == 1
    assert not fixture["output"].exists()


def test_seal_docs_rejects_missing_sealed_manifest_before_output(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fixture = seal_docs_fixture(tmp_path, monkeypatch)
    fixture["sealed"].unlink()
    assert run_seal_docs(fixture) == 1
    assert not fixture["output"].exists()


def test_seal_docs_rejects_malformed_final_message_before_output(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fixture = seal_docs_fixture(tmp_path, monkeypatch)
    fixture["final_commit"].write_text("not a docs-commit artifact\n", encoding="utf-8")

    def checked(argv: list[str], *_args: Any, **_kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        if "docs-commit-v1" in " ".join(argv):
            raise RuntimeError("invalid docs-commit-v1")
        return subprocess.CompletedProcess([], 0, b"", b"")

    monkeypatch.setattr(BUNDLE, "run_checked", checked)
    assert run_seal_docs(fixture) == 1
    assert not fixture["output"].exists()


@pytest.mark.parametrize("mutation", ["wrong-candidate", "extra-input", "relabel-input", "changed-output"])
def test_seal_docs_rejects_substituted_sealed_manifest(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, mutation: str) -> None:
    fixture = seal_docs_fixture(tmp_path, monkeypatch)
    manifest = json.loads(fixture["sealed"].read_text())
    if mutation == "wrong-candidate":
        manifest["worktree_digest"] = "another-candidate"
    elif mutation == "extra-input":
        manifest["inputs"].append(dict(manifest["inputs"][0], name="extra"))
    elif mutation == "relabel-input":
        manifest["inputs"][0]["name"] = "combined-candidate-token"
    else:
        manifest["output"]["schema"] = "docs-commit-v1"
    fixture["sealed"].write_bytes(BUNDLE.canonical_json_bytes(manifest))
    assert run_seal_docs(fixture) == 1
    assert not fixture["output"].exists()


def test_seal_docs_rejects_duplicate_manifest_key_before_output(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fixture = seal_docs_fixture(tmp_path, monkeypatch)
    raw = fixture["sealed"].read_text()
    fixture["sealed"].write_text(raw.replace('{"base_ref":', '{"base_ref":"duplicate","base_ref":', 1), encoding="utf-8")
    assert run_seal_docs(fixture) == 1
    assert not fixture["output"].exists()


def test_seal_docs_rejects_stale_input_or_changed_review_before_output(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fixture = seal_docs_fixture(tmp_path, monkeypatch)
    fixture["candidate"].write_bytes(BUNDLE.canonical_json_bytes({"state": "changed"}))
    assert run_seal_docs(fixture) == 1
    assert not fixture["output"].exists()

    fixture = seal_docs_fixture(tmp_path / "second", monkeypatch)
    fixture["review"].write_text("changed\n\nVERDICT: APPROVED\n", encoding="utf-8")
    assert run_seal_docs(fixture) == 1
    assert not fixture["output"].exists()


def test_seal_docs_rejects_attempt_cap_missing_prior_and_cross_round_message(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fixture = seal_docs_fixture(tmp_path, monkeypatch)
    assert run_seal_docs(fixture, attempt=4) == 1
    assert not fixture["output"].exists()
    assert run_seal_docs(fixture, attempt=2) == 1
    assert not fixture["output"].exists()
    wrong = tmp_path / "final-docs-commit.finalization-r2-a1.md"
    wrong.write_text(fixture["final_commit"].read_text(), encoding="utf-8")
    assert run_seal_docs(fixture, final_commit=wrong) == 1
    assert not fixture["output"].exists()


def test_docs_attempt_two_binds_exact_same_candidate_predecessor(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fixture = seal_docs_fixture(tmp_path, monkeypatch)
    assert run_seal_docs(fixture) == 0
    seal_synthetic_docs_review(fixture, tmp_path, verdict="CHANGES_REQUESTED")
    prior_review = fixture["output"] / "docs-review.attempt-1.md"
    validated = BUNDLE.validate_sealed_docs_review(fixture["paths"], prior_review, 1)
    assert validated["round"] == 3
    notes = tmp_path / "docs-resolution.md"
    notes.write_text("## F1: resolved\n", encoding="utf-8")
    message = tmp_path / "final-docs-commit.finalization-r3-a2.md"
    message.write_text(fixture["final_commit"].read_text(), encoding="utf-8")
    output = tmp_path / "docs-v9-finalization-r3-a2"
    assert run_seal_docs(
        fixture,
        attempt=2,
        final_commit=message,
        output=output,
        prior_docs_review=prior_review,
        resolution_notes=notes,
    ) == 0
    manifest = json.loads((output / "docs-review-input.manifest.json").read_text())
    inputs = {item["name"]: item for item in manifest["inputs"]}
    assert inputs["prior-docs-review-manifest"]["path"] == str(validated["manifest"])


@pytest.mark.parametrize("mutation", ["foreign-base", "relabelled-output"])
def test_sealed_docs_predecessor_rejects_foreign_graph(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    mutation: str,
) -> None:
    fixture = seal_docs_fixture(tmp_path, monkeypatch)
    assert run_seal_docs(fixture) == 0
    input_path = fixture["output"] / "docs-review-input.manifest.json"
    value = json.loads(input_path.read_text())
    if mutation == "foreign-base":
        value["base_ref"] = "f" * 40
    else:
        value["output"] = dict(value["output"], path=str((tmp_path / "foreign-tree.json").resolve()))
    input_path.write_bytes(BUNDLE.canonical_json_bytes(value))
    seal_synthetic_docs_review(fixture, tmp_path, verdict="CHANGES_REQUESTED")
    with pytest.raises(RuntimeError, match="predecessor graph|incomplete or relabelled"):
        BUNDLE.validate_sealed_docs_review(fixture["paths"], fixture["output"] / "docs-review.attempt-1.md", 1)


def seal_synthetic_docs_review(
    fixture: dict[str, Any],
    tmp_path: Path,
    verdict: str = "APPROVED",
) -> Path:
    review = tmp_path / "docs-review-source.md"
    findings = ""
    if verdict == "CHANGES_REQUESTED":
        findings = "## Findings\n\n#### F1 [BLOCKER]\n\n- Status: open\n\n"
    review.write_text(f"{findings}## Verdict\n\nVERDICT: {verdict}\n", encoding="utf-8")
    assert BUNDLE.main([
        *paths_argv(fixture["paths"]),
        "seal-docs-review",
        "--docs-bundle", str(fixture["output"]),
        "--review", str(review),
    ]) == 0
    return fixture["output"] / "docs-review.manifest.json"


def test_seal_docs_review_binds_exact_input_manifest(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fixture = seal_docs_fixture(tmp_path, monkeypatch)
    assert run_seal_docs(fixture) == 0
    manifest_path = seal_synthetic_docs_review(fixture, tmp_path)
    manifest = json.loads(manifest_path.read_text())
    assert manifest["attempt"] == 1
    assert manifest["output"]["path"] == str((fixture["output"] / "docs-review.attempt-1.md").resolve())
    bound = {item["name"]: item for item in manifest["inputs"]}
    assert bound["docs-review-input-manifest"]["digest"] == "sha256:" + BUNDLE.sha256_file(
        fixture["output"] / "docs-review-input.manifest.json"
    )


@pytest.mark.parametrize("collision", ["manifest", "review", "both"])
def test_seal_qa_review_collision_is_refusal_atomic(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    collision: str,
) -> None:
    fixture = seal_docs_fixture(tmp_path, monkeypatch)
    target = fixture["bundle"] / "qa-review.round-3.md"
    manifest = fixture["bundle"] / "qa-review.manifest.json"
    if collision in ("review", "both"):
        target.write_text("occupied review\n", encoding="utf-8")
    if collision in ("manifest", "both"):
        manifest.write_text("occupied manifest\n", encoding="utf-8")
    before = {
        path: path.read_bytes() for path in (target, manifest) if path.exists()
    }
    assert BUNDLE.main([
        *paths_argv(fixture["paths"]),
        "seal-review",
        "--bundle", str(fixture["bundle"]),
        "--review", str(fixture["review"]),
    ]) == 1
    assert {path: path.read_bytes() for path in (target, manifest) if path.exists()} == before


def test_validate_release_pre_and_post_stage_and_rejects_unrelated_cached_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(BUNDLE, "EXPECTED_RELEASE_PATHS", ("a",))
    fixture = seal_docs_fixture(tmp_path, monkeypatch)
    assert run_seal_docs(fixture) == 0
    seal_synthetic_docs_review(fixture, tmp_path)
    stage = {"cached": "", "tree": "a" * 40}

    def checked(argv: list[str], *_args: Any, **_kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        if argv[:2] == ["git", "branch"]:
            out = BUNDLE.EXPECTED_BRANCH
        elif argv[:3] == ["git", "rev-parse", "HEAD"]:
            out = BUNDLE.EXPECTED_HEAD
        elif argv[:3] == ["git", "rev-parse", "origin/main"]:
            out = BUNDLE.EXPECTED_BASE
        elif argv[:4] == ["git", "diff", "--cached", "--name-only"]:
            out = stage["cached"]
        elif argv[:4] == ["git", "diff", "--name-only", "-z"]:
            return subprocess.CompletedProcess(argv, 0, b"a\0", b"")
        elif argv[:3] == ["git", "diff", "--name-only"]:
            out = ""
        elif argv[:3] == ["git", "ls-files", "--others"]:
            out = ""
        elif argv[:2] == ["git", "write-tree"]:
            out = stage["tree"]
        else:
            out = ""
        return subprocess.CompletedProcess(argv, 0, out.encode(), b"")

    monkeypatch.setattr(BUNDLE, "run_checked", checked)
    assert BUNDLE.main([*paths_argv(fixture["paths"]), "validate-release", "--docs-bundle", str(fixture["output"]), "--mode", "pre-stage"]) == 0
    stage["cached"] = "a"
    assert BUNDLE.main([*paths_argv(fixture["paths"]), "validate-release", "--docs-bundle", str(fixture["output"]), "--mode", "post-stage"]) == 0
    stage["cached"] = "b"
    assert BUNDLE.main([*paths_argv(fixture["paths"]), "validate-release", "--docs-bundle", str(fixture["output"]), "--mode", "post-stage"]) == 1


def test_validate_release_rejects_docs_output_relabel_before_git(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fixture = seal_docs_fixture(tmp_path, monkeypatch)
    assert run_seal_docs(fixture) == 0
    input_path = fixture["output"] / "docs-review-input.manifest.json"
    review_input = json.loads(input_path.read_text())
    review_input["output"] = {
        "name": "final-docs-tree",
        "path": str((tmp_path / "different-tree.json").resolve()),
        "digest": "sha256:" + "2" * 64,
        "schema": "approved-tree/v1",
        "required": True,
    }
    input_path.write_bytes(BUNDLE.canonical_json_bytes(review_input))
    seal_synthetic_docs_review(fixture, tmp_path)
    assert BUNDLE.main([
        *paths_argv(fixture["paths"]),
        "validate-release",
        "--docs-bundle", str(fixture["output"]),
        "--mode", "pre-stage",
    ]) == 1


@requires_round7_history
def test_release_hygiene_exact_archive_and_thirteen_line_delta() -> None:
    repo = Path(__file__).parents[1]
    BUNDLE.validate_release_hygiene_delta(repo)
    assert sum(len(lines) for lines in BUNDLE.RELEASE_HYGIENE_LINE_EDITS.values()) == 13
    for name, line_numbers in BUNDLE.RELEASE_HYGIENE_LINE_EDITS.items():
        lines = (repo / name).read_bytes().splitlines(keepends=True)
        assert all(not lines[line_number - 1].endswith(b"  \n") for line_number in line_numbers)


def test_release_hygiene_owner_v2_is_digest_scoped_and_pinned() -> None:
    release_digest = "sha256:" + BUNDLE.PINNED_DIGESTS[
        BUNDLE.FINALIZATION_RELEASE_HYGIENE_PLAN
    ]
    assert BUNDLE.current_artifact_schemas()["owner-decision.md"] == "owner-decision-v1"
    assert BUNDLE.current_artifact_schemas(release_digest)["owner-decision.md"] == "owner-decision-v2"
    repo = Path(__file__).parents[1]
    assert BUNDLE.sha256_file(repo / BUNDLE.FINALIZATION_RELEASE_HYGIENE_PLAN) == release_digest.removeprefix("sha256:")
    assert BUNDLE.sha256_file(repo / BUNDLE.FINALIZATION_RELEASE_HYGIENE_DECISION) == BUNDLE.PINNED_DIGESTS[
        BUNDLE.FINALIZATION_RELEASE_HYGIENE_DECISION
    ]


@requires_owner_machine
def test_release_hygiene_exact_sealed_round_seven_predecessor() -> None:
    result = BUNDLE.validate_release_hygiene_predecessor(OWNER, OWNER.round7_docs_review)
    assert result["round"] == 7
    assert result["attempt"] == 2
    assert result["input"]["worktree_digest"] == BUNDLE.ROUND7_FINGERPRINT


def test_release_hygiene_resolution_is_exact_and_mutation_refuses(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = make_paths(tmp_path, evidence_root=tmp_path)
    path = tmp_path / "resolution-notes.finalization-r7-release.md"
    path.write_text(BUNDLE.RELEASE_HYGIENE_RESOLUTION_TEXT, encoding="utf-8")
    assert BUNDLE.validate_release_hygiene_resolution(paths, path) == path.resolve()
    path.write_text(
        BUNDLE.RELEASE_HYGIENE_RESOLUTION_TEXT.replace("13 Markdown", "12 Markdown"),
        encoding="utf-8",
    )
    with pytest.raises(RuntimeError, match="path/content mismatch"):
        BUNDLE.validate_release_hygiene_resolution(paths, path)


def test_private_tree_whitespace_refusal_preserves_real_index(
    tmp_path: Path,
) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "config", "user.email", "qa@example.invalid")
    git(repo, "config", "user.name", "QA")
    write(repo / "clean.md", "clean\n")
    git(repo, "add", "clean.md")
    git(repo, "commit", "-qm", "base")
    write(repo / "dirty.md", "trailing  \n")
    index = Path(git(repo, "rev-parse", "--git-path", "index").decode().strip())
    if not index.is_absolute():
        index = repo / index
    before = BUNDLE.sha256_file(index)
    state = {
        "repo": repo,
        "round": 1,
        "head": git(repo, "rev-parse", "HEAD").decode().strip(),
        "paths": ["dirty.md"],
        "index_path": index,
    }
    with pytest.raises(RuntimeError, match="command failed"):
        BUNDLE.compute_approved_tree(state)
    assert BUNDLE.sha256_file(index) == before


def test_release_hygiene_manifests_bind_v2_owner_round_eight_cap(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(BUNDLE, "validate_manifest", lambda *_args, **_kwargs: None)
    output = tmp_path / "bundle"
    output.mkdir()
    artifacts: dict[str, Path] = {}
    for name in (
        "plan.md", "owner-decision.md", "dev-notes.md", "changed-files.json",
        "baseline-diff.redacted.patch", "external-state.json", "external-changes.json",
        "external-diff.redacted.patch", "source-preservation.json", "isolated-feature.json",
        "gate-ledger.json", "gate-results.json", "approved-tree.json", "candidate-state.json",
        "docs-commit.md", "qa-report.md",
    ):
        path = output / name
        path.write_text(f"synthetic {name}\n", encoding="utf-8")
        artifacts[name] = path
    token_path = output / "combined-candidate-token.json"
    token_path.write_bytes(
        BUNDLE.canonical_json_bytes({"token": "sha256:" + "1" * 64})
    )
    artifacts[token_path.name] = token_path
    prior_review = tmp_path / "docs-review.attempt-2.md"
    prior_review.write_text("VERDICT: APPROVED\n", encoding="utf-8")
    prior_manifest = tmp_path / "docs-review.manifest.json"
    prior_manifest.write_bytes(BUNDLE.canonical_json_bytes({"sealed": True}))
    notes = tmp_path / "resolution-notes.finalization-r7-release.md"
    notes.write_text(BUNDLE.RELEASE_HYGIENE_RESOLUTION_TEXT, encoding="utf-8")
    BUNDLE.write_phase_and_adoption_manifests(
        make_paths(tmp_path),
        {
            "round": 8,
            "run_id": "RUN-M2-11-QA-finalization-release-hygiene-exception",
            "base": BUNDLE.EXPECTED_BASE,
            "fingerprint": "f" * 64,
            "repo": tmp_path,
            "task_digest": BUNDLE.PINNED_DIGESTS[
                BUNDLE.FINALIZATION_RELEASE_HYGIENE_PLAN
            ],
            "exception_scope": BUNDLE.FINALIZATION_RELEASE_HYGIENE_EXCEPTION_SCOPE,
            "qa_round_cap": 8,
            "qa_round_override": True,
            "prior_review": prior_review,
            "prior_review_manifest": prior_manifest,
            "prior_review_phase": "docs",
            "resolution_notes": notes,
        },
        artifacts,
        output,
    )
    adoption = json.loads((output / "adoption-manifest.json").read_text())
    records = {item["name"]: item for item in adoption["artifacts"]}
    assert records["owner-decision.md"]["schema"] == "owner-decision-v2"
    assert set(adoption["prior_round"]) == {
        "prior-docs-review", "prior-review-manifest", "resolution-notes"
    }
    for name in BUNDLE.CUSTOM_PHASE_MANIFESTS:
        inputs = {
            item["name"]: item
            for item in json.loads((output / name).read_text())["inputs"]
        }
        assert inputs["owner-exception"]["schema"] == "owner-decision-v2"
    for name in (
        "docs-commit.manifest.json",
        "qa-gates.core.manifest.json",
        "qa-synthesis.core.manifest.json",
    ):
        assert json.loads((output / name).read_text())["automated_caps"] == {
            "plan_reviews": 3,
            "qa_rounds": 8,
            "explicit_overrides": {"plan_reviews": False, "qa_rounds": True},
        }


def test_release_hygiene_round_eight_transition_is_exact_and_round_nine_refuses(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    paths = make_paths(
        tmp_path,
        expected_root=Path(__file__).parents[1],
        evidence_root=tmp_path,
    )
    monkeypatch.setattr(BUNDLE, "validate_content", lambda *_args, **_kwargs: None)
    review_dir = tmp_path / "docs-v9-finalization-r7-a2"
    review_dir.mkdir()
    review = review_dir / "docs-review.attempt-2.md"
    review.write_text("## Verdict\n\nVERDICT: APPROVED\n", encoding="utf-8")
    manifest = review_dir / "docs-review.manifest.json"
    manifest.write_bytes(BUNDLE.canonical_json_bytes({"sealed": True}))
    resolution = tmp_path / "resolution-notes.finalization-r7-release.md"
    resolution.write_text(BUNDLE.RELEASE_HYGIENE_RESOLUTION_TEXT, encoding="utf-8")
    final_message = tmp_path / "final-docs-commit.finalization-r8-a3.md"
    final_message.write_text(
        "First rationale.\n\nSecond rationale.\n\n"
        "COMMIT_MESSAGE: feat(inst): publish bounded institutional data\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(BUNDLE, "next_finalization_docs_attempt", lambda _paths: 3)
    monkeypatch.setattr(
        BUNDLE,
        "finalization_docs_attempts",
        lambda _paths: {2: (7, review_dir.resolve())},
    )
    monkeypatch.setattr(
        BUNDLE,
        "validate_release_hygiene_predecessor",
        lambda _paths, value: {
            "review": value.resolve(),
            "manifest": manifest.resolve(),
            "round": 7,
            "attempt": 2,
        },
    )
    monkeypatch.setattr(
        BUNDLE, "validate_release_hygiene_resolution", lambda _paths, value: value.resolve()
    )
    monkeypatch.setattr(
        BUNDLE,
        "validate_fixed_state",
        lambda *_args, **_kwargs: {"repo": Path(__file__).parents[1]},
    )
    monkeypatch.setattr(
        BUNDLE,
        "compute_approved_tree",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("STOP AT PRIVATE STAGED CHECK BEFORE OUTPUT")
        ),
    )
    output = tmp_path / "qa-v9-finalization-round-8"
    assert BUNDLE.main([
        *paths_argv(paths),
        "run",
        "--cycle", "finalization-release-hygiene-exception",
        "--round", "8",
        "--final-docs-commit", str(final_message),
        "--prior-docs-review", str(review),
        "--resolution-notes", str(resolution),
        "--output", str(output),
    ]) == 1
    assert "STOP AT PRIVATE STAGED CHECK BEFORE OUTPUT" in capsys.readouterr().err
    assert not output.exists()

    assert BUNDLE.main([
        *paths_argv(paths),
        "run",
        "--cycle", "finalization-release-hygiene-exception",
        "--round", "9",
        "--final-docs-commit", str(final_message),
        "--output", str(tmp_path / "qa-v9-finalization-round-9"),
    ]) == 1
    assert "must be exactly 8" in capsys.readouterr().err


@requires_zsh
def test_functional_multi_route_selector_is_single_process_and_pipefail_safe() -> None:
    plan = (
        Path(__file__).parents[1]
        / BUNDLE.FINALIZATION_RELEASE_HYGIENE_PLAN
    ).read_text(encoding="utf-8")
    selector = "first(.routes|to_entries[]|select(.value[2]>1)|.key)"
    assert selector in plan
    assert "| head -1" not in plan
    proc = subprocess.run(
        [
            "zsh",
            "-c",
            "set -euo pipefail; "
            "multi_cik=$(jq -ner 'first({routes:{\"0001\":[0,1,2],"
            "\"0002\":[1,2,3]}}.routes|to_entries[]|select(.value[2]>1)|.key)'); "
            "test \"$multi_cik\" = 0001",
        ],
        check=False,
    )
    assert proc.returncode == 0


@requires_zsh
@pytest.mark.parametrize("case_id", sorted(EXPECTED_RELEASE_F1_IDS), ids=str)
def test_release_hygiene_f1_locked_matrix_case(
    case_id: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    EXECUTED_RELEASE_F1_IDS.add(case_id)
    parts = case_id.split("::")
    family = parts[0]

    if family == "byte":
        _, target, mutation = parts
        name, line_text = target.rsplit(":", 1)
        line_number = int(line_text)
        old_files = release_f1_byte_fixture(tmp_path)
        path = tmp_path / name
        lines = path.read_bytes().splitlines(keepends=True)
        if mutation == "missing-edit":
            lines[line_number - 1] = lines[line_number - 1][:-1] + b"  \n"
        elif mutation == "tab-suffix":
            lines[line_number - 1] = lines[line_number - 1][:-1] + b"\t\n"
        elif mutation == "lossy-body":
            lines[line_number - 1] = b"X" + lines[line_number - 1][1:]
        else:
            assert mutation == "extra-byte"
            lines[line_number - 1] = lines[line_number - 1][:-1] + b"X\n"
        path.write_bytes(b"".join(lines))
        with pytest.raises(RuntimeError, match="byte delta mismatch"):
            BUNDLE.validate_release_hygiene_bytes(tmp_path, old_files)
        return

    if family == "owner-v2":
        mutation = parts[1]
        path = tmp_path / "owner-decision.md"
        text = release_f1_owner_v2_text()
        schema = "owner-decision-v2"
        replacements = {
            "spaced-v1-date": ("**Date:** 2026-08-11", "**Date:** 2026-08-11  "),
            "v1-as-v2": ("**Date:** 2026-08-11", "**Date:** 2026-08-11  "),
            "wrong-date": ("2026-08-11", "2026-08-10"),
            "empty-authorization": (
                "**Owner authorization:** “Synthetic bounded authorization.”",
                "**Owner authorization:** “”",
            ),
            "foreign-plan": (
                "RUN-M2-11-QA-finalization-release-hygiene-F1-plan.md",
                "RUN-M2-11-foreign-plan.md",
            ),
        }
        if mutation in replacements:
            old, new = replacements[mutation]
            text = text.replace(old, new)
        elif mutation == "missing-date":
            text = text.replace("**Date:** 2026-08-11\n", "")
        elif mutation == "duplicate-date":
            text = text.replace(
                "**Date:** 2026-08-11\n",
                "**Date:** 2026-08-11\n**Date:** 2026-08-11\n",
            )
        elif mutation == "missing-plan":
            text = text.replace(
                "The controlling plan is\n"
                "`docs/build/RUN-M2-11-QA-finalization-release-hygiene-F1-plan.md`.\n",
                "",
            )
        elif mutation == "verdict-line":
            text += "VERDICT: APPROVED\n"
        elif mutation == "crlf":
            text = text.replace("\n", "\r\n")
        elif mutation == "missing-final-newline":
            text = text.rstrip("\n")
        else:
            assert mutation == "v2-as-v1"
            schema = "owner-decision-v1"
        path.write_bytes(text.encode())
        with pytest.raises(RuntimeError):
            BUNDLE.validate_failed_gate_artifact(make_paths(tmp_path), path, schema)
        return

    if family.startswith("round7"):
        if OWNER is None:
            pytest.skip("needs the host machine's real M2-11 evidence artifacts")
        real_review = OWNER.round7_docs_review
        docs_input = json.loads(OWNER.round7_docs_input.read_text())
        docs_manifest = OWNER.round7_docs_review_manifest
        base_result = {
            "review": real_review,
            "manifest": docs_manifest,
            "input_manifest": OWNER.round7_docs_input.resolve(),
            "input": docs_input,
            "round": 7,
            "attempt": 2,
            "adoption_record": {
                item["name"]: item for item in docs_input["inputs"]
            }["adoption-manifest"],
        }
        qa_result = {"adoption": json.loads(OWNER.round7_adoption.read_text())}
        monkeypatch.setattr(
            BUNDLE, "validate_sealed_docs_review", lambda *_args: copy.deepcopy(base_result)
        )
        monkeypatch.setattr(
            BUNDLE, "validate_sealed_qa_review", lambda *_args: copy.deepcopy(qa_result)
        )
        if family == "round7-pin":
            _, name, mutation = parts
            attrs = {
                "adoption": ("round7_adoption", "ROUND7_ADOPTION_SHA256"),
                "approved-tree": ("round7_approved_tree", "ROUND7_APPROVED_TREE_SHA256"),
                "docs-input": ("round7_docs_input", "ROUND7_DOCS_INPUT_SHA256"),
                "docs-review": ("round7_docs_review", "ROUND7_DOCS_REVIEW_SHA256"),
                "docs-review-manifest": ("round7_docs_review_manifest", "ROUND7_DOCS_REVIEW_MANIFEST_SHA256"),
                "qa-review": ("round7_qa_review", "ROUND7_QA_REVIEW_SHA256"),
                "qa-review-manifest": ("round7_qa_review_manifest", "ROUND7_QA_REVIEW_MANIFEST_SHA256"),
                "token-file": ("round7_token_file", "ROUND7_TOKEN_FILE_SHA256"),
            }
            path_attr, digest_attr = attrs[name]
            if mutation == "digest":
                monkeypatch.setattr(BUNDLE, digest_attr, "f" * 64)
            else:
                source = getattr(OWNER, path_attr)
                mutated = copy_for_path_mutation(source, tmp_path, name)
                monkeypatch.setattr(
                    BUNDLE.QaBundlePaths,
                    path_attr,
                    property(lambda _self, _mutated=mutated: _mutated),
                )
        elif family == "round7-final-message":
            mutation = parts[1]
            if mutation == "digest":
                monkeypatch.setattr(BUNDLE, "ROUND7_FINAL_MESSAGE_SHA256", "f" * 64)
            else:
                mutated = copy_for_path_mutation(
                    OWNER.round7_final_message, tmp_path, "final-message"
                )
                monkeypatch.setattr(
                    BUNDLE.QaBundlePaths,
                    "round7_final_message",
                    property(lambda _self, _mutated=mutated: _mutated),
                )
        elif family == "round7-record":
            _, name, mutation = parts
            changed = copy.deepcopy(base_result)
            record = next(
                item for item in changed["input"]["inputs"] if item["name"] == name
            )
            if mutation == "digest":
                record["digest"] = "sha256:" + "f" * 64
            else:
                record["path"] = str(
                    copy_for_path_mutation(Path(record["path"]), tmp_path, name)
                )
            monkeypatch.setattr(
                BUNDLE, "validate_sealed_docs_review", lambda *_args: copy.deepcopy(changed)
            )
        else:
            assert family == "round7-identity"
            identity = parts[1]
            if identity in {"round", "attempt", "docs-fingerprint"}:
                changed = copy.deepcopy(base_result)
                if identity == "round":
                    changed["round"] = 6
                elif identity == "attempt":
                    changed["attempt"] = 1
                else:
                    changed["input"]["worktree_digest"] = "f" * 64
                monkeypatch.setattr(
                    BUNDLE,
                    "validate_sealed_docs_review",
                    lambda *_args: copy.deepcopy(changed),
                )
            elif identity == "qa-fingerprint":
                changed_qa = copy.deepcopy(qa_result)
                changed_qa["adoption"]["worktree_digest"] = "f" * 64
                monkeypatch.setattr(
                    BUNDLE,
                    "validate_sealed_qa_review",
                    lambda *_args: copy.deepcopy(changed_qa),
                )
            elif identity == "verdict":
                patch_path_read_text(
                    monkeypatch,
                    real_review,
                    real_review.read_text().replace(
                        "VERDICT: APPROVED", "VERDICT: CHANGES_REQUESTED"
                    ),
                )
            else:
                original_load = BUNDLE.load_canonical_file

                def load(path: Path) -> Any:
                    value = copy.deepcopy(original_load(path))
                    if path.resolve() == OWNER.round7_approved_tree.resolve():
                        if identity == "tree-oid":
                            value["tree_oid"] = "f" * 40
                        elif identity == "path-count":
                            value["expected_paths"] = value["expected_paths"][:-1]
                    if path.resolve() == OWNER.round7_token_file.resolve() and identity == "token":
                        value["token"] = "sha256:" + "f" * 64
                    return value

                monkeypatch.setattr(BUNDLE, "load_canonical_file", load)
        with pytest.raises(RuntimeError):
            BUNDLE.validate_release_hygiene_predecessor(OWNER, real_review)
        return

    if family.startswith("round8"):
        if OWNER is None:
            pytest.skip("needs the host machine's real M2-11 evidence artifacts")
        real_review = OWNER.round8_review
        monkeypatch.setattr(BUNDLE, "validate_bundle", lambda *_args, **_kwargs: None)
        monkeypatch.setattr(
            BUNDLE,
            "validate_sealed_qa_review",
            lambda *_args: {
                "review": real_review,
                "manifest": OWNER.round8_review_manifest,
            },
        )
        if family == "round8-pin":
            _, name, mutation = parts
            attrs = {
                "adoption": ("round8_adoption", "ROUND8_ADOPTION_SHA256"),
                "approved-tree": ("round8_approved_tree", "ROUND8_APPROVED_TREE_SHA256"),
                "candidate-state": ("round8_candidate_state", "ROUND8_CANDIDATE_STATE_SHA256"),
                "qa-review": ("round8_review", "ROUND8_REVIEW_SHA256"),
                "qa-review-manifest": ("round8_review_manifest", "ROUND8_REVIEW_MANIFEST_SHA256"),
                "token-file": ("round8_token_file", "ROUND8_TOKEN_FILE_SHA256"),
            }
            path_attr, digest_attr = attrs[name]
            if mutation == "digest":
                monkeypatch.setattr(BUNDLE, digest_attr, "f" * 64)
            else:
                source = getattr(OWNER, path_attr)
                mutated = copy_for_path_mutation(source, tmp_path, name)
                monkeypatch.setattr(
                    BUNDLE.QaBundlePaths,
                    path_attr,
                    property(lambda _self, _mutated=mutated: _mutated),
                )
        elif family == "round8-value":
            identity = parts[1]
            original_load = BUNDLE.load_canonical_file

            def load(path: Path) -> Any:
                value = copy.deepcopy(original_load(path))
                if identity in {"fingerprint", "round"} and path.resolve() == OWNER.round8_adoption.resolve():
                    value["worktree_digest" if identity == "fingerprint" else "round"] = (
                        "f" * 64 if identity == "fingerprint" else 7
                    )
                if identity == "token" and path.resolve() == OWNER.round8_token_file.resolve():
                    value["token"] = "sha256:" + "f" * 64
                if path.resolve() == OWNER.round8_approved_tree.resolve():
                    if identity == "tree-oid":
                        value["tree_oid"] = "f" * 40
                    elif identity == "path-count":
                        value["expected_paths"] = value["expected_paths"][:-1]
                return value

            monkeypatch.setattr(BUNDLE, "load_canonical_file", load)
        elif family == "round8-review":
            mutation = parts[1]
            if mutation == "verdict":
                patch_path_read_text(
                    monkeypatch,
                    real_review,
                    real_review.read_text().replace(
                        "VERDICT: CHANGES_REQUESTED", "VERDICT: APPROVED"
                    ),
                )
            elif mutation == "missing-f1":
                monkeypatch.setattr(BUNDLE, "open_blocker_ids", lambda _path: ())
            else:
                monkeypatch.setattr(BUNDLE, "open_blocker_ids", lambda _path: ("F1", "F2"))
        elif family == "round8-manifest":
            mutation = parts[1]
            original_load = BUNDLE.load_canonical_file

            def load(path: Path) -> Any:
                value = copy.deepcopy(original_load(path))
                if path.resolve() == OWNER.round8_review_manifest.resolve():
                    value["output"][mutation] = (
                        "sha256:" + "f" * 64
                        if mutation == "digest"
                        else str((tmp_path / "foreign-review.md").resolve())
                    )
                return value

            monkeypatch.setattr(BUNDLE, "load_canonical_file", load)
        else:
            assert family == "round8-authority"
            mutation = parts[1]
            original_load = BUNDLE.load_canonical_file

            def load(path: Path) -> Any:
                value = copy.deepcopy(original_load(path))
                if path.resolve() == OWNER.round8_adoption.resolve():
                    name = "plan.md" if mutation == "plan-digest" else "owner-decision.md"
                    next(item for item in value["artifacts"] if item["name"] == name)[
                        "digest"
                    ] = "sha256:" + "f" * 64
                return value

            monkeypatch.setattr(BUNDLE, "load_canonical_file", load)
        with pytest.raises(RuntimeError):
            BUNDLE.validate_release_hygiene_f1_predecessor(OWNER, real_review)
        return

    if family == "docs-a3":
        mutation = parts[1]
        fixture = release_f1_docs_fixture(tmp_path, monkeypatch, presealed=False)
        if mutation == "generic-cycle-bypass":
            adoption_path = fixture["bundle"] / "adoption-manifest.json"
            adoption = json.loads(adoption_path.read_text())
            next(item for item in adoption["artifacts"] if item["name"] == "plan.md")[
                "digest"
            ] = "sha256:" + BUNDLE.PINNED_DIGESTS[BUNDLE.FINALIZATION_PLAN]
            adoption_path.write_bytes(BUNDLE.canonical_json_bytes(adoption))
        if mutation != "unsealed-qa":
            assert BUNDLE.main([
                *paths_argv(fixture["paths"]),
                "seal-review",
                "--bundle", str(fixture["bundle"]),
                "--review", str(fixture["review_source"]),
            ]) == 0
        overrides: dict[str, Any] = {
            "attempt": 3,
            "prior_docs_review": fixture["prior_docs_review"],
            "resolution_notes": fixture["resolution_notes"],
        }
        if mutation == "attempt-4":
            overrides["attempt"] = 4
        elif mutation == "foreign-approved-predecessor":
            monkeypatch.setattr(
                BUNDLE,
                "validate_release_hygiene_predecessor",
                lambda _paths, value: {
                    "review": value.resolve(),
                    "manifest": fixture["prior_docs_manifest"].resolve(),
                    "round": 6,
                    "attempt": 2,
                    "adoption_record": {"different": "candidate"},
                    "input": {"base_ref": BUNDLE.EXPECTED_BASE},
                },
            )
        elif mutation == "wrong-prior-docs-path":
            foreign = tmp_path / "foreign" / "docs-review.attempt-2.md"
            foreign.parent.mkdir()
            foreign.write_text("VERDICT: APPROVED\n", encoding="utf-8")
            overrides["prior_docs_review"] = foreign
        elif mutation == "wrong-resolution":
            monkeypatch.setattr(
                BUNDLE,
                "validate_release_hygiene_resolution",
                lambda _paths, _value: (_ for _ in ()).throw(RuntimeError("wrong resolution")),
            )
        elif mutation == "wrong-round":
            wrong = tmp_path / "final-docs-commit.finalization-r8-a3.md"
            wrong.write_bytes(fixture["final_commit"].read_bytes())
            overrides["final_commit"] = wrong
        elif mutation == "occupied-output":
            fixture["output"].mkdir()
            sentinel = fixture["output"] / "sentinel"
            sentinel.write_text("occupied\n", encoding="utf-8")
        result = run_seal_docs(fixture, **overrides)
        assert result == 1
        if mutation == "occupied-output":
            assert (fixture["output"] / "sentinel").read_text() == "occupied\n"
        else:
            assert not fixture["output"].exists()
        return

    if family == "private-release":
        mutation = parts[1]
        if mutation == "fingerprint-drift":
            monkeypatch.setattr(BUNDLE, "external_worktree_fingerprint", lambda _paths, _repo: "drift")
            with pytest.raises(RuntimeError, match="candidate drift"):
                BUNDLE.validate_candidate_fingerprint(make_paths(tmp_path), tmp_path, "expected")
            return
        if mutation == "output-before-preflight":
            paths = make_paths(tmp_path, evidence_root=tmp_path)
            prior_dir = tmp_path / "qa-v9-finalization-round-8"
            prior_dir.mkdir()
            prior = prior_dir / "qa-review.round-8.md"
            prior.write_text("VERDICT: CHANGES_REQUESTED\n", encoding="utf-8")
            manifest = prior_dir / "qa-review.manifest.json"
            manifest.write_text("{}\n", encoding="utf-8")
            notes = tmp_path / "resolution-notes.finalization-r8-F1.md"
            notes.write_text("## F1: resolved\n", encoding="utf-8")
            message = tmp_path / "final-docs-commit.finalization-r9-a3.md"
            message.write_text(
                "First.\n\nSecond.\n\nCOMMIT_MESSAGE: feat(inst): publish bounded institutional data\n",
                encoding="utf-8",
            )
            monkeypatch.setattr(BUNDLE, "validate_content", lambda *_args, **_kwargs: None)
            monkeypatch.setattr(BUNDLE, "validate_failed_gate_artifact", lambda *_args, **_kwargs: None)
            monkeypatch.setattr(BUNDLE, "next_finalization_docs_attempt", lambda _paths: 3)
            monkeypatch.setattr(
                BUNDLE,
                "validate_release_hygiene_f1_predecessor",
                lambda _paths, value: {
                    "review": value.resolve(),
                    "manifest": manifest.resolve(),
                    "round": 8,
                    "phase": "qa",
                },
            )
            monkeypatch.setattr(
                BUNDLE, "validate_release_hygiene_f1_resolution", lambda _paths, value: value.resolve()
            )
            monkeypatch.setattr(
                BUNDLE,
                "validate_fixed_state",
                lambda *_args, **_kwargs: {"repo": Path(__file__).parents[1]},
            )
            monkeypatch.setattr(
                BUNDLE,
                "compute_approved_tree",
                lambda *_args, **_kwargs: (_ for _ in ()).throw(
                    RuntimeError("preflight stopped")
                ),
            )
            output = tmp_path / "qa-v9-finalization-round-9"
            assert BUNDLE.main([
                *paths_argv(paths),
                "run",
                "--cycle", "finalization-release-hygiene-f1-exception",
                "--round", "9",
                "--final-docs-commit", str(message),
                "--prior-review", str(prior),
                "--resolution-notes", str(notes),
                "--output", str(output),
            ]) == 1
            assert not output.exists()
            return
        repo = tmp_path / "repo"
        repo.mkdir()
        git(repo, "init", "-q")
        git(repo, "config", "user.email", "qa@example.invalid")
        git(repo, "config", "user.name", "QA")
        write(repo / "base.md", "base\n")
        git(repo, "add", "base.md")
        git(repo, "commit", "-qm", "base")
        write(repo / "dirty.md", "trailing  \n" if mutation == "whitespace-refusal" else "clean\n")
        index = Path(git(repo, "rev-parse", "--git-path", "index").decode().strip())
        if not index.is_absolute():
            index = repo / index
        state = {
            "repo": repo,
            "round": 1,
            "head": git(repo, "rev-parse", "HEAD").decode().strip(),
            "paths": ["dirty.md"],
            "index_path": index,
        }
        if mutation == "real-index-mismatch":
            original_sha = BUNDLE.sha256_file
            calls = 0

            def sha(path: Path) -> str:
                nonlocal calls
                if path.resolve() == index.resolve():
                    calls += 1
                    if calls >= 2:
                        return "f" * 64
                return original_sha(path)

            monkeypatch.setattr(BUNDLE, "sha256_file", sha)
        with pytest.raises(RuntimeError):
            BUNDLE.compute_approved_tree(state)
        return

    assert family == "happy"
    name = parts[1]
    if name == "byte":
        old_files = release_f1_byte_fixture(tmp_path)
        assert tuple(
            (path, line)
            for path in sorted(BUNDLE.RELEASE_HYGIENE_LINE_EDITS, key=os.fsencode)
            for line in BUNDLE.RELEASE_HYGIENE_LINE_EDITS[path]
        ) == tuple(sorted(RELEASE_F1_BYTE_TARGETS, key=lambda item: (os.fsencode(item[0]), item[1])))
        BUNDLE.validate_release_hygiene_bytes(tmp_path, old_files)
    elif name == "owner-v1":
        path = tmp_path / "owner-v1.md"
        path.write_text(
            release_f1_owner_v2_text()
            .replace("**Date:** 2026-08-11", "**Date:** 2026-08-11  ")
            .replace("release-hygiene-F1-plan.md", "synthetic-plan.md"),
            encoding="utf-8",
        )
        BUNDLE.validate_failed_gate_artifact(make_paths(tmp_path), path, "owner-decision-v1")
    elif name == "owner-v2":
        BUNDLE.validate_failed_gate_artifact(
            make_paths(tmp_path),
            Path(__file__).parents[1] / BUNDLE.FINALIZATION_RELEASE_HYGIENE_F1_DECISION,
            "owner-decision-v2",
        )
    elif name == "round7-predecessor":
        if OWNER is None:
            pytest.skip("needs the host machine's real M2-11 evidence artifacts")
        assert BUNDLE.validate_release_hygiene_predecessor(OWNER, OWNER.round7_docs_review)[
            "round"
        ] == 7
    elif name == "round8-predecessor":
        if OWNER is None:
            pytest.skip("needs the host machine's real M2-11 evidence artifacts")
        assert BUNDLE.validate_release_hygiene_f1_predecessor(OWNER, OWNER.round8_review)[
            "round"
        ] == 8
    elif name == "docs-a3":
        fixture = release_f1_docs_fixture(tmp_path, monkeypatch, presealed=False)
        assert BUNDLE.main([
            *paths_argv(fixture["paths"]),
            "seal-review",
            "--bundle", str(fixture["bundle"]),
            "--review", str(fixture["review_source"]),
        ]) == 0
        assert run_seal_docs(
            fixture,
            attempt=3,
            prior_docs_review=fixture["prior_docs_review"],
            resolution_notes=fixture["resolution_notes"],
        ) == 0
        assert (fixture["output"] / "docs-review-input.manifest.json").is_file()
    elif name in {"private-compute", "private-write"}:
        repo = tmp_path / "repo"
        repo.mkdir()
        git(repo, "init", "-q")
        git(repo, "config", "user.email", "qa@example.invalid")
        git(repo, "config", "user.name", "QA")
        write(repo / "base.md", "base\n")
        git(repo, "add", "base.md")
        git(repo, "commit", "-qm", "base")
        write(repo / "clean.md", "clean\n")
        index = Path(git(repo, "rev-parse", "--git-path", "index").decode().strip())
        if not index.is_absolute():
            index = repo / index
        before = BUNDLE.sha256_file(index)
        record = BUNDLE.compute_approved_tree({
            "repo": repo,
            "round": 1,
            "head": git(repo, "rev-parse", "HEAD").decode().strip(),
            "paths": ["clean.md"],
            "index_path": index,
        })
        assert BUNDLE.sha256_file(index) == before
        if name == "private-write":
            output = tmp_path / "tree-output"
            output.mkdir()
            assert BUNDLE.write_approved_tree(record, output) == record["tree_oid"]
            assert json.loads((output / "approved-tree.json").read_text()) == record
    else:
        assert name == "rollout-fences"
        plan = (
            Path(__file__).parents[1]
            / BUNDLE.FINALIZATION_RELEASE_HYGIENE_F1_PLAN
        ).read_text()
        restore = extract_plan_fence(plan, "If any pre-commit command fails after staging")
        disarm = extract_plan_fence(plan, "On deployment mutation/verification failure")
        repo = tmp_path / "rollout-repo"
        repo.mkdir()
        git(repo, "init", "-q")
        git(repo, "config", "user.email", "qa@example.invalid")
        git(repo, "config", "user.name", "QA")
        write(repo / "base", "base\n")
        git(repo, "add", "base")
        git(repo, "commit", "-qm", "base")
        names = [f"path-{index:02d}.md" for index in range(74)]
        for item in names:
            write(repo / item, "candidate\n")
        git(repo, "add", *names)
        evidence = tmp_path / "evidence"
        docs = evidence / "docs-v9-finalization-r9-a3"
        docs.mkdir(parents=True)
        tree = docs / "approved-tree.json"
        tree.write_bytes(BUNDLE.canonical_json_bytes({"expected_paths": names}))
        manifest = docs / "docs-review-input.manifest.json"
        manifest.write_bytes(BUNDLE.canonical_json_bytes({
            "inputs": [{"name": "final-docs-tree", "path": str(tree.resolve())}]
        }))
        stub_bin = tmp_path / "bin"
        stub_bin.mkdir()
        python_stub = repo / ".venv" / "bin" / "python"
        python_stub.parent.mkdir(parents=True)
        python_stub.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        python_stub.chmod(0o755)
        (repo / "scripts").mkdir()
        (repo / "scripts" / "build_m2_11_qa_bundle.py").write_text("# stub\n")
        restore = re.sub(r"(?m)^root=.*$", f"root={evidence}", restore, count=1)
        env = {
            "PATH": f"{stub_bin}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
            "HOME": str(tmp_path),
        }
        proc = subprocess.run(["zsh", "-c", restore], cwd=repo, env=env, check=False)
        assert proc.returncode == 0
        assert git(repo, "diff", "--cached", "--name-only") == b""
        broken = re.sub(r"(?m)^root=.*\n", "", restore, count=1)
        assert subprocess.run(["zsh", "-c", broken], cwd=repo, env=env, check=False).returncode != 0
        gh_log = tmp_path / "gh.log"
        gh = stub_bin / "gh"
        gh.write_text(
            "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$GH_LOG\"\n"
            "case \"$*\" in *'variable list'*) exit 0;; esac\nexit 0\n",
            encoding="utf-8",
        )
        gh.chmod(0o755)
        deploy_env = {**env, "GH_LOG": str(gh_log)}
        assert subprocess.run(["zsh", "-c", disarm], cwd=repo, env=deploy_env, check=False).returncode == 0
        calls = gh_log.read_text()
        assert "variable delete POPULUS_SELFHOSTED_VALIDATED" in calls
        assert "variable delete POPULUS_INST_DB" in calls
        assert "variable list" in calls
        broken = re.sub(r"(?m)^release_repo=.*\n", "", disarm, count=1)
        assert subprocess.run(["zsh", "-c", broken], cwd=repo, env=deploy_env, check=False).returncode != 0


@requires_zsh  # the matrix it audits carries the same marker: no zsh, no runs to count
def test_release_hygiene_f1_all_locked_ids_executed() -> None:
    assert len(EXPECTED_RELEASE_F1_REFUSAL_IDS) == 136
    assert len(EXPECTED_RELEASE_F1_HAPPY_IDS) == 9
    assert EXPECTED_RELEASE_F1_REFUSAL_IDS.isdisjoint(EXPECTED_RELEASE_F1_HAPPY_IDS)
    assert len(EXPECTED_RELEASE_F1_IDS) == 145
    assert EXECUTED_RELEASE_F1_IDS == EXPECTED_RELEASE_F1_IDS


def test_release_hygiene_f1_round_nine_transition_and_round_ten_refusal(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    paths = make_paths(tmp_path, evidence_root=tmp_path)
    prior_dir = tmp_path / "qa-v9-finalization-round-8"
    prior_dir.mkdir()
    prior = prior_dir / "qa-review.round-8.md"
    prior.write_text("VERDICT: CHANGES_REQUESTED\n", encoding="utf-8")
    manifest = prior_dir / "qa-review.manifest.json"
    manifest.write_text("{}\n", encoding="utf-8")
    notes = tmp_path / "resolution-notes.finalization-r8-F1.md"
    notes.write_text("## F1: resolved\n", encoding="utf-8")
    message = tmp_path / "final-docs-commit.finalization-r9-a3.md"
    message.write_text(
        "First.\n\nSecond.\n\nCOMMIT_MESSAGE: feat(inst): publish bounded institutional data\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(BUNDLE, "validate_content", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(BUNDLE, "validate_failed_gate_artifact", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(BUNDLE, "next_finalization_docs_attempt", lambda _paths: 3)
    monkeypatch.setattr(
        BUNDLE,
        "validate_release_hygiene_f1_predecessor",
        lambda _paths, value: {
            "review": value.resolve(),
            "manifest": manifest.resolve(),
            "round": 8,
            "phase": "qa",
        },
    )
    monkeypatch.setattr(
        BUNDLE, "validate_release_hygiene_f1_resolution", lambda _paths, value: value.resolve()
    )
    monkeypatch.setattr(
        BUNDLE,
        "validate_fixed_state",
        lambda *_args, **_kwargs: {"repo": Path(__file__).parents[1]},
    )
    monkeypatch.setattr(
        BUNDLE,
        "compute_approved_tree",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("ROUND9 PREOUTPUT")),
    )
    output = tmp_path / "qa-v9-finalization-round-9"
    assert BUNDLE.main([
        *paths_argv(paths),
        "run", "--cycle", "finalization-release-hygiene-f1-exception",
        "--round", "9", "--final-docs-commit", str(message),
        "--prior-review", str(prior), "--resolution-notes", str(notes),
        "--output", str(output),
    ]) == 1
    assert "ROUND9 PREOUTPUT" in capsys.readouterr().err
    assert not output.exists()
    assert BUNDLE.main([
        *paths_argv(paths),
        "run", "--cycle", "finalization-release-hygiene-f1-exception",
        "--round", "10", "--final-docs-commit", str(message),
        "--prior-review", str(prior), "--resolution-notes", str(notes),
        "--output", str(tmp_path / "qa-v9-finalization-round-10"),
    ]) == 1
    assert "must be exactly 9" in capsys.readouterr().err


def test_closeout_authority_inventory_and_exact_round_nine_predecessor() -> None:
    repo = Path(__file__).parents[1]
    assert BUNDLE.sha256_file(repo / BUNDLE.FINALIZATION_CLOSEOUT_PLAN) == (
        "27d2e5c67267b2c1cf9081141c61d707fa726c15f1ee98c368427860c61d3b26"
    )
    assert BUNDLE.sha256_file(repo / BUNDLE.FINALIZATION_CLOSEOUT_DECISION) == (
        "13c7d290e9d11db9cb405e2d8fefb15e774a862ea9f466ff56b4d951eb04f83b"
    )
    assert BUNDLE.FINALIZATION_CLOSEOUT_EXCEPTION_SCOPE == tuple(sorted((
        "approval-only-round10-qa-docs-release",
        "exact-failed-round9-gate2-predecessor",
        "frozen-product-and-t0",
        "no-docs-attempt4",
        "owner-authorized-consolidated-round10",
        "same-15-gates",
        "single-round10",
        "stale-devnotes-command-assertion-only",
    ), key=os.fsencode))
    assert len(BUNDLE.ROUND9_EXPECTED_PATHS) == 74
    assert set(BUNDLE.EXPECTED_QA_PATHS) - set(BUNDLE.ROUND9_EXPECTED_PATHS) == {
        str(BUNDLE.FINALIZATION_CLOSEOUT_PLAN),
        str(BUNDLE.FINALIZATION_CLOSEOUT_DECISION),
    }
    if OWNER is None:
        pytest.skip("predecessor half needs the host machine's real M2-11 evidence")
    predecessor = BUNDLE.validate_failed_gate_bundle(OWNER, OWNER.round9_bundle, 9)
    assert predecessor["round"] == 9
    assert len(predecessor["ledger"]["entries"]) == 2
    assert predecessor["ledger"]["entries"][0]["status"] == "pass"
    assert predecessor["ledger"]["entries"][1]["status"] == "fail"


def test_closeout_resolution_is_exact_and_mutation_refuses(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = make_paths(tmp_path, evidence_root=tmp_path)
    path = tmp_path / "resolution-notes.finalization-r9-gate2.md"
    path.write_text(BUNDLE.FINALIZATION_CLOSEOUT_RESOLUTION_TEXT, encoding="utf-8")
    assert BUNDLE.validate_finalization_closeout_resolution(paths, path) == path.resolve()
    path.write_text(
        BUNDLE.FINALIZATION_CLOSEOUT_RESOLUTION_TEXT.replace("round 10", "round 11"),
        encoding="utf-8",
    )
    with pytest.raises(RuntimeError, match="path/content mismatch"):
        BUNDLE.validate_finalization_closeout_resolution(paths, path)


def test_closeout_round_ten_is_single_and_round_eleven_refuses_preoutput(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    paths = make_paths(tmp_path, evidence_root=tmp_path)
    message = tmp_path / "final-docs-commit.finalization-r10-a3.md"
    message.write_text(
        "First rationale.\n\nSecond rationale.\n\n"
        "COMMIT_MESSAGE: feat(inst): publish bounded institutional data\n",
        encoding="utf-8",
    )
    resolution = tmp_path / "resolution-notes.finalization-r9-gate2.md"
    resolution.write_text(BUNDLE.FINALIZATION_CLOSEOUT_RESOLUTION_TEXT, encoding="utf-8")
    prior = tmp_path / "qa-v9-finalization-round-9"
    prior.mkdir()
    monkeypatch.setattr(BUNDLE, "validate_content", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        BUNDLE, "validate_failed_gate_artifact", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(BUNDLE, "next_finalization_docs_attempt", lambda _paths: 3)
    monkeypatch.setattr(
        BUNDLE,
        "validate_failed_gate_bundle",
        lambda _paths, value, round_no: {
            "bundle": value.resolve(),
            "round": round_no,
            "entries": [{"status": "pass"}, {"status": "fail"}],
            "artifacts": [],
        },
    )
    monkeypatch.setattr(
        BUNDLE, "validate_finalization_closeout_resolution", lambda _paths, value: value.resolve()
    )
    monkeypatch.setattr(BUNDLE, "validate_gate_resolution_notes", lambda *_args: None)
    monkeypatch.setattr(
        BUNDLE,
        "validate_fixed_state",
        lambda *_args, **_kwargs: {"repo": Path(__file__).parents[1]},
    )
    monkeypatch.setattr(
        BUNDLE,
        "compute_approved_tree",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("ROUND10 PREOUTPUT")
        ),
    )
    output = tmp_path / "qa-v9-finalization-round-10"
    assert BUNDLE.main([
        *paths_argv(paths),
        "run", "--cycle", "finalization-closeout-exception",
        "--round", "10", "--final-docs-commit", str(message),
        "--prior-gate-bundle", str(prior), "--resolution-notes", str(resolution),
        "--output", str(output),
    ]) == 1
    assert "ROUND10 PREOUTPUT" in capsys.readouterr().err
    assert not output.exists()
    assert BUNDLE.main([
        *paths_argv(paths),
        "run", "--cycle", "finalization-closeout-exception",
        "--round", "11", "--final-docs-commit", str(message),
        "--prior-gate-bundle", str(prior), "--resolution-notes", str(resolution),
        "--output", str(tmp_path / "qa-v9-finalization-round-11"),
    ]) == 1
    assert "must be exactly 10" in capsys.readouterr().err


def _closeout_deploy_scripts() -> tuple[str, str]:
    plan = (
        Path(__file__).parents[1] / BUNDLE.FINALIZATION_CLOSEOUT_PLAN
    ).read_text(encoding="utf-8")
    dispatch = extract_plan_fence(
        plan, "Dispatch is bound to merged main and watched by exact run ID"
    )
    verifier = extract_plan_fence(
        plan, "The exact functional verifier runs before schedule arming"
    ).split("verify_root=$(mktemp -d)", 1)[0]
    return dispatch, verifier


def _write_closeout_deploy_stubs(stub_bin: Path) -> None:
    git_stub = stub_bin / "git"
    git_stub.write_text(
        "#!/bin/sh\n"
        "case \"$*\" in\n"
        "  'fetch origin main') exit 0;;\n"
        "  'rev-parse origin/main') printf '%s\\n' \"$MERGE_SHA\"; exit 0;;\n"
        "esac\n"
        "exit 2\n",
        encoding="utf-8",
    )
    git_stub.chmod(0o755)
    gh_stub = stub_bin / "gh"
    gh_stub.write_text(
        "#!/bin/sh\n"
        "printf '%s\\n' \"$*\" >> \"$GH_LOG\"\n"
        "case \"$*\" in\n"
        "  'variable set POPULUS_INST_DB'*) exit 0;;\n"
        "  'variable get POPULUS_INST_DB'*) printf '%s\\n' \"$SNAPSHOT_VALUE\"; exit 0;;\n"
        "  'workflow run publish.yml'*) exit 0;;\n"
        "  'run list'*) printf '%s\\n' \"$RUN_ID\"; exit 0;;\n"
        "  'run watch'*) if test -n \"${COLLISION_TARGET:-}\"; then printf '%s\\n' '{\"sentinel\":true}' > \"$COLLISION_TARGET\"; fi; exit 0;;\n"
        "  'run view 123'*)\n"
        "    case \"$*\" in\n"
        "      *'--exit-status --json status,conclusion,headSha,event,url,jobs'*) printf '%s\\n' '{\"status\":\"completed\",\"conclusion\":\"success\",\"headSha\":\"'\"$MERGE_SHA\"'\",\"event\":\"workflow_dispatch\",\"url\":\"'\"$RUN_URL\"'\",\"jobs\":[{\"conclusion\":\"success\"}]}' ; exit 0;;\n"
        "      *'--json url --jq .url'*) printf '%s\\n' \"$RUN_URL\"; exit 0;;\n"
        "      *'--json headSha --jq .headSha'*) printf '%s\\n' \"$MERGE_SHA\"; exit 0;;\n"
        "      *'--json event --jq .event'*) printf '%s\\n' workflow_dispatch; exit 0;;\n"
        "      *'--json workflowName --jq .workflowName'*) printf '%s\\n' data-publish; exit 0;;\n"
        "      *'--json status --jq .status'*) printf '%s\\n' completed; exit 0;;\n"
        "      *'--json conclusion --jq .conclusion'*) printf '%s\\n' \"${LIVE_CONCLUSION:-success}\"; exit 0;;\n"
        "    esac;;\n"
        "esac\n"
        "exit 2\n",
        encoding="utf-8",
    )
    gh_stub.chmod(0o755)


def _closeout_deploy_snapshot_value() -> str:
    """The exact snapshot path the closeout plan's dispatch fence pins."""
    dispatch, _ = _closeout_deploy_scripts()
    match = re.search(r"(?m)^snapshot=(.+)$", dispatch)
    assert match is not None
    return match.group(1)


def _closeout_deploy_env(
    tmp_path: Path,
    stub_bin: Path,
    *,
    collision_target: Path | None = None,
    live_conclusion: str = "success",
) -> dict[str, str]:
    env = {
        "PATH": f"{stub_bin}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        "HOME": str(tmp_path),
        "GH_LOG": str(tmp_path / "gh.log"),
        "MERGE_SHA": "a" * 40,
        "RUN_ID": "123",
        "RUN_URL": "https://github.com/johnbaekk-spec/populus/actions/runs/123",
        "SNAPSHOT_VALUE": _closeout_deploy_snapshot_value(),
        "LIVE_CONCLUSION": live_conclusion,
    }
    if collision_target is not None:
        env["COLLISION_TARGET"] = str(collision_target)
    return env


@requires_zsh
def test_closeout_deploy_record_preexisting_and_collision_refuse_without_mutation(
    tmp_path: Path,
) -> None:
    dispatch, _ = _closeout_deploy_scripts()
    dispatch = re.sub(r"(?m)^root=.*$", f"root={tmp_path}", dispatch, count=1)
    stub_bin = tmp_path / "bin"
    stub_bin.mkdir()
    _write_closeout_deploy_stubs(stub_bin)
    target = tmp_path / "deploy-run.finalization-r10.json"
    target.write_text('{"preexisting":true}\n', encoding="utf-8")
    env = _closeout_deploy_env(tmp_path, stub_bin)
    proc = subprocess.run(["zsh", "-c", dispatch], env=env, check=False)
    assert proc.returncode != 0
    assert target.read_text(encoding="utf-8") == '{"preexisting":true}\n'
    assert not (tmp_path / "gh.log").exists()

    target.unlink()
    env = _closeout_deploy_env(
        tmp_path, stub_bin, collision_target=target
    )
    proc = subprocess.run(["zsh", "-c", dispatch], env=env, check=False)
    assert proc.returncode != 0
    assert json.loads(target.read_text(encoding="utf-8")) == {"sentinel": True}
    assert not list(tmp_path.glob(".deploy-run.finalization-r10.*"))


@requires_zsh
def test_closeout_deploy_record_partial_failure_and_exact_readback(
    tmp_path: Path,
) -> None:
    dispatch, verifier = _closeout_deploy_scripts()
    dispatch = re.sub(r"(?m)^root=.*$", f"root={tmp_path}", dispatch, count=1)
    verifier = re.sub(r"(?m)^root=.*$", f"root={tmp_path}", verifier, count=1)
    stub_bin = tmp_path / "bin"
    stub_bin.mkdir()
    _write_closeout_deploy_stubs(stub_bin)
    real_jq = shutil.which("jq")
    assert real_jq is not None
    jq_stub = stub_bin / "jq"
    jq_stub.write_text(
        "#!/bin/sh\n"
        "if test \"${FAIL_JQ_N:-0}\" = 1 && test \"${1:-}\" = -n; then exit 9; fi\n"
        f"exec {real_jq} \"$@\"\n",
        encoding="utf-8",
    )
    jq_stub.chmod(0o755)
    target = tmp_path / "deploy-run.finalization-r10.json"
    env = {**_closeout_deploy_env(tmp_path, stub_bin), "FAIL_JQ_N": "1"}
    assert subprocess.run(["zsh", "-c", dispatch], env=env, check=False).returncode != 0
    assert not target.exists()
    assert not list(tmp_path.glob(".deploy-run.finalization-r10.*"))

    env["FAIL_JQ_N"] = "0"
    assert subprocess.run(["zsh", "-c", dispatch], env=env, check=False).returncode == 0
    exact = {
        "conclusion": "success",
        "merge_sha": "a" * 40,
        "run_id": 123,
        "run_url": "https://github.com/johnbaekk-spec/populus/actions/runs/123",
        "status": "completed",
    }
    assert json.loads(target.read_text(encoding="utf-8")) == exact
    assert subprocess.run(["zsh", "-c", verifier], env=env, check=False).returncode == 0

    malformed = (
        {},
        {**exact, "extra": True},
        {**exact, "run_id": "123"},
        {**exact, "run_id": 124, "run_url": "https://github.com/johnbaekk-spec/populus/actions/runs/124"},
        {**exact, "run_url": "https://example.invalid/run/123"},
        {**exact, "merge_sha": "b" * 40},
        {**exact, "status": "pending"},
        {**exact, "conclusion": "failure"},
    )
    for value in malformed:
        target.write_text(json.dumps(value, sort_keys=True) + "\n", encoding="utf-8")
        assert subprocess.run(["zsh", "-c", verifier], env=env, check=False).returncode != 0
    target.write_text(json.dumps(exact, sort_keys=True) + "\n", encoding="utf-8")
    stale_env = {**env, "LIVE_CONCLUSION": "failure"}
    assert subprocess.run(["zsh", "-c", verifier], env=stale_env, check=False).returncode != 0
