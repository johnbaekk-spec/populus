#!/usr/bin/env python3
"""Build and validate the one-time RUN M2-11 QA adoption bundle.

This is deliberately release-specific.  It records the owner-authorized current
tree as an adopted QA origin; it never claims to reconstruct pre-build history.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


@dataclass(frozen=True)
class QaBundlePaths:
    """The four machine-specific roots, passed explicitly at command entry.

    Every machine-bound location the runner touches derives from these four
    absolute paths; nothing is read from the environment or hardcoded.
    """

    expected_root: Path
    orchestrate: Path
    evidence_root: Path
    snapshot: Path

    @property
    def workflow_artifacts(self) -> Path:
        return self.orchestrate.parent / "lib" / "workflow-artifacts.sh"

    @property
    def t0_log(self) -> Path:
        return self.evidence_root / "T0-v11.log"

    @property
    def prior_docs_review(self) -> Path:
        return self.evidence_root / "docs-v9-final" / "docs-review.round-1.canonical.md"

    @property
    def round7_bundle(self) -> Path:
        return self.evidence_root / "qa-v9-finalization-round-7"

    @property
    def round7_docs_bundle(self) -> Path:
        return self.evidence_root / "docs-v9-finalization-r7-a2"

    @property
    def round7_docs_review(self) -> Path:
        return self.round7_docs_bundle / "docs-review.attempt-2.md"

    @property
    def round7_docs_input(self) -> Path:
        return self.round7_docs_bundle / "docs-review-input.manifest.json"

    @property
    def round7_docs_review_manifest(self) -> Path:
        return self.round7_docs_bundle / "docs-review.manifest.json"

    @property
    def round7_adoption(self) -> Path:
        return self.round7_bundle / "adoption-manifest.json"

    @property
    def round7_token_file(self) -> Path:
        return self.round7_bundle / "combined-candidate-token.json"

    @property
    def round7_qa_review(self) -> Path:
        return self.round7_bundle / "qa-review.round-7.md"

    @property
    def round7_qa_review_manifest(self) -> Path:
        return self.round7_bundle / "qa-review.manifest.json"

    @property
    def round7_approved_tree(self) -> Path:
        return self.round7_docs_bundle / "approved-tree.json"

    @property
    def round7_final_message(self) -> Path:
        return self.evidence_root / "final-docs-commit.finalization-r7-a2.md"

    @property
    def round8_bundle(self) -> Path:
        return self.evidence_root / "qa-v9-finalization-round-8"

    @property
    def round8_review(self) -> Path:
        return self.round8_bundle / "qa-review.round-8.md"

    @property
    def round8_review_manifest(self) -> Path:
        return self.round8_bundle / "qa-review.manifest.json"

    @property
    def round8_adoption(self) -> Path:
        return self.round8_bundle / "adoption-manifest.json"

    @property
    def round8_token_file(self) -> Path:
        return self.round8_bundle / "combined-candidate-token.json"

    @property
    def round8_approved_tree(self) -> Path:
        return self.round8_bundle / "approved-tree.json"

    @property
    def round8_candidate_state(self) -> Path:
        return self.round8_bundle / "candidate-state.json"

    @property
    def round8_gate_ledger(self) -> Path:
        return self.round8_bundle / "gate-ledger.json"

    @property
    def round9_bundle(self) -> Path:
        return self.evidence_root / "qa-v9-finalization-round-9"

    @property
    def round9_ledger(self) -> Path:
        return self.round9_bundle / "gate-ledger.json"

    @property
    def round6_review(self) -> Path:
        return self.evidence_root / "qa-review.finalization-r6.canonical.md"

    @property
    def finalization_closeout_resolution(self) -> Path:
        return self.evidence_root / "resolution-notes.finalization-r9-gate2.md"

    @property
    def release_hygiene_f1_resolution(self) -> Path:
        return self.evidence_root / "resolution-notes.finalization-r8-F1.md"

    @property
    def release_hygiene_resolution(self) -> Path:
        return self.evidence_root / "resolution-notes.finalization-r7-release.md"

    def pinned_digests(self) -> dict[Path, str]:
        """The complete pinned-digest graph for this machine's roots."""
        return {
            self.orchestrate: ORCHESTRATE_SHA256,
            self.workflow_artifacts: WORKFLOW_ARTIFACTS_SHA256,
            **PINNED_DIGESTS,
            self.prior_docs_review: PRIOR_DOCS_REVIEW_SHA256,
            self.t0_log: T0_LOG_SHA256,
            self.snapshot: SNAPSHOT_SHA256,
        }


EXPECTED_BRANCH = "codex/m2-11-t0-finalize"
EXPECTED_HEAD = "7391d947f72cf408a173f1e7938102608b2269d4"
EXPECTED_BASE = "21340330a0fad7e9e39c1a9cec67656643621b05"
ORCHESTRATE_SHA256 = "22d85ebd01679bd44aa7a238e89bd15cc176bb5012b050c18a25e529f3ce2086"
WORKFLOW_ARTIFACTS_SHA256 = "afaa608b17b938abe8c2321d3405316a7ecf5e7d6fa2160cb5448f0d05856f97"
PRIOR_DOCS_REVIEW_SHA256 = "6827a2cacf1a53e582db143a9baa71438ecfab51526eff8f58fb08d40086e5ee"
T0_LOG_SHA256 = "7078a42934484c9c5ba7f975654476e0788c385dbaf8108c0d429a58ba91a453"
SNAPSHOT_SHA256 = "977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121"
TAIL_PLAN = Path("docs/build/RUN-M2-11-T0-tail-pagination-delta-plan.md")
RECOVERY_PLAN = Path("docs/build/RUN-M2-11-QA-origin-recovery-delta-plan.md")
OWNER_DECISION = Path("docs/build/RUN-M2-11-QA-origin-decision.md")
FINALIZATION_PLAN = Path("docs/build/RUN-M2-11-QA-finalization-delta-plan.md")
FINALIZATION_DECISION = Path("docs/build/RUN-M2-11-QA-finalization-decision.md")
FINALIZATION_EXCEPTION_PLAN = Path(
    "docs/build/RUN-M2-11-QA-finalization-exception-plan.md"
)
FINALIZATION_EXCEPTION_DECISION = Path(
    "docs/build/RUN-M2-11-QA-finalization-exception-decision.md"
)
FINALIZATION_REPAIR_PLAN = Path(
    "docs/build/RUN-M2-11-QA-finalization-repair-plan.md"
)
FINALIZATION_REPAIR_DECISION = Path(
    "docs/build/RUN-M2-11-QA-finalization-repair-decision.md"
)
FINALIZATION_F3_PLAN = Path(
    "docs/build/RUN-M2-11-QA-finalization-F3-plan.md"
)
FINALIZATION_F3_DECISION = Path(
    "docs/build/RUN-M2-11-QA-finalization-F3-decision.md"
)
FINALIZATION_F4_F5_PLAN = Path(
    "docs/build/RUN-M2-11-QA-finalization-F4-F5-plan.md"
)
FINALIZATION_F4_F5_DECISION = Path(
    "docs/build/RUN-M2-11-QA-finalization-F4-F5-decision.md"
)
FINALIZATION_RELEASE_HYGIENE_PLAN = Path(
    "docs/build/RUN-M2-11-QA-finalization-release-hygiene-plan.md"
)
FINALIZATION_RELEASE_HYGIENE_DECISION = Path(
    "docs/build/RUN-M2-11-QA-finalization-release-hygiene-decision.md"
)
FINALIZATION_RELEASE_HYGIENE_F1_PLAN = Path(
    "docs/build/RUN-M2-11-QA-finalization-release-hygiene-F1-plan.md"
)
FINALIZATION_RELEASE_HYGIENE_F1_DECISION = Path(
    "docs/build/RUN-M2-11-QA-finalization-release-hygiene-F1-decision.md"
)
FINALIZATION_CLOSEOUT_PLAN = Path(
    "docs/build/RUN-M2-11-QA-finalization-closeout-plan.md"
)
FINALIZATION_CLOSEOUT_DECISION = Path(
    "docs/build/RUN-M2-11-QA-finalization-closeout-decision.md"
)
DEV_NOTES = Path("docs/build/RUN-M2-11-devnotes.md")
FINDINGS = Path("docs/build/RUN-M2-11-T0-findings.md")

# Repository-relative pinned inputs only; the machine-rooted pins live on
# QaBundlePaths.pinned_digests().
PINNED_DIGESTS = {
    TAIL_PLAN: "068e7fc04edf61e0e3d25e40ff504b003faa0d0ab6d26fa65982a4899e119fad",
    RECOVERY_PLAN: "2df62fa4dd2a54bfac932238e0b8fcd16a6386d3b6c75dabe038eacf714297ba",
    OWNER_DECISION: "9392d3cfeec2badf8caf01f595f25342f7569e30f53396ab9c3fe73b7cee3a07",
    FINALIZATION_PLAN: "82509b7c41e890dab69920abe8b26daac0104fad0c657a5e22aca4864161f742",
    FINALIZATION_DECISION: "dcd5221c04789f7ad6bc79cd96c989227fa59dc9129d46b0697ec958116e1de7",
    FINALIZATION_EXCEPTION_PLAN: "71ca0c1f4eaadb165d49655de4dd838cbbb3ed9b681df815bd170d03f018faf3",
    FINALIZATION_EXCEPTION_DECISION: "8222a145ddba5a9101c4f851c4aa3f7eca1fe68e7eb9dffd116f51123b7747c0",
    FINALIZATION_REPAIR_PLAN: "5cdd1fef209331f779f3fb28fb718891c2371319d49ef7be2928382623a264e5",
    FINALIZATION_REPAIR_DECISION: "ba8c1653144d683e70c497ad1d7e899bf9c21cba9b3b870897f891fa0c5fe4f8",
    FINALIZATION_F3_PLAN: "105f5c4966d8d50d9f2737b779ff378b841198c74819c3597f71e9454ecd01d6",
    FINALIZATION_F3_DECISION: "148a522d1e4d153744469004c88fd109e4469a30826c344f0fa63ebdf26e72fa",
    FINALIZATION_F4_F5_PLAN: "44763fb1a35eb13fca4f580278863dc3f53c76959c38fead97221c0161bcd55b",
    FINALIZATION_F4_F5_DECISION: "d2a4a0f3b80f23f3851f28ce71f203078d29f83c639f72e05ca1eecb5c3f6b09",
    FINALIZATION_RELEASE_HYGIENE_PLAN: "338c81697acf31c26ecf76b797febdadc7e293e1f3dbef315cf27c7e450e3289",
    FINALIZATION_RELEASE_HYGIENE_DECISION: "59f4a3c9804e0af1dbc4dfede922a21e98d6394393e8dbed286f2cae754dba85",
    FINALIZATION_RELEASE_HYGIENE_F1_PLAN: "da6f13b9968468c4c49506bcff4ca70e75d87c17b2d39d71fa490373f7c52213",
    FINALIZATION_RELEASE_HYGIENE_F1_DECISION: "fa564bcafa0b1f9991ee9468fecd6ae57b982ad64e6ec2fee629c8587a246fe6",
    FINALIZATION_CLOSEOUT_PLAN: "27d2e5c67267b2c1cf9081141c61d707fa726c15f1ee98c368427860c61d3b26",
    FINALIZATION_CLOSEOUT_DECISION: "13c7d290e9d11db9cb405e2d8fefb15e774a862ea9f466ff56b4d951eb04f83b",
    FINDINGS: "cf1739a8571f312231e2a842bd0fbe7521e6b2f4a5f522c2089bbd78957579fd",
}

EXPECTED_QA_PATHS = tuple(sorted(
    """.github/workflows/publish.yml
ARCHITECTURE.md
Makefile
STATUS.md
dashboard/package.json
dashboard/src/lib/data.ts
dashboard/src/lib/filer-payload.ts
dashboard/src/lib/holdings.ts
dashboard/src/lib/shards.ts
dashboard/src/pages/institutional/data/filers/[shard].v1.json.ts
dashboard/src/pages/institutional/data/filers/[shard].v2.json.ts
dashboard/src/pages/institutional/data/filers/index.v1.json.ts
dashboard/src/pages/institutional/data/filers/index.v2.json.ts
dashboard/src/scripts/entity-client.ts
dashboard/test/filer-payload.test.ts
dashboard/test/post/entity-orchestration.test.ts
dashboard/test/post/file-budget.test.ts
dashboard/test/post/fixture-preview.test.ts
docs/build/RUN-M2-11-QA-finalization-F3-decision.md
docs/build/RUN-M2-11-QA-finalization-F3-plan.md
docs/build/RUN-M2-11-QA-finalization-F4-F5-decision.md
docs/build/RUN-M2-11-QA-finalization-F4-F5-plan.md
docs/build/RUN-M2-11-QA-finalization-closeout-decision.md
docs/build/RUN-M2-11-QA-finalization-closeout-plan.md
docs/build/RUN-M2-11-QA-finalization-release-hygiene-F1-decision.md
docs/build/RUN-M2-11-QA-finalization-release-hygiene-F1-plan.md
docs/build/RUN-M2-11-QA-finalization-release-hygiene-decision.md
docs/build/RUN-M2-11-QA-finalization-release-hygiene-plan.md
docs/build/RUN-M2-11-QA-origin-decision.md
docs/build/RUN-M2-11-QA-origin-recovery-delta-plan.md
docs/build/RUN-M2-11-QA-finalization-decision.md
docs/build/RUN-M2-11-QA-finalization-delta-plan.md
docs/build/RUN-M2-11-QA-finalization-exception-decision.md
docs/build/RUN-M2-11-QA-finalization-exception-plan.md
docs/build/RUN-M2-11-QA-finalization-repair-decision.md
docs/build/RUN-M2-11-QA-finalization-repair-plan.md
docs/build/RUN-M2-11-T0-affiliation-index-delta-plan.md
docs/build/RUN-M2-11-T0-aggregate-performance-delta-plan.md
docs/build/RUN-M2-11-T0-aggregate-throughput-delta-plan.md
docs/build/RUN-M2-11-T0-coverage-delta-plan.md
docs/build/RUN-M2-11-T0-coverage-totals-delta-plan.md
docs/build/RUN-M2-11-T0-findings.md
docs/build/RUN-M2-11-T0-materialization-reuse-delta-plan.md
docs/build/RUN-M2-11-T0-prepared-compact-aggregate-delta-plan.md
docs/build/RUN-M2-11-T0-serving-materialization-delta-plan.md
docs/build/RUN-M2-11-T0-serving-performance-delta-plan.md
docs/build/RUN-M2-11-T0-tail-pagination-delta-plan.md
docs/build/RUN-M2-11-devnotes.md
docs/build/RUN-M2-11-plan.md
docs/build/RUN-M2-11-qa-report.md
docs/runbooks/self-hosted-runner.md
scripts/acceptance/institutional_serving.py
scripts/acceptance/holdings_substrate.py
scripts/build_m2_11_qa_bundle.py
scripts/measure_inst_derive.py
src/populus/amendments.py
src/populus/ingest/inst13f.py
src/populus/inst_agg.py
src/populus/inst_agg.sql
src/populus/inst_budget.py
src/populus/inst_serving.py
src/populus/publish/build.py
src/populus/publish/digests.py
src/populus/publish/manifest.py
tests/fixtures/filer_payload_parity.v1.json
tests/test_cover_tolerance.py
tests/test_digests.py
tests/test_inst_agg.py
tests/test_inst_external_store.py
tests/test_inst_serving.py
tests/test_inst_shard_budget.py
tests/test_inst_snapshot_script.py
tests/test_m2_11_qa_bundle.py
tests/test_pointer_state.py
tests/test_publish.py
tests/test_workflow_governance.py""".splitlines(), key=os.fsencode
))

EXPECTED_RELEASE_PATHS = EXPECTED_QA_PATHS

GATES = (
    ("diff-check", "lint", "git diff --check", "complete candidate"),
    ("recovery-tests", "test", "PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q tests/test_m2_11_qa_bundle.py", "recovery transport"),
    ("inst-budget-snapshot", "test", "PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q tests/test_inst_shard_budget.py tests/test_inst_snapshot_script.py", "institutional budget and snapshot"),
    ("dashboard-payload-entity", "test", "(cd dashboard && node --test test/filer-payload.test.ts test/post/entity-orchestration.test.ts)", "dashboard payload and orchestration"),
    ("expanded-python", "test", "PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q tests/test_inst_agg.py tests/test_cover_tolerance.py tests/test_inst_external_store.py tests/test_inst_snapshot_script.py tests/test_inst_serving.py tests/test_inst_serving_artifact.py tests/test_inst_shard_budget.py tests/test_digests.py tests/test_publish.py tests/test_amendments.py tests/test_mcp_server_inst.py tests/test_inst_federated_boundary.py tests/test_pointer_state.py tests/test_workflow_governance.py", "expanded institutional and publication regressions"),
    ("previous-client", "test", "POPULUS_PREVIOUS_CLIENT_SHA=7391d947f72cf408a173f1e7938102608b2269d4 PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q tests/test_pointer_state.py -k inst_schema_1_1_previous_client", "released client compatibility"),
    ("fixture-preview", "test", "(cd dashboard && node --test --test-concurrency=1 test/post/fixture-preview.test.ts)", "dashboard fixture preview"),
    ("workflow-governance", "test", "PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q tests/test_workflow_governance.py", "workflow governance"),
    ("make-check", "typecheck", "make check", "complete repository tree"),
    ("make-security", "security", "make security", "changed security surfaces"),
    ("accept-m1-b", "test", "make accept-m1-b", "standing M1-B acceptance"),
    ("accept-m2-5", "test", "make accept-m2-5", "standing M2-5 acceptance"),
    ("accept-m2-6", "test", "make accept-m2-6", "standing M2-6 acceptance"),
    ("accept-m2-8", "test", "make accept-m2-8", "standing M2-8 acceptance"),
    ("accept-m2-11", "test", "make accept-m2-11", "M2-11 acceptance"),
)

RECOVERY_EXCEPTION_SCOPE = tuple(sorted((
    "current-tree-adoption-instead-of-historical-pre-build-origin",
    "same-run-provisional-docs-origin",
    "repo-local-custom-schema-validator",
), key=os.fsencode))

FINALIZATION_EXCEPTION_SCOPE = tuple(sorted((
    "current-tree-adoption-instead-of-historical-pre-build-origin",
    "owner-authorized-qa-docs-finalization-cycle",
    "repo-local-custom-schema-validator",
), key=os.fsencode))

FINALIZATION_RETRY_EXCEPTION_SCOPE = tuple(sorted((
    "current-tree-adoption-instead-of-historical-pre-build-origin",
    "owner-authorized-fourth-finalization-retry",
    "owner-authorized-qa-docs-finalization-cycle",
    "repo-local-custom-schema-validator",
), key=os.fsencode))

FINALIZATION_REPAIR_EXCEPTION_SCOPE = tuple(sorted((
    "current-tree-adoption-instead-of-historical-pre-build-origin",
    "owner-authorized-fifth-finalization-repair",
    "owner-authorized-fourth-finalization-retry",
    "owner-authorized-qa-docs-finalization-cycle",
    "repo-local-custom-schema-validator",
), key=os.fsencode))

FINALIZATION_F3_EXCEPTION_SCOPE = tuple(sorted((
    "current-tree-adoption-instead-of-historical-pre-build-origin",
    "owner-authorized-fifth-finalization-repair",
    "owner-authorized-fourth-finalization-retry",
    "owner-authorized-qa-docs-finalization-cycle",
    "owner-authorized-sixth-finalization-f3-repair",
    "repo-local-custom-schema-validator",
), key=os.fsencode))

FINALIZATION_F4_F5_EXCEPTION_SCOPE = tuple(sorted((
    "current-tree-adoption-instead-of-historical-pre-build-origin",
    "owner-authorized-fifth-finalization-repair",
    "owner-authorized-fourth-finalization-retry",
    "owner-authorized-qa-docs-finalization-cycle",
    "owner-authorized-seventh-finalization-f4-f5-repair",
    "owner-authorized-sixth-finalization-f3-repair",
    "repo-local-custom-schema-validator",
), key=os.fsencode))

FINALIZATION_RELEASE_HYGIENE_EXCEPTION_SCOPE = tuple(sorted((
    "current-tree-adoption-instead-of-historical-pre-build-origin",
    "owner-authorized-fifth-finalization-repair",
    "owner-authorized-fourth-finalization-retry",
    "owner-authorized-qa-docs-finalization-cycle",
    "owner-authorized-release-hygiene-eighth-finalization",
    "owner-authorized-seventh-finalization-f4-f5-repair",
    "owner-authorized-sixth-finalization-f3-repair",
    "repo-local-custom-schema-validator",
), key=os.fsencode))

FINALIZATION_RELEASE_HYGIENE_F1_EXCEPTION_SCOPE = tuple(sorted((
    "current-tree-adoption-instead-of-historical-pre-build-origin",
    "owner-authorized-fifth-finalization-repair",
    "owner-authorized-fourth-finalization-retry",
    "owner-authorized-ninth-finalization-release-hygiene-f1-verification",
    "owner-authorized-qa-docs-finalization-cycle",
    "owner-authorized-release-hygiene-eighth-finalization",
    "owner-authorized-seventh-finalization-f4-f5-repair",
    "owner-authorized-sixth-finalization-f3-repair",
    "repo-local-custom-schema-validator",
), key=os.fsencode))

FINALIZATION_CLOSEOUT_EXCEPTION_SCOPE = tuple(sorted((
    "approval-only-round10-qa-docs-release",
    "exact-failed-round9-gate2-predecessor",
    "frozen-product-and-t0",
    "no-docs-attempt4",
    "owner-authorized-consolidated-round10",
    "same-15-gates",
    "single-round10",
    "stale-devnotes-command-assertion-only",
), key=os.fsencode))

ROUND7_ADOPTION_SHA256 = "39f81b7f1fe9c192c10a97ae4082301663820c18d774ad66b364168dab99b537"
ROUND7_TOKEN_FILE_SHA256 = "52af42e7d3a0975204a8cb34be40f922b4ab23efed1a05e99168761be8e159b8"
ROUND7_TOKEN = "sha256:4254a0ef9a7093ee4168fdd210c9128e2c08193f8885ad461270e114bb4c2100"
ROUND7_QA_REVIEW_SHA256 = "5ede9cdb8b05b4577375e9029eaed8100e6b4b8070762e071b776eb6dcef6b91"
ROUND7_QA_REVIEW_MANIFEST_SHA256 = "6d5a7aab482a99c397435eb179174e4af35fb60c2930925a93d731e61817a458"
ROUND7_DOCS_INPUT_SHA256 = "bbf9dc93eab30a672f0148059982f82e7d4b5d2a87c86099ae092f81b6b33e65"
ROUND7_DOCS_REVIEW_SHA256 = "f227fd8b0c82bbea5d48ac0f3b149474efe7a564c326a4dd021cf24b45028566"
ROUND7_DOCS_REVIEW_MANIFEST_SHA256 = "d001e73c0d5eb145d02b874e180509e50b31823c4eba134f29847d0fb66882b2"
ROUND7_APPROVED_TREE_SHA256 = "35ee7dc7eecfa13129f677065a18c44739f3a7c8a3259a87d51aa580e2e391fe"
ROUND7_APPROVED_TREE_OID = "de5068f0da644bd543fc7433d14b1f46ba3f9d3f"
ROUND7_ARCHIVE_SHA256 = "b10b85d710dbbc6716b0b9dde0dc6425703816db7c2c841a1112be6985433273"
ROUND7_FINGERPRINT = "68235db92732e15d96acfae48691bee5d418d7cbd618f70552628bf14203883a"
ROUND7_FINAL_MESSAGE_SHA256 = "ea63c59cf09b2ebdec7c0392236e26ae778c49667591c46c504fd9be31b31ebf"

ROUND8_ADOPTION_SHA256 = "9e4ad77fe14da593094a4964703468280fc1b4a95231cb1a5789505198ea77c7"
ROUND8_TOKEN_FILE_SHA256 = "12e112e31e25a999055ff7498e9fc743df51438ee4f0e86547a7de6864e11796"
ROUND8_REVIEW_SHA256 = "622fd3c483958765001b2576946e6f112bd3f4c3a22ff17441dc1374ee54ebce"
ROUND8_REVIEW_MANIFEST_SHA256 = "d4da3465b133d361fae90afa6c02f3c2e96885b1f72a4d19147d6cd70f625dbf"
ROUND8_APPROVED_TREE_SHA256 = "ef363a46ca4ed0ea05e9494bad9f254ae8526f25f5fe11ae30708604e2b10744"
ROUND8_CANDIDATE_STATE_SHA256 = "9e0005db00df0d882af4ca5f52cb959cb5c21f8bd46d007542b0620c19ff0f40"
ROUND8_TOKEN = "sha256:55fa7f2c5e939060805992004ce9b157939af348fda11383ad246d695e2473a2"
ROUND8_FINGERPRINT = "327f0b589f75afd2fcf197d1835eaad22a23da4e1a60109e769a8d396ebceee5"
ROUND8_APPROVED_TREE_OID = "d697803185c8da0b97658a627fc634fd8d2e536c"

ROUND9_FINGERPRINT = "d1e54262f690a499f9e04b2babaf9ac4a374869b99b6b31e46f582f983f4faeb"
ROUND9_ARTIFACT_SHA256 = {
    "plan.md": "da6f13b9968468c4c49506bcff4ca70e75d87c17b2d39d71fa490373f7c52213",
    "owner-decision.md": "fa564bcafa0b1f9991ee9468fecd6ae57b982ad64e6ec2fee629c8587a246fe6",
    "dev-notes.md": "db6dd86ea4ef01fac0e9ed8f1f4eb0cf8629e76bc51a2d12ffc5663b4b6c3a7d",
    "changed-files.json": "b814ddfa69cfc75ad2582a3c8580390b1b3dc835e9a1cb052f9e328eb5695c65",
    "baseline-diff.redacted.patch": "ccfac4e25dcc65b7937b098debe429e22af7efdea86c60ad9a5f076091a4ac7c",
    "external-state.json": "03e4359e6637b88a5369db5d4bf3989bbc68ae502001735a91ae84a7357b56e7",
    "external-changes.json": "3e34bf81d09ce9012da38a01373ab707f8d878cd63589669e1182b255170e367",
    "external-diff.redacted.patch": "58a4dd00bcb1548d107a4144523db7847539da8a29cfa796620e36b62abc6e75",
    "source-preservation.json": "4c7d41642fca2f824e018da35b30bed61318be7e7e7bc2712257d4fbc0e9e524",
    "isolated-feature.json": "918656049e94e870e5e5f5623d862e97e7a39d9143a00d2c1ef408859c0cf965",
    "gate-diff-check.log": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "gate-recovery-tests.log": "ad269d27d885ef78a76d0acbaa12d89417a5747fd487838e34b33491cf9df924",
    "gate-ledger.json": "d8c6de8607ca3d0fb57f4e7e1896dd7528bf9265ce92b3b8c58beb20642db6e3",
}
ROUND9_FAILED_TEST = (
    "test_devnotes_publish_only_authoritative_release_hygiene_round_eight_command"
)

FINALIZATION_CLOSEOUT_RESOLUTION_TEXT = (
    "# RUN M2-11 — Consolidated Finalization Gate Resolution\n\n"
    "## gate-recovery-tests: resolved\n\n"
    "Logical round 9 passed `git diff --check` and stopped at the focused recovery "
    "gate because one stale assertion still required the historical round-8 Dev "
    "Notes command after authority had moved to round 9.\n\n"
    "The assertion now requires the factual historical round-9 command. The exact "
    "round-9 failed bundle is preserved, product and T0 bytes remain frozen, and "
    "the owner authorized one final consolidated round 10 with no round 11.\n"
)

RELEASE_HYGIENE_F1_RESOLUTION_TEXT = (
    "# RUN M2-11 — Release-Hygiene F1 Resolution\n\n"
    "## F1: resolved\n\n"
    "The sealed round-8 QA review found one verification-only gap: the approved "
    "release-hygiene plan required executable byte, owner-schema, predecessor, "
    "docs-attempt, private-index, and rollback refusal coverage that the focused "
    "suite did not implement.\n\n"
    "The F1-only repair adds an independent literal oracle with exactly 136 "
    "refusal IDs and 9 happy IDs (145 total), executes every ID hermetically, "
    "binds the exact sealed round-8 rejection, and changes no product or T0 byte.\n"
)

RELEASE_HYGIENE_RESOLUTION_TEXT = (
    "# RUN M2-11 — Release Gate Resolution\n\n"
    "## gate-release-diff-check: resolved\n\n"
    "The mandatory post-stage `git diff --cached --check` rejected the exact "
    "round-7 approved 70-path tree for 13 Markdown trailing-space errors.\n\n"
    "The real Git index was restored to its prior empty state and the round-7 "
    "candidate fingerprint was revalidated. The release-hygiene repair removes "
    "only the two trailing ASCII spaces from each of those 13 lines across the "
    "eight owner-authorized governance files; no product byte or T0 artifact is "
    "changed.\n"
)

RELEASE_HYGIENE_LINE_EDITS = {
    "docs/build/RUN-M2-11-QA-origin-decision.md": (3, 4),
    "docs/build/RUN-M2-11-QA-finalization-decision.md": (3,),
    "docs/build/RUN-M2-11-QA-finalization-exception-decision.md": (3,),
    "docs/build/RUN-M2-11-QA-finalization-repair-decision.md": (3,),
    "docs/build/RUN-M2-11-QA-finalization-repair-plan.md": (3, 6, 7),
    "docs/build/RUN-M2-11-QA-finalization-F3-decision.md": (3,),
    "docs/build/RUN-M2-11-QA-finalization-F3-plan.md": (4, 5, 7),
    "docs/build/RUN-M2-11-QA-finalization-F4-F5-decision.md": (3,),
}
RELEASE_HYGIENE_WRITE_PATHS = tuple(sorted((
    *RELEASE_HYGIENE_LINE_EDITS,
    str(FINALIZATION_RELEASE_HYGIENE_DECISION),
    str(FINALIZATION_RELEASE_HYGIENE_PLAN),
    str(DEV_NOTES),
    "docs/build/RUN-M2-11-qa-report.md",
    "scripts/build_m2_11_qa_bundle.py",
    "tests/test_m2_11_qa_bundle.py",
), key=os.fsencode))

RELEASE_HYGIENE_F1_WRITE_PATHS = tuple(sorted((
    str(FINALIZATION_RELEASE_HYGIENE_F1_DECISION),
    str(FINALIZATION_RELEASE_HYGIENE_F1_PLAN),
    str(DEV_NOTES),
    "docs/build/RUN-M2-11-qa-report.md",
    "scripts/build_m2_11_qa_bundle.py",
    "tests/test_m2_11_qa_bundle.py",
), key=os.fsencode))

FINALIZATION_CLOSEOUT_WRITE_PATHS = tuple(sorted((
    str(FINALIZATION_CLOSEOUT_DECISION),
    str(FINALIZATION_CLOSEOUT_PLAN),
    str(DEV_NOTES),
    "docs/build/RUN-M2-11-qa-report.md",
    "scripts/build_m2_11_qa_bundle.py",
    "tests/test_m2_11_qa_bundle.py",
), key=os.fsencode))
ROUND9_EXPECTED_PATHS = tuple(
    path
    for path in EXPECTED_QA_PATHS
    if path not in {
        str(FINALIZATION_CLOSEOUT_DECISION),
        str(FINALIZATION_CLOSEOUT_PLAN),
    }
)

ROUND3_FAILED_LEDGER_SHA256 = "355596d5e3c7b393bb2b167e8e2da906803b268a95860c875002c62e103d2c69"
ROUND3_FAILED_FINGERPRINT = "ebb810f846ec1aed0b7e645833759e2de93541828f2787e16b5af37beb057614"
ROUND3_RECOVERY_LOG_SHA256 = "16c798306bb4f172f8640d9392a06f7309c99c93062646689b784257df0e213a"
EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

LEGACY_FINALIZATION_R1_ADOPTION_SHA256 = "5ff5d604fcdb146d090f34a3fc6dd8e61820aad057d968a0aabf8fef3d42d881"
LEGACY_FINALIZATION_R1_TOKEN = "sha256:28acfdd8d09cdedc6fa955a8ecedb73a452697a49c9a297190c7cd46c2d52dff"

ROUND5_ADOPTION_SHA256 = "33f374a52ce64633f1e6c6d80f847bd4d9155ea38d62b5b699ae1a57114fea40"
ROUND5_TOKEN_FILE_SHA256 = "9ad09ec5b138d9173c36a67786a4ea727a49cef4c3ee3ea97b32eca69bf70008"
ROUND5_TOKEN = "sha256:574c6df63bb7c348a3fd38579d238781c0be9d465e40da0787f3375d52b77682"
ROUND5_DECISION_SHA256 = "ba8c1653144d683e70c497ad1d7e899bf9c21cba9b3b870897f891fa0c5fe4f8"
ROUND5_REVIEW_SHA256 = "12b381023e0757d8869f0fd2ac953e00e751a43a74998a1caf9a668733e1d23a"
ROUND5_REVIEW_MANIFEST_SHA256 = "fcd2013e91df5a95c9fd96568794d3f41d4e11bc18652f13bccdbd1287f67e0c"

ROUND6_ADOPTION_SHA256 = "2185a6052e46e2d585e981945f4e13dc16413fe52bf0d86648c16e3ccbec554f"
ROUND6_TOKEN_FILE_SHA256 = "30d26ca00b7c129a8cbf0329a24efa7757fd210217ce00a920dda15a324d382d"
ROUND6_TOKEN = "sha256:0a1a13d0e8a73f6981c03d4478b6e768b2dbf971809aa9572cbd3d95caf7b0b1"
ROUND6_DECISION_SHA256 = "148a522d1e4d153744469004c88fd109e4469a30826c344f0fa63ebdf26e72fa"
ROUND6_REVIEW_SHA256 = "05e24c59d9dd95bb3a7becf04c33f291d2286363f73b838cffb8cb20a2c34cd3"
ROUND6_FINGERPRINT = "1225aba74d91d4ab8f7854311233d1d577f26d868787d184ad76d0632a9781b8"

CUSTOM_PHASE_MANIFESTS = (
    "qa-gates.manifest.json",
    "qa-review-input.manifest.json",
    "qa-synthesis.manifest.json",
)

CURRENT_ARTIFACT_SCHEMAS = {
    "approved-tree.json": "approved-tree/v1",
    "baseline-diff.redacted.patch": "redacted-diff-v1",
    "candidate-state.json": "candidate-state/v1",
    "changed-files.json": "changed-files/v1",
    "combined-candidate-token.json": "combined-candidate-token/v1",
    "dev-notes.md": "dev-notes-v1",
    "docs-commit.manifest.json": "workflow-artifacts/v1",
    "docs-commit.md": "docs-commit-v1",
    "external-changes.json": "external-changes/v1",
    "external-diff.redacted.patch": "redacted-diff-v1",
    "external-state.json": "external-state/v1",
    "gate-ledger.json": "m2-11-gate-ledger/v1",
    "gate-results.json": "gate-results/v1",
    "isolated-feature.json": "isolated-feature-adoption/v1",
    "owner-decision.md": "owner-decision-v1",
    "plan.md": "plan-v1",
    "qa-gates.core.manifest.json": "workflow-artifacts/v1",
    "qa-gates.manifest.json": "m2-11-phase-manifest/v1",
    "qa-report.md": "qa-report-v1",
    "qa-review-input.manifest.json": "m2-11-phase-manifest/v1",
    "qa-synthesis.core.manifest.json": "workflow-artifacts/v1",
    "qa-synthesis.manifest.json": "m2-11-phase-manifest/v1",
    "source-preservation.json": "adopted-source-state/v1",
}

PHASE_BASE_INPUTS = {
    "approved-tree": ("approved-tree.json", "approved-tree/v1"),
    "baseline-diff": ("baseline-diff.redacted.patch", "redacted-diff-v1"),
    "candidate-state": ("candidate-state.json", "candidate-state/v1"),
    "changed-files": ("changed-files.json", "changed-files/v1"),
    "combined-candidate-token": ("combined-candidate-token.json", "combined-candidate-token/v1"),
    "dev-notes": ("dev-notes.md", "dev-notes-v1"),
    "docs-commit": ("docs-commit.md", "docs-commit-v1"),
    "external-changes": ("external-changes.json", "external-changes/v1"),
    "external-diff": ("external-diff.redacted.patch", "redacted-diff-v1"),
    "external-state": ("external-state.json", "external-state/v1"),
    "gate-ledger": ("gate-ledger.json", "m2-11-gate-ledger/v1"),
    "gate-results": ("gate-results.json", "gate-results/v1"),
    "isolated-feature": ("isolated-feature.json", "isolated-feature-adoption/v1"),
    "owner-exception": ("owner-decision.md", "owner-decision-v1"),
    "plan": ("plan.md", "plan-v1"),
    "qa-report": ("qa-report.md", "qa-report-v1"),
    "source-preservation": ("source-preservation.json", "adopted-source-state/v1"),
}


def current_artifact_schemas(plan_digest: str | None = None) -> dict[str, str]:
    """Return the exact cycle-local artifact schema map.

    Historical/current rounds 1-7 retain the intentionally strict v1 owner
    grammar. Only the digest-pinned release-hygiene rounds use the clean v2
    date-line grammar.
    """
    schemas = dict(CURRENT_ARTIFACT_SCHEMAS)
    if plan_digest in {
        "sha256:" + PINNED_DIGESTS[FINALIZATION_RELEASE_HYGIENE_PLAN],
        "sha256:" + PINNED_DIGESTS[FINALIZATION_RELEASE_HYGIENE_F1_PLAN],
        "sha256:" + PINNED_DIGESTS[FINALIZATION_CLOSEOUT_PLAN],
    }:
        schemas["owner-decision.md"] = "owner-decision-v2"
    return schemas


def phase_base_inputs(schemas: dict[str, str]) -> dict[str, tuple[str, str]]:
    inputs = dict(PHASE_BASE_INPUTS)
    inputs["owner-exception"] = (
        "owner-decision.md",
        schemas["owner-decision.md"],
    )
    return inputs

FALSE_CUSTOM_LABEL_DEFECTS = tuple(
    f"{name}: declared workflow-artifacts/v1, expected m2-11-phase-manifest/v1"
    for name in CUSTOM_PHASE_MANIFESTS
)
OWNER_HEADING_DEFECT = "owner-decision.md: owner-decision-v1 heading/metadata contract mismatch"
OWNER_CONTROLLING_DEFECT = "owner-decision.md: owner-decision-v1 controlling-plan contract mismatch"

HISTORICAL_POLICIES = {
    "qa-v9-round-1": {
        "adoption": "170ed11a15018ceadedb9046711e724848db6ed1cd355d34939b4d892eed5f2a",
        "token_file": "9f4a52445ba5fd69b90fabbc66cb9365acf644f05af932b480bd0b83d120ba77",
        "token": "sha256:98ce893843bc0579c02f8368fe343cfaceda4c6d3979ba5bca39f81763b3f57d",
        "decision": "9392d3cfeec2badf8caf01f595f25342f7569e30f53396ab9c3fe73b7cee3a07",
        "defects": tuple(sorted((*FALSE_CUSTOM_LABEL_DEFECTS, OWNER_HEADING_DEFECT))),
        "marker": "known-invalid-legacy-recovery-r1",
    },
    "qa-v9-round-2": {
        "adoption": "1596c46f59d9aa05dcb2c6479f93c28e4b6d7d77e1946fdd30137efc3b532a1d",
        "token_file": "3b0c893cf1e81ab7603d550241dfac81ad6c3fdad99bfc947cf7b8b38ef3323c",
        "token": "sha256:b6bdf6cb0e031291a719776139eac92fc6685f86860d7b51fe3fa75e9825cc9a",
        "decision": "9392d3cfeec2badf8caf01f595f25342f7569e30f53396ab9c3fe73b7cee3a07",
        "defects": tuple(sorted((*FALSE_CUSTOM_LABEL_DEFECTS, OWNER_HEADING_DEFECT))),
        "marker": "known-invalid-legacy-recovery-r2",
    },
    "qa-v9-round-3": {
        "adoption": "8f2901145401ee66d2551c5167e3fb74a4e25c5476af67806df9168f39104545",
        "token_file": "b0acd0ab2d8c2af2676a8e38f0d05db728d6b92286c9c962d4182e89f93cbb5a",
        "token": "sha256:7747af94f5100803543d822c06fd989033c7525a43f2da1e459e3f285ebcb8cb",
        "decision": "9392d3cfeec2badf8caf01f595f25342f7569e30f53396ab9c3fe73b7cee3a07",
        "defects": tuple(sorted((*FALSE_CUSTOM_LABEL_DEFECTS, OWNER_HEADING_DEFECT))),
        "marker": "known-invalid-legacy-recovery-r3",
    },
    "qa-v9-finalization-round-1": {
        "adoption": LEGACY_FINALIZATION_R1_ADOPTION_SHA256,
        "token_file": "d2dfb786e635e4437ae8b526a31b7f37f655c52726c3f2adb153f34802b7de9d",
        "token": LEGACY_FINALIZATION_R1_TOKEN,
        "decision": "dcd5221c04789f7ad6bc79cd96c989227fa59dc9129d46b0697ec958116e1de7",
        "defects": tuple(sorted(FALSE_CUSTOM_LABEL_DEFECTS)),
        "marker": "known-invalid-legacy-finalization-r1",
    },
    "qa-v9-finalization-round-4": {
        "adoption": "b54196d5618fbc5dbe8a60ba90703b5ddb95747af631c8b5e0c2da4d2dd40dcc",
        "token_file": "babb802ca547066c86dd1df1bc9d027675f5408654b8a841f64d90d721ad4a1a",
        "token": "sha256:a1f39ef2a6c5bba9c3b63ee7f516896a923808ed9499b24af51c2e5684c25eaa",
        "decision": "8222a145ddba5a9101c4f851c4aa3f7eca1fe68e7eb9dffd116f51123b7747c0",
        "defects": tuple(sorted(FALSE_CUSTOM_LABEL_DEFECTS)),
        "marker": "known-invalid-legacy-finalization-r4",
    },
}

PRIOR_GATE_PHASE_SCHEMAS = {
    "prior-gate-baseline-diff.redacted.patch": "redacted-diff-v1",
    "prior-gate-changed-files.json": "changed-files/v1",
    "prior-gate-dev-notes.md": "dev-notes-v1",
    "prior-gate-external-changes.json": "external-changes/v1",
    "prior-gate-external-diff.redacted.patch": "redacted-diff-v1",
    "prior-gate-external-state.json": "external-state/v1",
    "prior-gate-gate-diff-check.log": "gate-log/v1",
    "prior-gate-gate-ledger.json": "m2-11-gate-ledger/v1",
    "prior-gate-gate-recovery-tests.log": "gate-log/v1",
    "prior-gate-isolated-feature.json": "isolated-feature-adoption/v1",
    "prior-gate-owner-decision.md": "owner-decision-v1",
    "prior-gate-plan.md": "plan-v1",
    "prior-gate-source-preservation.json": "adopted-source-state/v1",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_json_bytes(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")


def load_canonical_file(path: Path) -> Any:
    def unique_pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in items:
            if key in result:
                raise RuntimeError(f"duplicate JSON key in {path}: {key}")
            result[key] = value
        return result

    value = json.loads(path.read_text("utf-8"), object_pairs_hook=unique_pairs)
    if path.read_bytes() != canonical_json_bytes(value):
        raise RuntimeError(f"noncanonical JSON: {path}")
    return value


def open_blocker_ids(review: Path) -> tuple[str, ...]:
    current: str | None = None
    open_ids: list[str] = []
    for line in review.read_text("utf-8").splitlines():
        match = re.fullmatch(r"#### (F[1-9][0-9]*) \[BLOCKER\]", line)
        if match:
            current = match.group(1)
        elif line.startswith("#### ") or line.startswith("## "):
            current = None
        elif current and line == "- Status: open":
            open_ids.append(current)
            current = None
    if len(open_ids) != len(set(open_ids)):
        raise RuntimeError("prior review contains duplicate open blocker IDs")
    return tuple(sorted(open_ids, key=lambda value: int(value[1:])))


def validate_resolution_notes(paths: QaBundlePaths, review: Path, notes: Path) -> None:
    expected = open_blocker_ids(review)
    if not expected:
        raise RuntimeError("delta cycle requires an open-blocker prior review")
    validate_failed_gate_artifact(paths, notes, "resolution-notes-v1", "qa-review")
    found = re.findall(r"(?m)^## (F[1-9][0-9]*): resolved$", notes.read_text("utf-8"))
    if len(found) != len(set(found)) or set(found) != set(expected):
        raise RuntimeError(
            f"resolution IDs must exactly match prior open blockers; expected={expected!r} found={tuple(found)!r}"
        )


def run_checked(argv: list[str], cwd: Path, env: dict[str, str] | None = None, accepted: tuple[int, ...] = (0,)) -> subprocess.CompletedProcess[bytes]:
    proc = subprocess.run(argv, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode not in accepted:
        detail = proc.stderr.decode("utf-8", "replace")[-4000:]
        raise RuntimeError(f"command failed ({proc.returncode}): {argv!r}\n{detail}")
    return proc


def validate_content(paths: QaBundlePaths, schema: str, path: Path, phase: str, cwd: Path | None = None) -> None:
    """Invoke the shell-owned validator with every value passed as data."""
    cwd = paths.expected_root if cwd is None else cwd
    run_checked(
        [
            "bash",
            "-c",
            '. "$1"; workflow_validate_content "$2" "$3" "$4"',
            "validate-content",
            str(paths.workflow_artifacts),
            schema,
            str(path),
            phase,
        ],
        cwd,
    )


def validate_failed_gate_artifact(
    paths: QaBundlePaths,
    path: Path,
    schema: str,
    phase: str = "qa-gates",
) -> Any:
    """Validate one declared failed-gate artifact under its real schema."""
    if not path.is_file() or path.is_symlink():
        raise RuntimeError(f"failed-gate artifact is missing/nonregular: {path}")
    data = path.read_bytes()
    cap = 2_097_152 if schema == "redacted-diff-v1" else 1_048_576
    if len(data) > cap:
        raise RuntimeError(f"failed-gate artifact exceeds its size cap: {path}")

    def strict_text(*, allow_empty: bool = False, exact_final_newline: bool = False) -> str:
        if not allow_empty and not data:
            raise RuntimeError(f"failed-gate text artifact is empty: {path}")
        try:
            text = data.decode("utf-8", "strict")
        except UnicodeDecodeError as exc:
            raise RuntimeError(f"failed-gate text artifact is not UTF-8: {path}") from exc
        if "\x00" in text or "\r" in text:
            raise RuntimeError(f"failed-gate text artifact is not LF-only: {path}")
        if exact_final_newline and (not text.endswith("\n") or text.endswith("\n\n")):
            raise RuntimeError(f"failed-gate text artifact lacks one final newline: {path}")
        return text

    if schema in {"plan-v1", "dev-notes-v1"}:
        validate_content(paths, schema, path, "plan" if schema == "plan-v1" else "dev")
        return None
    if schema == "redacted-diff-v1":
        env = os.environ.copy()
        env["WORKFLOW_MAX_ARTIFACT_BYTES"] = "2097152"
        run_checked(
            [
                "bash",
                "-c",
                '. "$1"; workflow_validate_content "$2" "$3" "$4"',
                "validate-content",
                str(paths.workflow_artifacts),
                schema,
                str(path),
                phase,
            ],
            paths.expected_root,
            env=env,
        )
        return None
    if schema in {"owner-decision-v1", "owner-decision-v2"}:
        text = strict_text(exact_final_newline=True)
        lines = text.splitlines()
        date_lines = [line for line in lines if line.startswith("**Date:**")]
        authorization_markers = [
            line for line in lines if line.startswith("**Owner authorization:**")
        ]
        if (
            not lines
            or re.fullmatch(r"# RUN M2-11 — .+ Owner Decision", lines[0]) is None
            or sum(line.startswith("# ") for line in lines) != 1
            or len(date_lines) != 1
            or re.fullmatch(
                r"\*\*Date:\*\* \d{4}-\d{2}-\d{2}"
                + (r"  " if schema == "owner-decision-v1" else r""),
                date_lines[0],
            ) is None
            or len(authorization_markers) != 1
            or not authorization_markers[0].startswith("**Owner authorization:** “")
            or "VERDICT:" in text
        ):
            raise RuntimeError(f"{schema} heading/metadata contract mismatch")
        authorization_start = next(
            index for index, line in enumerate(lines)
            if line.startswith("**Owner authorization:** “")
        )
        authorization_lines: list[str] = []
        for line in lines[authorization_start:]:
            authorization_lines.append(line)
            if line.endswith("”"):
                break
        authorization = "\n".join(authorization_lines)
        if not authorization.endswith("”") or re.search(r"“\s*”", authorization):
            raise RuntimeError(f"{schema} authorization is empty or unterminated")
        controlling = re.findall(
            r"The controlling plan is\n`(docs/build/RUN-M2-11-[^`\n]+plan\.md)`",
            text,
        )
        if len(controlling) != 1 or text.count("The controlling plan is") != 1:
            raise RuntimeError(f"{schema} controlling-plan contract mismatch")
        if schema == "owner-decision-v2" and (
            date_lines[0] != "**Date:** 2026-08-11"
            or controlling[0] not in {
                str(FINALIZATION_RELEASE_HYGIENE_PLAN),
                str(FINALIZATION_RELEASE_HYGIENE_F1_PLAN),
                str(FINALIZATION_CLOSEOUT_PLAN),
            }
        ):
            raise RuntimeError("owner-decision-v2 date/controlling-plan contract mismatch")
        return text
    if schema == "resolution-notes-v1":
        text = strict_text(exact_final_newline=True)
        headings = re.findall(
            r"(?m)^## ((?:F[1-9][0-9]*)|(?:gate-[a-z0-9-]+)): resolved$",
            text,
        )
        resolved_lines = re.findall(r"(?m)^## .+: resolved$", text)
        if (
            not headings
            or len(headings) != len(set(headings))
            or len(headings) != len(resolved_lines)
            or "VERDICT:" in text
        ):
            raise RuntimeError("resolution-notes-v1 heading contract mismatch")
        return text
    if schema == "gate-log/v1":
        return strict_text(allow_empty=True)

    value = load_canonical_file(path)
    if not isinstance(value, dict):
        raise RuntimeError(f"failed-gate JSON artifact is not an object: {path}")
    if schema == "changed-files/v1":
        files = value.get("files")
        if (
            set(value) != {"schema_version", "files"}
            or value.get("schema_version") != schema
            or not isinstance(files, list)
            or not files
            or any(
                not isinstance(item, str)
                or not item
                or PurePosixPath(item).is_absolute()
                or ".." in PurePosixPath(item).parts
                for item in files
            )
            or files != sorted(set(files), key=os.fsencode)
        ):
            raise RuntimeError("changed-files/v1 contract mismatch")
    elif schema == "external-state/v1":
        if (
            set(value) != {"schema_version", "scope", "paths", "token"}
            or value.get("schema_version") != schema
            or value.get("scope") != "none"
            or value.get("paths") != []
            or re.fullmatch(r"sha256:[0-9a-f]{64}", value.get("token", "")) is None
        ):
            raise RuntimeError("external-state/v1 contract mismatch")
    elif schema == "external-changes/v1":
        if (
            set(value) != {"schema_version", "before_token", "after_token", "changes"}
            or value.get("schema_version") != schema
            or value.get("changes") != []
            or re.fullmatch(r"sha256:[0-9a-f]{64}", value.get("before_token", "")) is None
            or re.fullmatch(r"sha256:[0-9a-f]{64}", value.get("after_token", "")) is None
        ):
            raise RuntimeError("external-changes/v1 contract mismatch")
    elif schema == "adopted-source-state/v1":
        keys = {
            "schema_version", "origin_mode", "claim", "owner_decision_digest",
            "repo_root", "worktree", "branch", "head", "fetched_base",
            "head_is_ancestor", "origin_worktree_fingerprint", "real_index_sha256",
            "adopted_at_utc",
        }
        if (
            set(value) != keys
            or value.get("schema_version") != schema
            or value.get("origin_mode") != "owner-authorized-current-tree-adoption"
            or value.get("claim") != "not-pre-build-provenance"
            or value.get("head_is_ancestor") is not True
            or re.fullmatch(r"sha256:[0-9a-f]{64}", value.get("owner_decision_digest", "")) is None
            or re.fullmatch(r"[0-9a-f]{64}", value.get("origin_worktree_fingerprint", "")) is None
            or re.fullmatch(r"sha256:[0-9a-f]{64}", value.get("real_index_sha256", "")) is None
            or re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", value.get("adopted_at_utc", "")) is None
        ):
            raise RuntimeError("adopted-source-state/v1 contract mismatch")
    elif schema == "isolated-feature-adoption/v1":
        keys = {
            "schema_version", "baseline_commit", "fetched_base", "worktree",
            "changed_files_digest", "baseline_diff_digest",
            "origin_worktree_fingerprint", "expected_paths",
            "historical_source_checkout", "overlapping_user_hunks", "claim",
        }
        expected_paths = value.get("expected_paths")
        if (
            set(value) != keys
            or value.get("schema_version") != schema
            or value.get("claim") != "current-tree-adoption-no-historical-overlap-claim"
            or value.get("historical_source_checkout") is not None
            or value.get("overlapping_user_hunks") is not None
            or re.fullmatch(r"sha256:[0-9a-f]{64}", value.get("changed_files_digest", "")) is None
            or re.fullmatch(r"sha256:[0-9a-f]{64}", value.get("baseline_diff_digest", "")) is None
            or re.fullmatch(r"[0-9a-f]{64}", value.get("origin_worktree_fingerprint", "")) is None
            or not isinstance(expected_paths, list)
            or not expected_paths
            or any(
                not isinstance(item, str)
                or not item
                or PurePosixPath(item).is_absolute()
                or ".." in PurePosixPath(item).parts
                for item in expected_paths
            )
            or expected_paths != sorted(set(expected_paths), key=os.fsencode)
        ):
            raise RuntimeError("isolated-feature-adoption/v1 contract mismatch")
    elif schema == "m2-11-gate-ledger/v1":
        entry_keys = {
            "ordinal", "id", "kind", "command", "scope", "started_at",
            "completed_at", "duration_seconds", "exit_code", "status", "log_path",
            "log_digest", "pre_fingerprint", "post_fingerprint",
        }
        entries = value.get("entries")
        if (
            set(value) != {
                "schema_version", "round", "origin_worktree_fingerprint", "entries"
            }
            or value.get("schema_version") != schema
            or not isinstance(value.get("round"), int)
            or isinstance(value.get("round"), bool)
            or re.fullmatch(r"[0-9a-f]{64}", value.get("origin_worktree_fingerprint", "")) is None
            or not isinstance(entries, list)
            or not entries
        ):
            raise RuntimeError("m2-11-gate-ledger/v1 top-level contract mismatch")
        for entry in entries:
            if (
                not isinstance(entry, dict)
                or set(entry) != entry_keys
                or not isinstance(entry.get("ordinal"), int)
                or isinstance(entry.get("ordinal"), bool)
                or not isinstance(entry.get("id"), str)
                or re.fullmatch(r"[a-z0-9-]+", entry["id"]) is None
                or entry.get("kind") not in {"test", "lint", "typecheck", "security"}
                or not isinstance(entry.get("command"), str)
                or not isinstance(entry.get("scope"), str)
                or not isinstance(entry.get("duration_seconds"), (int, float))
                or isinstance(entry.get("duration_seconds"), bool)
                or entry["duration_seconds"] < 0
                or not isinstance(entry.get("exit_code"), int)
                or isinstance(entry.get("exit_code"), bool)
                or entry.get("status") not in {"pass", "fail"}
                or re.fullmatch(r"sha256:[0-9a-f]{64}", entry.get("log_digest", "")) is None
                or re.fullmatch(r"[0-9a-f]{64}", entry.get("pre_fingerprint", "")) is None
                or re.fullmatch(r"[0-9a-f]{64}", entry.get("post_fingerprint", "")) is None
                or not Path(entry.get("log_path", "")).is_absolute()
            ):
                raise RuntimeError("m2-11-gate-ledger/v1 entry contract mismatch")
    elif schema == "gate-results/v1":
        gates = value.get("gates")
        gate_keys = {
            "command", "duration_seconds", "exit_code", "kind", "output_path",
            "output_redaction", "required", "scope", "source", "status",
        }
        if (
            set(value) != {"schema_version", "round", "worktree_digest", "gates"}
            or value.get("schema_version") != schema
            or not isinstance(value.get("round"), int)
            or isinstance(value.get("round"), bool)
            or re.fullmatch(r"[0-9a-f]{64}", value.get("worktree_digest", "")) is None
            or not isinstance(gates, list)
            or [item.get("kind") for item in gates if isinstance(item, dict)]
            != ["test", "lint", "typecheck", "security"]
        ):
            raise RuntimeError("gate-results/v1 top-level contract mismatch")
        for gate in gates:
            if (
                not isinstance(gate, dict)
                or set(gate) != gate_keys
                or gate.get("required") is not True
                or gate.get("status") != "pass"
                or gate.get("exit_code") != 0
                or not isinstance(gate.get("duration_seconds"), (int, float))
                or isinstance(gate.get("duration_seconds"), bool)
                or gate["duration_seconds"] < 0
                or not Path(gate.get("output_path", "")).is_absolute()
                or gate.get("output_redaction") != "credential-values-and-private-keys"
                or any(not isinstance(gate.get(key), str) or not gate[key] for key in ("command", "scope", "source"))
            ):
                raise RuntimeError("gate-results/v1 gate contract mismatch")
    elif schema == "approved-tree/v1":
        expected_tree_paths = value.get("expected_paths")
        if (
            set(value) != {
                "schema_version", "baseline_commit", "tree_oid", "expected_paths",
                "real_index_before_sha256", "real_index_after_sha256",
                "private_object_dir_removed",
            }
            or value.get("schema_version") != schema
            or re.fullmatch(r"[0-9a-f]{40}", value.get("baseline_commit", "")) is None
            or re.fullmatch(r"[0-9a-f]{40}", value.get("tree_oid", "")) is None
            or not isinstance(expected_tree_paths, list)
            or not expected_tree_paths
            or expected_tree_paths != sorted(set(expected_tree_paths), key=os.fsencode)
            or any(PurePosixPath(item).is_absolute() or ".." in PurePosixPath(item).parts for item in expected_tree_paths)
            or re.fullmatch(r"sha256:[0-9a-f]{64}", value.get("real_index_before_sha256", "")) is None
            or value.get("real_index_after_sha256") != value.get("real_index_before_sha256")
            or value.get("private_object_dir_removed") is not True
        ):
            raise RuntimeError("approved-tree/v1 contract mismatch")
    elif schema == "candidate-state/v1":
        required_keys = {
            "schema_version", "round", "repo_root", "branch", "head",
            "fetched_base", "head_is_ancestor", "worktree_fingerprint",
            "real_index_sha256", "changed_files_digest", "baseline_diff_digest",
            "gate_ledger_digest", "gate_results_digest", "approved_tree_oid",
            "tail_plan_digest", "recovery_plan_digest",
            "dev_notes_digest", "findings_digest", "t0_log_digest", "t0_log_bytes",
            "t0_log_lines", "snapshot_digest", "snapshot_bytes", "snapshot_mode",
            "snapshot_sidecars",
        }
        if (
            not required_keys.issubset(value)
            or set(value) - required_keys - {"docs_attempt", "finalization_plan_digest"}
            or value.get("schema_version") != schema
            or not isinstance(value.get("round"), int)
            or isinstance(value.get("round"), bool)
            or ("docs_attempt" in value and value.get("docs_attempt") not in (1, 2, 3))
            or value.get("head_is_ancestor") is not True
            or re.fullmatch(r"[0-9a-f]{64}", value.get("worktree_fingerprint", "")) is None
            or re.fullmatch(r"[0-9a-f]{40}", value.get("head", "")) is None
            or re.fullmatch(r"[0-9a-f]{40}", value.get("fetched_base", "")) is None
            or re.fullmatch(r"[0-9a-f]{40}", value.get("approved_tree_oid", "")) is None
            or any(
                re.fullmatch(r"sha256:[0-9a-f]{64}", value.get(key, "")) is None
                for key in (
                    "real_index_sha256", "changed_files_digest", "baseline_diff_digest",
                    "gate_ledger_digest", "gate_results_digest", "tail_plan_digest",
                    "recovery_plan_digest", "dev_notes_digest",
                    "findings_digest", "t0_log_digest", "snapshot_digest",
                )
            )
            or (
                "finalization_plan_digest" in value
                and re.fullmatch(r"sha256:[0-9a-f]{64}", value["finalization_plan_digest"]) is None
            )
            or not isinstance(value.get("snapshot_sidecars"), list)
        ):
            raise RuntimeError("candidate-state/v1 contract mismatch")
    elif schema == "combined-candidate-token/v1":
        parts = value.get("parts")
        if (
            set(value) != {"schema_version", "algorithm", "parts", "token"}
            or value.get("schema_version") != schema
            or value.get("algorithm") != "sha256:populus-m2-11-adoption-candidate-v1"
            or not isinstance(parts, dict)
            or not parts
            or list(parts) != sorted(parts)
            or any(re.fullmatch(r"sha256:[0-9a-f]{64}", digest) is None for digest in parts.values())
            or re.fullmatch(r"sha256:[0-9a-f]{64}", value.get("token", "")) is None
        ):
            raise RuntimeError("combined-candidate-token/v1 contract mismatch")
        expected = "sha256:" + hashlib.sha256(
            b"populus-m2-11-adoption-candidate-v1\0" + canonical_json_bytes(parts)
        ).hexdigest()
        if value["token"] != expected:
            raise RuntimeError("combined-candidate-token/v1 token mismatch")
    else:
        raise RuntimeError(f"unsupported failed-gate artifact schema: {schema}")
    return value


def validate_manifest(paths: QaBundlePaths, path: Path, worktree_digest: str, base_ref: str, cwd: Path | None = None) -> None:
    """Invoke manifest validation without interpolating paths into shell syntax."""
    cwd = paths.expected_root if cwd is None else cwd
    run_checked(
        [
            "bash",
            "-c",
            '. "$1"; workflow_validate_manifest "$2" "$3" "$4"',
            "validate-manifest",
            str(paths.workflow_artifacts),
            str(path),
            worktree_digest,
            base_ref,
        ],
        cwd,
    )


def validate_adoption_record(
    bundle_dir: Path,
    record: dict[str, Any],
    enforce_schema: bool = True,
    schemas: dict[str, str] | None = None,
) -> Path:
    """Validate one current artifact's exact bundle-local path and byte identity."""
    schemas = current_artifact_schemas() if schemas is None else schemas
    if (
        not isinstance(record, dict)
        or set(record) != {"name", "path", "digest", "schema", "required"}
        or record.get("required") is not True
        or record.get("name") not in schemas
    ):
        raise RuntimeError("invalid adoption artifact record")
    name = record["name"]
    if enforce_schema and record.get("schema") != schemas[name]:
        raise RuntimeError(f"adoption artifact schema mismatch: {name}")
    bundle_dir = bundle_dir.resolve()
    expected = bundle_dir / name
    actual = Path(record.get("path", ""))
    if (
        not actual.is_absolute()
        or actual != expected
        or actual.parent != bundle_dir
        or actual.name != name
    ):
        raise RuntimeError(f"adoption artifact path mismatch: {name}")
    if not actual.is_file() or actual.is_symlink():
        raise RuntimeError(f"missing/nonregular adoption artifact: {actual}")
    if record.get("digest") != "sha256:" + sha256_file(actual):
        raise RuntimeError(f"artifact digest mismatch: {actual}")
    return actual


def validate_exact_record(
    actual: dict[str, Any],
    expected: dict[str, Any],
    context: str,
) -> None:
    """Require full record equality and independently verify the referenced bytes."""
    if actual != expected:
        raise RuntimeError(f"{context} record mismatch: {expected.get('name', '')}")
    path = Path(actual.get("path", ""))
    if not path.is_absolute() or not path.is_file() or path.is_symlink():
        raise RuntimeError(f"{context} record path invalid: {expected.get('name', '')}")
    if actual.get("digest") != "sha256:" + sha256_file(path):
        raise RuntimeError(f"{context} record digest stale: {expected.get('name', '')}")


def validate_exact_record_set(
    actual: list[dict[str, Any]],
    expected: dict[str, dict[str, Any]],
    context: str,
) -> None:
    """Require an ordered, unique, complete record set against an independent graph."""
    names = [item.get("name") for item in actual if isinstance(item, dict)]
    if (
        len(names) != len(actual)
        or names != sorted(names, key=os.fsencode)
        or len(names) != len(set(names))
        or set(names) != set(expected)
    ):
        raise RuntimeError(f"{context} record set mismatch")
    for item in actual:
        validate_exact_record(item, expected[item["name"]], context)


def validate_exact_defect_set(
    actual: tuple[str, ...],
    expected: tuple[str, ...],
) -> None:
    """Reject either missing or extra known-invalid defects."""
    if tuple(sorted(actual)) != tuple(sorted(expected)):
        raise RuntimeError(
            "known-invalid defect set mismatch: "
            f"expected={tuple(sorted(expected))!r} actual={tuple(sorted(actual))!r}"
        )


def normalized_record(record: dict[str, Any], name: str | None = None) -> dict[str, Any]:
    """Return one full canonical record, optionally under a locked semantic name."""
    if (
        not isinstance(record, dict)
        or set(record) != {"name", "path", "digest", "schema", "required"}
        or record.get("required") is not True
    ):
        raise RuntimeError("predecessor record shape mismatch")
    return {
        "name": record["name"] if name is None else name,
        "path": record["path"],
        "digest": record["digest"],
        "schema": record["schema"],
        "required": True,
    }


def phase_expected_predecessors(
    bundle_name: str,
    adoption: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    """Derive exact phase predecessor records from the authoritative adoption graph."""
    round_no = adoption.get("round")
    prior = adoption.get("prior_round")
    if round_no == 1:
        if prior is not None:
            raise RuntimeError("round 1 must not contain phase predecessors")
        return {}
    if bundle_name in {"qa-v9-round-2", "qa-v9-round-3"}:
        if not isinstance(prior, dict) or set(prior) != {
            "prior-review", "resolution-notes"
        }:
            raise RuntimeError("recovery predecessor graph mismatch")
        return {
            "prior-qa-review": normalized_record(
                prior["prior-review"], "prior-qa-review"
            ),
            "resolution-notes": normalized_record(prior["resolution-notes"]),
        }
    if bundle_name == "qa-v9-finalization-round-4":
        if (
            not isinstance(prior, dict)
            or set(prior) != {"kind", "round", "artifacts", "resolution-notes"}
            or prior.get("kind") != "gate-failure"
            or prior.get("round") != 3
            or not isinstance(prior.get("artifacts"), list)
        ):
            raise RuntimeError("round-4 predecessor graph mismatch")
        result = {
            item["name"]: normalized_record(item)
            for item in prior["artifacts"]
            if isinstance(item, dict) and isinstance(item.get("name"), str)
        }
        if (
            len(result) != len(prior["artifacts"])
            or set(result) != set(PRIOR_GATE_PHASE_SCHEMAS)
        ):
            raise RuntimeError("round-4 prior-gate record set mismatch")
        result["resolution-notes"] = normalized_record(prior["resolution-notes"])
        return result
    if bundle_name in {
        "qa-v9-finalization-round-5",
        "qa-v9-finalization-round-6",
    }:
        expected = {"prior-qa-review", "prior-review-manifest", "resolution-notes"}
        if not isinstance(prior, dict) or set(prior) != expected:
            raise RuntimeError("sealed-QA predecessor graph mismatch")
        return {name: normalized_record(prior[name]) for name in expected}
    if bundle_name == "qa-v9-finalization-round-7":
        expected = {"prior-qa-review", "prior-bundle-adoption", "resolution-notes"}
        if not isinstance(prior, dict) or set(prior) != expected:
            raise RuntimeError("round-7 unsealed-QA predecessor graph mismatch")
        return {name: normalized_record(prior[name]) for name in expected}
    if bundle_name == "qa-v9-finalization-round-8":
        expected = {"prior-docs-review", "prior-review-manifest", "resolution-notes"}
        if not isinstance(prior, dict) or set(prior) != expected:
            raise RuntimeError("round-8 release-hygiene predecessor graph mismatch")
        return {name: normalized_record(prior[name]) for name in expected}
    if bundle_name == "qa-v9-finalization-round-9":
        expected = {"prior-qa-review", "prior-review-manifest", "resolution-notes"}
        if not isinstance(prior, dict) or set(prior) != expected:
            raise RuntimeError("round-9 release-hygiene F1 predecessor graph mismatch")
        return {name: normalized_record(prior[name]) for name in expected}
    if bundle_name == "qa-v9-finalization-round-10":
        if (
            not isinstance(prior, dict)
            or set(prior) != {"kind", "round", "artifacts", "resolution-notes"}
            or prior.get("kind") != "gate-failure"
            or prior.get("round") != 9
            or not isinstance(prior.get("artifacts"), list)
        ):
            raise RuntimeError("round-10 failed-gate predecessor graph mismatch")
        result = {
            item["name"]: normalized_record(item)
            for item in prior["artifacts"]
            if isinstance(item, dict) and isinstance(item.get("name"), str)
        }
        if (
            len(result) != len(prior["artifacts"])
            or set(result) != set(PRIOR_GATE_PHASE_SCHEMAS)
        ):
            raise RuntimeError("round-10 prior-gate record set mismatch")
        result["resolution-notes"] = normalized_record(prior["resolution-notes"])
        return result
    raise RuntimeError(f"unsupported phase predecessor shape: {bundle_name}")


def validate_phase_manifest(
    path: Path,
    adoption: dict[str, Any],
    records: dict[str, dict[str, Any]],
    predecessor_records: dict[str, dict[str, Any]],
    schemas: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Strictly validate a release-specific phase manifest and every record identity."""
    schemas = current_artifact_schemas() if schemas is None else schemas
    value = load_canonical_file(path)
    phase_by_name = {
        "qa-gates.manifest.json": ("qa-gates", "gate-results", "gate-results.json"),
        "qa-synthesis.manifest.json": ("qa-synthesis", "qa-report", "qa-report.md"),
        "qa-review-input.manifest.json": ("qa-review-input", "qa-report", "qa-report.md"),
    }
    if path.name not in phase_by_name:
        raise RuntimeError(f"unsupported current phase manifest: {path.name}")
    expected_phase, output_name, output_file = phase_by_name[path.name]
    if (
        not isinstance(value, dict)
        or set(value) != {
            "schema_version", "phase", "round", "base_ref", "worktree_digest",
            "output", "inputs",
        }
        or value.get("schema_version") != "m2-11-phase-manifest/v1"
        or value.get("phase") != expected_phase
        or value.get("round") != adoption["round"]
        or value.get("base_ref") != adoption["base_ref"]
        or value.get("worktree_digest") != adoption["worktree_digest"]
        or not isinstance(value.get("inputs"), list)
    ):
        raise RuntimeError(f"m2-11-phase-manifest/v1 identity mismatch: {path.name}")

    def expected_record(name: str, file_name: str, schema: str) -> dict[str, Any]:
        source = records[file_name]
        return {
            "name": name,
            "path": source["path"],
            "digest": source["digest"],
            "schema": schema,
            "required": True,
        }

    if value.get("output") != expected_record(
        output_name, output_file, schemas[output_file]
    ):
        raise RuntimeError(f"m2-11-phase-manifest/v1 output mismatch: {path.name}")
    validate_exact_record(
        value["output"],
        expected_record(output_name, output_file, schemas[output_file]),
        f"m2-11-phase-manifest/v1 output {path.name}",
    )
    inputs = value["inputs"]
    names = [item.get("name") for item in inputs if isinstance(item, dict)]
    if names != sorted(names, key=os.fsencode) or len(names) != len(set(names)):
        raise RuntimeError(f"m2-11-phase-manifest/v1 input ordering mismatch: {path.name}")
    expected_phase_inputs = phase_base_inputs(schemas)
    expected_names = set(expected_phase_inputs) | set(predecessor_records)
    if set(names) != expected_names:
        raise RuntimeError(f"m2-11-phase-manifest/v1 input set mismatch: {path.name}")
    by_name = {item["name"]: item for item in inputs}
    for name, (file_name, schema) in expected_phase_inputs.items():
        validate_exact_record(
            by_name[name],
            expected_record(name, file_name, schema),
            "m2-11-phase-manifest/v1 current input",
        )
    validate_exact_record_set(
        [by_name[name] for name in sorted(predecessor_records, key=os.fsencode)],
        predecessor_records,
        "m2-11-phase-manifest/v1 predecessor input",
    )
    return value


def validate_current_artifact(
    paths: QaBundlePaths,
    name: str,
    path: Path,
    adoption: dict[str, Any],
    records: dict[str, dict[str, Any]],
    predecessor_records: dict[str, dict[str, Any]],
    schemas: dict[str, str] | None = None,
) -> Any:
    """Execute the actual schema route for one current adoption artifact."""
    schemas = current_artifact_schemas() if schemas is None else schemas
    schema = schemas[name]
    if schema == "workflow-artifacts/v1":
        validate_manifest(paths, path, adoption["worktree_digest"], adoption["base_ref"])
        return None
    if schema == "m2-11-phase-manifest/v1":
        return validate_phase_manifest(
            path, adoption, records, predecessor_records, schemas
        )
    if schema in {"docs-commit-v1", "qa-report-v1"}:
        phase = "docs-commit" if schema == "docs-commit-v1" else "qa-synthesis"
        validate_content(paths, schema, path, phase)
        return None
    return validate_failed_gate_artifact(paths, path, schema)


def finalization_docs_attempts(paths: QaBundlePaths, root: Path | None = None) -> dict[int, tuple[int, Path]]:
    """Return the unique, gap-free global docs-attempt sequence."""
    root = paths.evidence_root if root is None else root
    root = root.resolve()
    if not root.is_dir() or root.is_symlink():
        raise RuntimeError("finalization evidence root is invalid")
    attempts: dict[int, tuple[int, Path]] = {}
    for child in root.iterdir():
        match = re.fullmatch(r"docs-v9-finalization-r(10|[1-9])-a([1-3])", child.name)
        if match is None:
            continue
        if child.is_symlink() or not child.is_dir():
            raise RuntimeError("finalization docs attempt is not a regular directory")
        round_no, attempt = int(match.group(1)), int(match.group(2))
        if attempt in attempts:
            raise RuntimeError("duplicate global finalization docs attempt")
        attempts[attempt] = (round_no, child.resolve())
    if sorted(attempts) != list(range(1, len(attempts) + 1)):
        raise RuntimeError("finalization docs attempts are not gap-free")
    return attempts


def next_finalization_docs_attempt(paths: QaBundlePaths, root: Path | None = None) -> int:
    attempt = len(finalization_docs_attempts(paths, root)) + 1
    if attempt > 3:
        raise RuntimeError("finalization docs attempt cap is exhausted")
    return attempt


def validate_failed_gate_bundle(paths: QaBundlePaths, bundle: Path, expected_round: int) -> dict[str, Any]:
    """Validate and inventory one append-only bundle that stopped at a direct gate."""
    bundle = bundle.resolve()
    if (
        bundle.parent != paths.evidence_root.resolve()
        or bundle.name != f"qa-v9-finalization-round-{expected_round}"
        or not bundle.is_dir()
        or bundle.is_symlink()
    ):
        raise RuntimeError("failed gate bundle is outside the exact predecessor namespace")
    ledger_path = bundle / "gate-ledger.json"
    if expected_round == 3 and sha256_file(ledger_path) != ROUND3_FAILED_LEDGER_SHA256:
        raise RuntimeError("failed round-3 gate ledger digest mismatch")
    if expected_round == 9 and sha256_file(ledger_path) != ROUND9_ARTIFACT_SHA256["gate-ledger.json"]:
        raise RuntimeError("failed round-9 gate ledger digest mismatch")
    ledger = validate_failed_gate_artifact(paths, 
        ledger_path,
        "m2-11-gate-ledger/v1",
    )
    if (
        ledger.get("schema_version") != "m2-11-gate-ledger/v1"
        or ledger.get("round") != expected_round
        or not isinstance(ledger.get("entries"), list)
        or not ledger["entries"]
    ):
        raise RuntimeError("failed gate ledger identity mismatch")
    entries = ledger["entries"]
    fingerprint = ledger.get("origin_worktree_fingerprint")
    if expected_round == 3:
        expected_entries = (
            {
                "ordinal": 1,
                "id": "diff-check",
                "kind": "lint",
                "command": GATES[0][2],
                "scope": GATES[0][3],
                "status": "pass",
                "exit_code": 0,
                "log_digest": "sha256:" + EMPTY_SHA256,
                "log_path": str((bundle / "gate-diff-check.log").resolve()),
            },
            {
                "ordinal": 2,
                "id": "recovery-tests",
                "kind": "test",
                "command": GATES[1][2],
                "scope": GATES[1][3],
                "status": "fail",
                "exit_code": 1,
                "log_digest": "sha256:" + ROUND3_RECOVERY_LOG_SHA256,
                "log_path": str((bundle / "gate-recovery-tests.log").resolve()),
            },
        )
        if fingerprint != ROUND3_FAILED_FINGERPRINT or len(entries) != len(expected_entries):
            raise RuntimeError("failed round-3 fingerprint/entry count mismatch")
        for entry, expected in zip(entries, expected_entries, strict=True):
            if any(entry.get(key) != value for key, value in expected.items()):
                raise RuntimeError("failed round-3 gate identity mismatch")
    if expected_round == 9:
        expected_entries = (
            {
                "ordinal": 1,
                "id": "diff-check",
                "kind": "lint",
                "command": GATES[0][2],
                "scope": GATES[0][3],
                "status": "pass",
                "exit_code": 0,
                "log_digest": "sha256:" + ROUND9_ARTIFACT_SHA256["gate-diff-check.log"],
                "log_path": str((bundle / "gate-diff-check.log").resolve()),
            },
            {
                "ordinal": 2,
                "id": "recovery-tests",
                "kind": "test",
                "command": GATES[1][2],
                "scope": GATES[1][3],
                "status": "fail",
                "exit_code": 1,
                "log_digest": "sha256:" + ROUND9_ARTIFACT_SHA256["gate-recovery-tests.log"],
                "log_path": str((bundle / "gate-recovery-tests.log").resolve()),
            },
        )
        if fingerprint != ROUND9_FINGERPRINT or len(entries) != len(expected_entries):
            raise RuntimeError("failed round-9 fingerprint/entry count mismatch")
        for entry, expected in zip(entries, expected_entries, strict=True):
            if any(entry.get(key) != value for key, value in expected.items()):
                raise RuntimeError("failed round-9 gate identity mismatch")
    if [entry.get("ordinal") for entry in entries] != list(range(1, len(entries) + 1)):
        raise RuntimeError("failed gate ledger ordinals are not contiguous")
    if entries[-1].get("status") != "fail" or entries[-1].get("exit_code") == 0:
        raise RuntimeError("failed gate ledger does not end at a real failure")
    if any(entry.get("status") != "pass" or entry.get("exit_code") != 0 for entry in entries[:-1]):
        raise RuntimeError("failed gate ledger has contradictory earlier entries")
    gate_logs: set[str] = set()
    for entry in entries:
        expected_log = bundle / f"gate-{entry.get('id')}.log"
        if Path(entry.get("log_path", "")).resolve() != expected_log.resolve():
            raise RuntimeError("failed gate log path escaped its bundle")
        if not expected_log.is_file() or expected_log.is_symlink():
            raise RuntimeError("failed gate log is missing/nonregular")
        if entry.get("log_digest") != "sha256:" + sha256_file(expected_log):
            raise RuntimeError("failed gate log digest mismatch")
        if entry.get("pre_fingerprint") != fingerprint or entry.get("post_fingerprint") != fingerprint:
            raise RuntimeError("failed gate changed the candidate fingerprint")
        validate_failed_gate_artifact(paths, expected_log, "gate-log/v1")
        gate_logs.add(expected_log.name)
    origin_names = {
        "plan.md", "owner-decision.md", "dev-notes.md", "changed-files.json",
        "baseline-diff.redacted.patch", "external-state.json", "external-changes.json",
        "external-diff.redacted.patch", "source-preservation.json", "isolated-feature.json",
    }
    expected_names = origin_names | gate_logs | {"gate-ledger.json"}
    children = list(bundle.iterdir())
    if any(path.is_symlink() or not path.is_file() for path in children):
        raise RuntimeError("failed gate bundle contains a nonregular path")
    actual_names = {path.name for path in children}
    if actual_names != expected_names:
        raise RuntimeError("failed gate bundle file inventory mismatch")
    expected_plan = (
        PINNED_DIGESTS[FINALIZATION_RELEASE_HYGIENE_F1_PLAN]
        if expected_round == 9
        else PINNED_DIGESTS[FINALIZATION_PLAN]
    )
    expected_decision = (
        PINNED_DIGESTS[FINALIZATION_RELEASE_HYGIENE_F1_DECISION]
        if expected_round == 9
        else PINNED_DIGESTS[FINALIZATION_DECISION]
    )
    if sha256_file(bundle / "plan.md") != expected_plan:
        raise RuntimeError("failed gate bundle plan mismatch")
    if sha256_file(bundle / "owner-decision.md") != expected_decision:
        raise RuntimeError("failed gate bundle decision mismatch")
    schemas = {
        "plan.md": "plan-v1", "owner-decision.md": (
            "owner-decision-v2" if expected_round == 9 else "owner-decision-v1"
        ),
        "dev-notes.md": "dev-notes-v1", "changed-files.json": "changed-files/v1",
        "baseline-diff.redacted.patch": "redacted-diff-v1", "external-state.json": "external-state/v1",
        "external-changes.json": "external-changes/v1", "external-diff.redacted.patch": "redacted-diff-v1",
        "source-preservation.json": "adopted-source-state/v1", "isolated-feature.json": "isolated-feature-adoption/v1",
        "gate-ledger.json": "m2-11-gate-ledger/v1",
    }
    validated: dict[str, Any] = {"gate-ledger.json": ledger}
    for name in sorted(expected_names - gate_logs - {"gate-ledger.json"}, key=os.fsencode):
        validated[name] = validate_failed_gate_artifact(paths, 
            bundle / name,
            schemas[name],
        )

    if expected_round == 9:
        for name, digest in ROUND9_ARTIFACT_SHA256.items():
            path = bundle / name
            if not path.is_file() or path.is_symlink() or sha256_file(path) != digest:
                raise RuntimeError(f"failed round-9 artifact pin mismatch: {name}")
        failure_log = (bundle / "gate-recovery-tests.log").read_text("utf-8")
        if (
            failure_log.count(f"_ {ROUND9_FAILED_TEST} _") != 1
            or "1 failed, 869 passed" not in failure_log
            or failure_log.count("FAILED tests/test_m2_11_qa_bundle.py::") != 1
        ):
            raise RuntimeError("failed round-9 pytest identity mismatch")

    changed = validated["changed-files.json"]
    external_state = validated["external-state.json"]
    external_changes = validated["external-changes.json"]
    source = validated["source-preservation.json"]
    isolated = validated["isolated-feature.json"]
    external_token = "sha256:" + hashlib.sha256(
        b"populus-m2-11-external-state-v1\0[]\n"
    ).hexdigest()
    if expected_round == 9 and changed.get("files") != list(ROUND9_EXPECTED_PATHS):
        raise RuntimeError("failed round-9 changed-file inventory mismatch")
    if (
        external_state["token"] != external_token
        or external_changes["before_token"] != external_token
        or external_changes["after_token"] != external_token
        or (bundle / "external-diff.redacted.patch").read_bytes()
        != b"# No external state in scope; no external changes.\n"
    ):
        raise RuntimeError("failed gate external-state relationship mismatch")
    if (
        source["owner_decision_digest"]
        != "sha256:" + sha256_file(bundle / "owner-decision.md")
        or source["repo_root"] != str(paths.expected_root)
        or source["worktree"] != str(paths.expected_root)
        or source["branch"] != EXPECTED_BRANCH
        or source["head"] != EXPECTED_HEAD
        or source["fetched_base"] != EXPECTED_BASE
        or source["origin_worktree_fingerprint"] != fingerprint
    ):
        raise RuntimeError("failed gate source-preservation relationship mismatch")
    if (
        isolated["baseline_commit"] != EXPECTED_HEAD
        or isolated["fetched_base"] != EXPECTED_BASE
        or isolated["worktree"] != str(paths.expected_root)
        or isolated["changed_files_digest"]
        != "sha256:" + sha256_file(bundle / "changed-files.json")
        or isolated["baseline_diff_digest"]
        != "sha256:" + sha256_file(bundle / "baseline-diff.redacted.patch")
        or isolated["origin_worktree_fingerprint"] != fingerprint
        or isolated["expected_paths"] != changed["files"]
    ):
        raise RuntimeError("failed gate isolated-feature relationship mismatch")
    records = [
        {
            "name": f"prior-gate-{name}",
            "path": str((bundle / name).resolve()),
            "digest": "sha256:" + sha256_file(bundle / name),
            "schema": schemas.get(name, "gate-log/v1"),
            "required": True,
        }
        for name in sorted(expected_names, key=os.fsencode)
    ]
    return {
        "bundle": bundle,
        "round": expected_round,
        "ledger": ledger,
        "artifacts": records,
        "failed_ids": tuple(entry["id"] for entry in entries if entry["status"] == "fail"),
    }


def validate_gate_resolution_notes(paths: QaBundlePaths, failed: dict[str, Any], notes: Path) -> None:
    validate_failed_gate_artifact(paths, notes, "resolution-notes-v1", "qa-gates")
    expected = tuple(f"gate-{gate_id}" for gate_id in failed["failed_ids"])
    found = re.findall(r"(?m)^## (gate-[a-z0-9-]+): resolved$", notes.read_text("utf-8"))
    if len(found) != len(set(found)) or tuple(sorted(found)) != tuple(sorted(expected)):
        raise RuntimeError(f"gate resolution IDs must exactly match failed gates; expected={expected!r} found={tuple(found)!r}")


def validate_sealed_qa_review(
    paths: QaBundlePaths,
    review: Path,
    expected_round: int,
    bundle_validator: Any | None = None,
) -> dict[str, Any]:
    review = review.resolve()
    bundle = review.parent
    if (
        bundle.parent != paths.evidence_root.resolve()
        or bundle.name != f"qa-v9-finalization-round-{expected_round}"
        or review.name != f"qa-review.round-{expected_round}.md"
        or not review.is_file()
        or review.is_symlink()
    ):
        raise RuntimeError("prior QA review is outside the exact predecessor namespace")
    if bundle_validator is None:
        validate_bundle(paths, bundle, live_repo=False)
    else:
        bundle_validator(bundle)
    adoption_path = bundle / "adoption-manifest.json"
    input_path = bundle / "qa-review-input.manifest.json"
    manifest_path = bundle / "qa-review.manifest.json"
    adoption = load_canonical_file(adoption_path)
    review_input = load_canonical_file(input_path)
    manifest = load_canonical_file(manifest_path)
    adoption_record = {
        "name": "adoption-manifest",
        "path": str(adoption_path.resolve()),
        "digest": "sha256:" + sha256_file(adoption_path),
        "schema": "adoption-qa-manifest/v1",
        "required": True,
    }
    expected = {
        "schema_version": "m2-11-phase-manifest/v1",
        "phase": "qa-review",
        "round": expected_round,
        "base_ref": adoption["base_ref"],
        "worktree_digest": adoption["worktree_digest"],
        "output": {
            "name": "qa-review",
            "path": str(review),
            "digest": "sha256:" + sha256_file(review),
            "schema": "review-output-v1",
            "required": True,
        },
        "inputs": sorted([*review_input["inputs"], adoption_record], key=lambda item: os.fsencode(item["name"])),
    }
    if manifest != expected:
        raise RuntimeError("prior QA review manifest is not the exact predecessor graph")
    for item in manifest["inputs"]:
        path = Path(item["path"])
        if not path.is_file() or path.is_symlink() or item["digest"] != "sha256:" + sha256_file(path):
            raise RuntimeError("prior QA review input is missing or stale")
    validate_content(paths, "review-output-v1", review, "qa-review")
    candidate = load_canonical_file(bundle / "candidate-state.json")
    if candidate.get("docs_attempt") is None and adoption["combined_candidate_token"] == LEGACY_FINALIZATION_R1_TOKEN:
        candidate = {**candidate, "docs_attempt": 1}
    return {
        "review": review,
        "manifest": manifest_path,
        "adoption": adoption,
        "candidate": candidate,
        "input": review_input,
    }


def validate_sealed_docs_review(paths: QaBundlePaths, review: Path, expected_attempt: int) -> dict[str, Any]:
    review = review.resolve()
    bundle = review.parent
    match = re.fullmatch(r"docs-v9-finalization-r(10|[1-9])-a([1-3])", bundle.name)
    if (
        bundle.parent != paths.evidence_root.resolve()
        or match is None
        or int(match.group(2)) != expected_attempt
        or review.name != f"docs-review.attempt-{expected_attempt}.md"
        or not review.is_file()
        or review.is_symlink()
    ):
        raise RuntimeError("prior docs review is outside the exact predecessor namespace")
    round_no = int(match.group(1))
    input_path = bundle / "docs-review-input.manifest.json"
    manifest_path = bundle / "docs-review.manifest.json"
    review_input = load_canonical_file(input_path)
    manifest = load_canonical_file(manifest_path)
    manifest_input = {
        "name": "docs-review-input-manifest",
        "path": str(input_path.resolve()),
        "digest": "sha256:" + sha256_file(input_path),
        "schema": "m2-11-phase-manifest/v1",
        "required": True,
    }
    expected = {
        "schema_version": "m2-11-phase-manifest/v1",
        "phase": "docs-review",
        "round": round_no,
        "attempt": expected_attempt,
        "base_ref": review_input.get("base_ref"),
        "worktree_digest": review_input.get("worktree_digest"),
        "output": {
            "name": "docs-review",
            "path": str(review),
            "digest": "sha256:" + sha256_file(review),
            "schema": "review-output-v1",
            "required": True,
        },
        "inputs": sorted([*review_input["inputs"], manifest_input], key=lambda item: os.fsencode(item["name"])),
    }
    if (
        review_input.get("schema_version") != "m2-11-phase-manifest/v1"
        or review_input.get("phase") != "docs-review-input"
        or review_input.get("round") != round_no
        or review_input.get("attempt") != expected_attempt
        or review_input.get("base_ref") != EXPECTED_BASE
        or manifest != expected
    ):
        raise RuntimeError("prior docs review manifest is not the exact predecessor graph")
    input_records = {item["name"]: item for item in review_input["inputs"]}
    if (
        len(input_records) != len(review_input["inputs"])
        or "final-docs-tree" not in input_records
        or review_input.get("output") != input_records["final-docs-tree"]
        or "adoption-manifest" not in input_records
    ):
        raise RuntimeError("prior docs review input graph is incomplete or relabelled")
    for item in manifest["inputs"]:
        path = Path(item["path"])
        if not path.is_file() or path.is_symlink() or item["digest"] != "sha256:" + sha256_file(path):
            raise RuntimeError("prior docs review input is missing or stale")
    validate_content(paths, "review-output-v1", review, "docs-review")
    return {
        "review": review,
        "manifest": manifest_path,
        "input_manifest": input_path,
        "input": review_input,
        "round": round_no,
        "attempt": expected_attempt,
        "adoption_record": input_records["adoption-manifest"],
    }


def validate_release_hygiene_resolution(paths: QaBundlePaths, path: Path) -> Path:
    """Validate the one exact factual resolution of the failed release gate."""
    raw = path
    path = path.resolve()
    if (
        raw.is_symlink()
        or path != paths.release_hygiene_resolution.resolve()
        or not path.is_file()
        or path.read_text("utf-8") != RELEASE_HYGIENE_RESOLUTION_TEXT
    ):
        raise RuntimeError("release-hygiene resolution path/content mismatch")
    validate_failed_gate_artifact(paths, path, "resolution-notes-v1")
    return path


def validate_release_hygiene_predecessor(paths: QaBundlePaths, review: Path) -> dict[str, Any]:
    """Validate the exact sealed round-7 QA/docs approval used by round 8."""
    raw = review
    review = review.resolve()
    if raw.is_symlink() or review != paths.round7_docs_review.resolve():
        raise RuntimeError("release-hygiene docs predecessor path mismatch")
    result = validate_sealed_docs_review(paths, review, 2)
    if (
        result.get("input_manifest") != paths.round7_docs_input.resolve()
        or Path(result.get("manifest", "")).resolve()
        != paths.round7_docs_review_manifest.resolve()
    ):
        raise RuntimeError("release-hygiene predecessor manifest path mismatch")
    exact_files = {
        paths.round7_docs_input: ROUND7_DOCS_INPUT_SHA256,
        paths.round7_docs_review: ROUND7_DOCS_REVIEW_SHA256,
        paths.round7_docs_review_manifest: ROUND7_DOCS_REVIEW_MANIFEST_SHA256,
        paths.round7_adoption: ROUND7_ADOPTION_SHA256,
        paths.round7_token_file: ROUND7_TOKEN_FILE_SHA256,
        paths.round7_qa_review: ROUND7_QA_REVIEW_SHA256,
        paths.round7_qa_review_manifest: ROUND7_QA_REVIEW_MANIFEST_SHA256,
        paths.round7_approved_tree: ROUND7_APPROVED_TREE_SHA256,
    }
    for path, digest in exact_files.items():
        if not path.is_file() or path.is_symlink() or sha256_file(path) != digest:
            raise RuntimeError(f"release-hygiene predecessor pin mismatch: {path}")
    if review.read_text("utf-8").splitlines()[-1] != "VERDICT: APPROVED":
        raise RuntimeError("release-hygiene predecessor is not APPROVED")
    qa = validate_sealed_qa_review(paths, 
        paths.round7_qa_review, 7
    )
    input_records = {item["name"]: item for item in result["input"]["inputs"]}
    exact_records = {
        "adoption-manifest": (
            paths.round7_adoption, ROUND7_ADOPTION_SHA256
        ),
        "combined-candidate-token": (
            paths.round7_token_file,
            ROUND7_TOKEN_FILE_SHA256,
        ),
        "qa-review": (
            paths.round7_qa_review, ROUND7_QA_REVIEW_SHA256
        ),
        "qa-review-manifest": (
            paths.round7_qa_review_manifest,
            ROUND7_QA_REVIEW_MANIFEST_SHA256,
        ),
        "final-docs-tree": (
            paths.round7_approved_tree, ROUND7_APPROVED_TREE_SHA256
        ),
    }
    for name, (path, digest) in exact_records.items():
        record = input_records.get(name)
        if (
            record is None
            or Path(record.get("path", "")).resolve() != path.resolve()
            or record.get("digest") != "sha256:" + digest
        ):
            raise RuntimeError(
                f"release-hygiene predecessor record mismatch: {name}"
            )
    final_message = input_records.get("final-docs-commit", {})
    final_message_path = paths.round7_final_message
    if (
        Path(final_message.get("path", "")).resolve() != final_message_path.resolve()
        or final_message.get("digest") != "sha256:" + ROUND7_FINAL_MESSAGE_SHA256
        or sha256_file(final_message_path) != ROUND7_FINAL_MESSAGE_SHA256
    ):
        raise RuntimeError("release-hygiene final-message predecessor mismatch")
    tree = load_canonical_file(paths.round7_approved_tree)
    token = load_canonical_file(paths.round7_token_file)
    if (
        result["round"] != 7
        or result["attempt"] != 2
        or result["input"].get("worktree_digest") != ROUND7_FINGERPRINT
        or tree.get("tree_oid") != ROUND7_APPROVED_TREE_OID
        or len(tree.get("expected_paths", [])) != 70
        or token.get("token") != ROUND7_TOKEN
        or qa["adoption"].get("worktree_digest") != ROUND7_FINGERPRINT
    ):
        raise RuntimeError("release-hygiene predecessor identity mismatch")
    return result


def validate_release_hygiene_f1_resolution(paths: QaBundlePaths, path: Path) -> Path:
    """Validate the one exact resolution of the sealed round-8 F1 finding."""
    raw = path
    path = path.resolve()
    if (
        raw.is_symlink()
        or path != paths.release_hygiene_f1_resolution.resolve()
        or not path.is_file()
        or path.read_text("utf-8") != RELEASE_HYGIENE_F1_RESOLUTION_TEXT
    ):
        raise RuntimeError("release-hygiene F1 resolution path/content mismatch")
    validate_failed_gate_artifact(paths, path, "resolution-notes-v1")
    return path


def validate_finalization_closeout_resolution(paths: QaBundlePaths, path: Path) -> Path:
    """Validate the exact factual resolution of failed round-9 gate 2."""
    raw = path
    path = path.resolve()
    if (
        raw.is_symlink()
        or path != paths.finalization_closeout_resolution.resolve()
        or not path.is_file()
        or path.read_text("utf-8") != FINALIZATION_CLOSEOUT_RESOLUTION_TEXT
    ):
        raise RuntimeError("finalization closeout resolution path/content mismatch")
    validate_failed_gate_artifact(paths, path, "resolution-notes-v1")
    return path


def validate_release_hygiene_f1_predecessor(paths: QaBundlePaths, review: Path) -> dict[str, Any]:
    """Validate the exact sealed round-8 F1-only rejection used by round 9."""
    raw = review
    review = review.resolve()
    if raw.is_symlink() or review != paths.round8_review.resolve():
        raise RuntimeError("release-hygiene F1 QA predecessor path mismatch")
    exact_paths = {
        paths.round8_adoption: paths.round8_bundle / "adoption-manifest.json",
        paths.round8_token_file: paths.round8_bundle / "combined-candidate-token.json",
        paths.round8_review: paths.round8_bundle / "qa-review.round-8.md",
        paths.round8_review_manifest: paths.round8_bundle / "qa-review.manifest.json",
        paths.round8_approved_tree: paths.round8_bundle / "approved-tree.json",
        paths.round8_candidate_state: paths.round8_bundle / "candidate-state.json",
    }
    if any(path.resolve() != expected.resolve() for path, expected in exact_paths.items()):
        raise RuntimeError("release-hygiene F1 predecessor file path mismatch")
    validate_bundle(paths, paths.round8_bundle, live_repo=False)
    sealed = validate_sealed_qa_review(paths, review, 8)
    exact_files = {
        paths.round8_adoption: ROUND8_ADOPTION_SHA256,
        paths.round8_token_file: ROUND8_TOKEN_FILE_SHA256,
        paths.round8_review: ROUND8_REVIEW_SHA256,
        paths.round8_review_manifest: ROUND8_REVIEW_MANIFEST_SHA256,
        paths.round8_approved_tree: ROUND8_APPROVED_TREE_SHA256,
        paths.round8_candidate_state: ROUND8_CANDIDATE_STATE_SHA256,
    }
    for path, digest in exact_files.items():
        if not path.is_file() or path.is_symlink() or sha256_file(path) != digest:
            raise RuntimeError(f"release-hygiene F1 predecessor pin mismatch: {path}")
    adoption = load_canonical_file(paths.round8_adoption)
    records = {item["name"]: item for item in adoption.get("artifacts", [])}
    token = load_canonical_file(paths.round8_token_file)
    tree = load_canonical_file(paths.round8_approved_tree)
    candidate = load_canonical_file(paths.round8_candidate_state)
    ledger = load_canonical_file(paths.round8_gate_ledger)
    review_manifest = load_canonical_file(paths.round8_review_manifest)
    expected_output = {
        "name": "qa-review",
        "path": str(paths.round8_review.resolve()),
        "digest": "sha256:" + ROUND8_REVIEW_SHA256,
        "schema": "review-output-v1",
        "required": True,
    }
    if review_manifest.get("output") != expected_output:
        raise RuntimeError("release-hygiene F1 review-manifest output mismatch")
    if (
        adoption.get("round") != 8
        or adoption.get("worktree_digest") != ROUND8_FINGERPRINT
        or adoption.get("combined_candidate_token") != ROUND8_TOKEN
        or token.get("token") != ROUND8_TOKEN
        or candidate.get("round") != 8
        or candidate.get("worktree_fingerprint") != ROUND8_FINGERPRINT
        or candidate.get("approved_tree_oid") != ROUND8_APPROVED_TREE_OID
        or tree.get("tree_oid") != ROUND8_APPROVED_TREE_OID
        or len(tree.get("expected_paths", [])) != 72
    ):
        raise RuntimeError("release-hygiene F1 predecessor identity mismatch")
    if (
        records.get("plan.md", {}).get("digest")
        != "sha256:" + PINNED_DIGESTS[FINALIZATION_RELEASE_HYGIENE_PLAN]
        or records.get("owner-decision.md", {}).get("digest")
        != "sha256:" + PINNED_DIGESTS[FINALIZATION_RELEASE_HYGIENE_DECISION]
    ):
        raise RuntimeError("release-hygiene F1 predecessor authority mismatch")
    entries = ledger.get("entries")
    if (
        not isinstance(entries, list)
        or len(entries) != len(GATES)
        or [entry.get("id") for entry in entries] != [gate[0] for gate in GATES]
        or any(entry.get("exit_code") != 0 or entry.get("status") != "pass" for entry in entries)
    ):
        raise RuntimeError("release-hygiene F1 predecessor gate ledger mismatch")
    review_text = review.read_text("utf-8")
    if (
        review_text.splitlines()[-1] != "VERDICT: CHANGES_REQUESTED"
        or open_blocker_ids(review) != ("F1",)
        or ROUND8_TOKEN not in review_text
    ):
        raise RuntimeError("release-hygiene F1 predecessor verdict/finding mismatch")
    return {
        **sealed,
        "review": review,
        "manifest": paths.round8_review_manifest,
        "round": 8,
        "phase": "qa",
    }


def validate_release_hygiene_bytes(
    repo: Path,
    old_files: dict[str, bytes],
) -> None:
    """Prove the exact repaired bytes against an already authenticated old tree."""
    for name, line_numbers in RELEASE_HYGIENE_LINE_EDITS.items():
        old = old_files.get(name)
        if old is None:
            raise RuntimeError(f"approved round-7 whitespace source missing: {name}")
        lines = old.splitlines(keepends=True)
        actual = tuple(
            index
            for index, line in enumerate(lines, 1)
            if re.search(rb"[ \t]+\n$", line)
        )
        if actual != line_numbers:
            raise RuntimeError(
                f"approved round-7 trailing-space set mismatch: {name}: {actual!r}"
            )
        repaired = list(lines)
        for line_number in line_numbers:
            line = repaired[line_number - 1]
            if not line.endswith(b"  \n"):
                raise RuntimeError(
                    f"approved round-7 line is not the exact two-space suffix: "
                    f"{name}:{line_number}"
                )
            repaired[line_number - 1] = line[:-3] + b"\n"
        if (repo / name).read_bytes() != b"".join(repaired):
            raise RuntimeError(f"release-hygiene byte delta mismatch: {name}")


def validate_release_hygiene_delta(repo: Path) -> None:
    """Prove the eight exact whitespace edits against the approved round-7 tree."""
    kind = run_checked(
        ["git", "cat-file", "-t", ROUND7_APPROVED_TREE_OID], repo
    ).stdout.decode().strip()
    if kind != "tree":
        raise RuntimeError("approved round-7 tree is no longer readable")
    archive = run_checked(
        [
            "git",
            "archive",
            "--format=tar",
            "--mtime=1970-01-01T00:00:00Z",
            ROUND7_APPROVED_TREE_OID,
        ],
        repo,
    ).stdout
    if hashlib.sha256(archive).hexdigest() != ROUND7_ARCHIVE_SHA256:
        raise RuntimeError("approved round-7 deterministic archive pin mismatch")
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:") as handle:
        members = {member.name: member for member in handle.getmembers()}
        if sum(not member.isdir() for member in members.values()) != 559:
            raise RuntimeError("approved round-7 archive entry count mismatch")
        old_files: dict[str, bytes] = {}
        for name in RELEASE_HYGIENE_LINE_EDITS:
            member = members.get(name)
            if member is None or not member.isfile():
                raise RuntimeError(f"approved round-7 whitespace source missing: {name}")
            stream = handle.extractfile(member)
            if stream is None:
                raise RuntimeError(f"approved round-7 whitespace source unreadable: {name}")
            old_files[name] = stream.read()
        validate_release_hygiene_bytes(repo, old_files)
        for name in (
            str(FINALIZATION_RELEASE_HYGIENE_DECISION),
            str(FINALIZATION_RELEASE_HYGIENE_PLAN),
        ):
            if name in members:
                raise RuntimeError(f"new release-hygiene artifact existed in round 7: {name}")


def validate_finalization_closeout_delta(paths: QaBundlePaths, repo: Path) -> None:
    """Prove the redacted current patch differs from round 9 on only six paths."""
    patch = paths.round9_bundle / "baseline-diff.redacted.patch"
    if (
        not patch.is_file()
        or patch.is_symlink()
        or sha256_file(patch)
        != ROUND9_ARTIFACT_SHA256["baseline-diff.redacted.patch"]
    ):
        raise RuntimeError("failed round-9 baseline diff pin mismatch")
    script = (
        f"set -o pipefail; ORCH_LIB_ONLY=1; . {paths.orchestrate}; "
        f"cd {repo}; BASELINE_REF=HEAD; collect_diff | scrub_secret_values"
    )
    current_patch = run_checked(["bash", "-c", script], repo).stdout

    def sections(data: bytes) -> dict[str, bytes]:
        starts = [match.start() for match in re.finditer(rb"(?m)^diff --git ", data)]
        if not starts or starts[0] != 0:
            raise RuntimeError("redacted baseline diff lacks a canonical first section")
        starts.append(len(data))
        result: dict[str, bytes] = {}
        for index in range(len(starts) - 1):
            section = data[starts[index]:starts[index + 1]]
            marker = section.find(b"\n--- NEW FILE: ")
            if marker != -1:
                section = section[:marker]
            header = section.splitlines()[0]
            match = re.fullmatch(rb"diff --git a/(.+) b/(.+)", header)
            if match is None or match.group(1) != match.group(2):
                raise RuntimeError("redacted baseline diff has an unsupported path header")
            name = os.fsdecode(match.group(1))
            if name in result:
                raise RuntimeError("redacted baseline diff repeats a path")
            result[name] = section
        return result

    prior_sections = sections(patch.read_bytes())
    current_sections = sections(current_patch)
    delta = tuple(sorted(
        [
            name
            for name in set(prior_sections) | set(current_sections)
            if prior_sections.get(name) != current_sections.get(name)
        ],
        key=os.fsencode,
    ))
    if delta != FINALIZATION_CLOSEOUT_WRITE_PATHS:
        raise RuntimeError(
            "round-10 tree differs from failed round 9 outside the exact closeout scope"
        )


def validate_fixed_state(
    paths: QaBundlePaths,
    repo: Path,
    round_no: int,
    expected_paths: tuple[str, ...] = EXPECTED_QA_PATHS,
    allowed_rounds: tuple[int, ...] = (1, 2, 3),
) -> dict[str, Any]:
    repo = repo.resolve()
    if repo != paths.expected_root.resolve():
        raise RuntimeError(f"wrong dedicated worktree: {repo}")
    if round_no not in allowed_rounds:
        allowed = ", ".join(str(value) for value in allowed_rounds)
        raise RuntimeError(f"QA round must be one of: {allowed}")

    def git(*args: str, accepted: tuple[int, ...] = (0,)) -> str:
        return run_checked(["git", *args], repo, accepted=accepted).stdout.decode().strip()

    if Path(git("rev-parse", "--show-toplevel")).resolve() != repo:
        raise RuntimeError("repository root mismatch")
    branch = git("branch", "--show-current")
    head = git("rev-parse", "HEAD")
    base = git("rev-parse", "origin/main")
    if (branch, head, base) != (EXPECTED_BRANCH, EXPECTED_HEAD, EXPECTED_BASE):
        raise RuntimeError(f"fixed Git state mismatch: {(branch, head, base)!r}")
    run_checked(["git", "merge-base", "--is-ancestor", head, base], repo)

    superseded_round8_pins = {
        OWNER_DECISION,
        FINALIZATION_DECISION,
        FINALIZATION_EXCEPTION_DECISION,
        FINALIZATION_REPAIR_DECISION,
        FINALIZATION_REPAIR_PLAN,
        FINALIZATION_F3_DECISION,
        FINALIZATION_F3_PLAN,
        FINALIZATION_F4_F5_DECISION,
    }
    for raw_path, expected in paths.pinned_digests().items():
        if round_no in (8, 9, 10) and raw_path in superseded_round8_pins:
            continue
        path = raw_path if raw_path.is_absolute() else repo / raw_path
        if not path.is_file() or path.is_symlink():
            raise RuntimeError(f"missing/nonregular pinned input: {path}")
        if sha256_file(path) != expected:
            raise RuntimeError(f"pinned digest mismatch: {path}")
    if paths.t0_log.stat().st_size != 63_400 or len(paths.t0_log.read_bytes().splitlines()) != 171:
        raise RuntimeError("T0-v11 size/line identity mismatch")
    t0_text = paths.t0_log.read_text("utf-8", errors="strict")
    for marker in (
        "(i) view gate: PASS",
        '"label": "full"',
        '"reassembly_mismatch_count": 0',
        '"stop": false',
        "snapshot_immutability: PASS",
    ):
        if marker not in t0_text:
            raise RuntimeError(f"T0-v11 success marker absent: {marker}")
    snap_mode = stat.S_IMODE(paths.snapshot.stat().st_mode)
    if paths.snapshot.stat().st_size != 23_058_628_608 or snap_mode != 0o444:
        raise RuntimeError("snapshot size/mode mismatch")
    sidecars = [str(Path(str(paths.snapshot) + suffix)) for suffix in ("-wal", "-shm", "-journal") if Path(str(paths.snapshot) + suffix).exists()]
    if sidecars:
        raise RuntimeError(f"snapshot sidecars present: {sidecars}")
    if round_no in (8, 9, 10):
        validate_release_hygiene_delta(repo)
    if round_no == 10:
        validate_finalization_closeout_delta(paths, repo)

    changed = changed_paths(repo)
    if tuple(changed) != expected_paths:
        missing = sorted(set(expected_paths) - set(changed), key=os.fsencode)
        extra = sorted(set(changed) - set(expected_paths), key=os.fsencode)
        raise RuntimeError(f"candidate inventory mismatch; missing={missing!r} extra={extra!r}")
    for name in changed:
        posix = PurePosixPath(name)
        if posix.is_absolute() or ".." in posix.parts:
            raise RuntimeError(f"unsafe candidate path: {name}")
        path = repo / name
        if path.exists() and (path.is_symlink() or not path.is_file()):
            raise RuntimeError(f"candidate path is not a regular file: {name}")
        if any(token in name.lower() for token in (".env", "secret", "credential")):
            raise RuntimeError(f"secret-looking candidate path: {name}")

    index_path = Path(git("rev-parse", "--git-path", "index"))
    if not index_path.is_absolute():
        index_path = repo / index_path
    return {
        "repo": repo,
        "round": round_no,
        "branch": branch,
        "head": head,
        "base": base,
        "paths": changed,
        "fingerprint": external_worktree_fingerprint(paths, repo),
        "index_path": index_path.resolve(),
        "index_digest": sha256_file(index_path.resolve()),
        "snapshot_mode": format(snap_mode, "04o"),
        "snapshot_sidecars": sidecars,
    }


def changed_paths(repo: Path) -> list[str]:
    tracked = run_checked(["git", "diff", "--name-only", "-z", "HEAD", "--"], repo).stdout
    untracked = run_checked(["git", "ls-files", "--others", "--exclude-standard", "-z", "--"], repo).stdout
    names: set[str] = set()
    for raw in (tracked + untracked).split(b"\0"):
        if not raw:
            continue
        name = os.fsdecode(raw)
        posix = PurePosixPath(name)
        if posix.is_absolute() or ".." in posix.parts or str(posix) != name:
            raise RuntimeError(f"unsafe Git path: {name!r}")
        names.add(name)
    return sorted(names, key=os.fsencode)


def external_worktree_fingerprint(paths: QaBundlePaths, repo: Path) -> str:
    script = f"ORCH_LIB_ONLY=1; . {paths.orchestrate}; cd {repo}; worktree_fingerprint"
    proc = run_checked(["bash", "-c", script], repo)
    value = proc.stdout.decode().strip()
    if len(value) != 64 or any(ch not in "0123456789abcdef" for ch in value):
        raise RuntimeError("external fingerprint was not lowercase SHA-256")
    return value


def write_complete_redacted_diff(paths: QaBundlePaths, repo: Path, output: Path) -> str:
    script = f"set -o pipefail; ORCH_LIB_ONLY=1; . {paths.orchestrate}; cd {repo}; BASELINE_REF=HEAD; collect_diff | scrub_secret_values"
    data = run_checked(["bash", "-c", script], repo).stdout
    if not data:
        raise RuntimeError("complete baseline diff is empty")
    truncation_sentinel = b"[" + b"TRUNCATED"
    if len(data) > 2_097_152 or truncation_sentinel in data:
        raise RuntimeError("complete baseline diff exceeds cap or is truncated")
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(data)
    env = os.environ.copy()
    env["WORKFLOW_MAX_ARTIFACT_BYTES"] = "2097152"
    run_checked(
        ["bash", "-c", '. "$1"; workflow_validate_content "$2" "$3" "$4"', "validate-content", str(paths.workflow_artifacts), "redacted-diff-v1", str(output), "qa-gates"],
        repo,
        env=env,
    )
    return "sha256:" + sha256_file(output)


def write_origin_artifacts(paths: QaBundlePaths, state: dict[str, Any], output_dir: Path) -> dict[str, Path]:
    repo = state["repo"]
    artifacts: dict[str, Path] = {}

    def write(name: str, data: bytes) -> Path:
        path = output_dir / name
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        artifacts[name] = path
        return path

    def copy(name: str, source: Path) -> Path:
        source = source if source.is_absolute() else repo / source
        return write(name, source.read_bytes())

    copy("plan.md", state["plan"])
    copy("owner-decision.md", state["owner_decision"])
    copy("dev-notes.md", DEV_NOTES)
    changed = write("changed-files.json", canonical_json_bytes({"schema_version": "changed-files/v1", "files": state["paths"]}))
    baseline = output_dir / "baseline-diff.redacted.patch"
    write_complete_redacted_diff(paths, repo, baseline)
    artifacts[baseline.name] = baseline
    external_token = "sha256:" + hashlib.sha256(b"populus-m2-11-external-state-v1\0[]\n").hexdigest()
    external_state = {
        "schema_version": "external-state/v1",
        "scope": "none",
        "paths": [],
        "token": external_token,
    }
    write("external-state.json", canonical_json_bytes(external_state))
    write("external-changes.json", canonical_json_bytes({
        "schema_version": "external-changes/v1",
        "before_token": external_token,
        "after_token": external_token,
        "changes": [],
    }))
    write("external-diff.redacted.patch", b"# No external state in scope; no external changes.\n")
    adopted = {
        "schema_version": "adopted-source-state/v1",
        "origin_mode": "owner-authorized-current-tree-adoption",
        "claim": "not-pre-build-provenance",
        "owner_decision_digest": "sha256:" + sha256_file(artifacts["owner-decision.md"]),
        "repo_root": str(repo),
        "worktree": str(repo),
        "branch": state["branch"],
        "head": state["head"],
        "fetched_base": state["base"],
        "head_is_ancestor": True,
        "origin_worktree_fingerprint": state["fingerprint"],
        "real_index_sha256": "sha256:" + state["index_digest"],
        "adopted_at_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    }
    write("source-preservation.json", canonical_json_bytes(adopted))
    isolated = {
        "schema_version": "isolated-feature-adoption/v1",
        "baseline_commit": state["head"],
        "fetched_base": state["base"],
        "worktree": str(repo),
        "changed_files_digest": "sha256:" + sha256_file(changed),
        "baseline_diff_digest": "sha256:" + sha256_file(baseline),
        "origin_worktree_fingerprint": state["fingerprint"],
        "expected_paths": state["paths"],
        "historical_source_checkout": None,
        "overlapping_user_hunks": None,
        "claim": "current-tree-adoption-no-historical-overlap-claim",
    }
    write("isolated-feature.json", canonical_json_bytes(isolated))
    return artifacts


def run_gate(paths: QaBundlePaths, entry: tuple[str, str, str, str], state: dict[str, Any], output_dir: Path) -> dict[str, Any]:
    gate_id, kind, command, scope = entry
    pre = external_worktree_fingerprint(paths, state["repo"])
    if pre != state["fingerprint"]:
        raise RuntimeError(f"candidate drift before gate {gate_id}")
    started = datetime.now(timezone.utc).replace(microsecond=0)
    begin = time.monotonic()
    proc = subprocess.run(["bash", "-lc", command], cwd=state["repo"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    duration = round(time.monotonic() - begin, 6)
    completed = datetime.now(timezone.utc).replace(microsecond=0)
    scrub = f"ORCH_LIB_ONLY=1; . {paths.orchestrate}; scrub_secret_values"
    clean = subprocess.run(["bash", "-c", scrub], cwd=state["repo"], input=proc.stdout, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if clean.returncode != 0:
        raise RuntimeError(f"could not redact gate output for {gate_id}")
    log_path = output_dir / f"gate-{gate_id}.log"
    fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(clean.stdout)
    post = external_worktree_fingerprint(paths, state["repo"])
    if post != state["fingerprint"]:
        raise RuntimeError(f"candidate drift after gate {gate_id}")
    return {
        "id": gate_id,
        "kind": kind,
        "command": command,
        "scope": scope,
        "started_at": started.isoformat().replace("+00:00", "Z"),
        "completed_at": completed.isoformat().replace("+00:00", "Z"),
        "duration_seconds": duration,
        "exit_code": proc.returncode,
        "status": "pass" if proc.returncode == 0 else "fail",
        "log_path": str(log_path),
        "log_digest": "sha256:" + sha256_file(log_path),
        "pre_fingerprint": pre,
        "post_fingerprint": post,
    }


def write_gate_artifacts(paths: QaBundlePaths, records: list[dict[str, Any]], state: dict[str, Any], output_dir: Path) -> dict[str, Path]:
    def write(path: Path, data: bytes) -> None:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)

    ledger_path = output_dir / "gate-ledger.json"
    ledger_entries = [{"ordinal": number, **record} for number, record in enumerate(records, 1)]
    write(ledger_path, canonical_json_bytes({
        "schema_version": "m2-11-gate-ledger/v1",
        "round": state["round"],
        "origin_worktree_fingerprint": state["fingerprint"],
        "entries": ledger_entries,
    }))
    if len(records) != len(GATES) or any(record["exit_code"] != 0 for record in records):
        raise RuntimeError("one or more required QA gates failed; see gate-ledger.json")

    aggregate = output_dir / "gate-test-aggregate.log"
    chunks: list[bytes] = []
    for number, record in enumerate(records, 1):
        if number in (*range(2, 10), *range(11, 16)):
            chunks.append(f"===== gate {number}: {record['id']} =====\n".encode())
            chunks.append(Path(record["log_path"]).read_bytes())
            if chunks[-1] and not chunks[-1].endswith(b"\n"):
                chunks.append(b"\n")
    write(aggregate, b"".join(chunks))
    by_number = {number: record for number, record in enumerate(records, 1)}
    test_duration = round(sum(by_number[number]["duration_seconds"] for number in (*range(2, 10), *range(11, 16))), 6)
    gates = [
        {"kind": "test", "command": "M2-11 gate ledger entries 2-9,11-15", "source": "owner-approved recovery ledger", "scope": "complete candidate, focused, expanded, compatibility, build, post-build, and five acceptances", "exit_code": 0, "duration_seconds": test_duration, "output_path": str(aggregate), "output_redaction": "credential-values-and-private-keys", "required": True, "status": "pass"},
        {"kind": "lint", "command": by_number[1]["command"], "source": "git", "scope": by_number[1]["scope"], "exit_code": 0, "duration_seconds": by_number[1]["duration_seconds"], "output_path": by_number[1]["log_path"], "output_redaction": "credential-values-and-private-keys", "required": True, "status": "pass"},
        {"kind": "typecheck", "command": "make check (Astro check subgate)", "source": "Makefile:check", "scope": "dashboard full tree", "exit_code": 0, "duration_seconds": by_number[9]["duration_seconds"], "output_path": by_number[9]["log_path"], "output_redaction": "credential-values-and-private-keys", "required": True, "status": "pass"},
        {"kind": "security", "command": by_number[10]["command"], "source": "Makefile:security", "scope": by_number[10]["scope"], "exit_code": 0, "duration_seconds": by_number[10]["duration_seconds"], "output_path": by_number[10]["log_path"], "output_redaction": "credential-values-and-private-keys", "required": True, "status": "pass"},
    ]
    gate_results = output_dir / "gate-results.json"
    write(gate_results, canonical_json_bytes({"schema_version": "gate-results/v1", "round": state["round"], "worktree_digest": state["fingerprint"], "gates": gates}))
    validate_content(paths, "gate-results-v1", gate_results, "qa-gates", state["repo"])
    return {"gate-ledger.json": ledger_path, "gate-results.json": gate_results, "gate-test-aggregate.log": aggregate}


def compute_approved_tree(state: dict[str, Any]) -> dict[str, Any]:
    """Compute and hygiene-check the exact candidate tree without output writes."""
    before = sha256_file(state["index_path"])
    repo = state["repo"]
    tree_oid = ""
    failure: Exception | None = None
    try:
        with tempfile.TemporaryDirectory(prefix="m2-11-approved-tree-") as raw:
            temp = Path(raw)
            index = temp / "index"
            objects = temp / "objects"
            objects.mkdir(mode=0o700)
            common = run_checked(
                ["git", "rev-parse", "--git-common-dir"], repo
            ).stdout.decode().strip()
            common_path = Path(common)
            if not common_path.is_absolute():
                common_path = repo / common_path
            env = os.environ.copy()
            env.update({
                "GIT_INDEX_FILE": str(index),
                "GIT_OBJECT_DIRECTORY": str(objects),
                "GIT_ALTERNATE_OBJECT_DIRECTORIES": str(
                    (common_path / "objects").resolve()
                ),
            })
            run_checked(["git", "read-tree", "HEAD"], repo, env=env)
            run_checked(["git", "add", "-A", "--", "."], repo, env=env)
            names = run_checked(
                ["git", "diff", "--cached", "--name-only", "-z", "HEAD", "--"],
                repo,
                env=env,
            ).stdout
            staged = sorted(
                (os.fsdecode(item) for item in names.split(b"\0") if item),
                key=os.fsencode,
            )
            if staged != state["paths"]:
                raise RuntimeError("private-index changed-path inventory mismatch")
            if state["round"] == 8:
                delta_names = run_checked(
                    [
                        "git", "diff", "--cached", "--name-only", "-z",
                        ROUND7_APPROVED_TREE_OID, "--",
                    ],
                    repo,
                    env=env,
                ).stdout
                delta = tuple(sorted(
                    (os.fsdecode(item) for item in delta_names.split(b"\0") if item),
                    key=os.fsencode,
                ))
                if delta != RELEASE_HYGIENE_WRITE_PATHS:
                    raise RuntimeError(
                        "round-8 tree differs from round 7 outside the exact repair scope"
                    )
            run_checked(["git", "diff", "--cached", "--check"], repo, env=env)
            tree_oid = run_checked(
                ["git", "write-tree"], repo, env=env
            ).stdout.decode().strip()
    except Exception as exc:  # preserve the primary failure after real-index proof
        failure = exc
    after = sha256_file(state["index_path"])
    if before != after:
        raise RuntimeError("real Git index changed while building approved tree")
    if failure is not None:
        raise failure
    if re.fullmatch(r"[0-9a-f]{40}", tree_oid) is None:
        raise RuntimeError("approved tree OID missing/invalid")
    return {
        "schema_version": "approved-tree/v1",
        "baseline_commit": state["head"],
        "tree_oid": tree_oid,
        "expected_paths": state["paths"],
        "real_index_before_sha256": "sha256:" + before,
        "real_index_after_sha256": "sha256:" + after,
        "private_object_dir_removed": True,
    }


def write_approved_tree(record: dict[str, Any], output_dir: Path) -> str:
    """Persist a previously checked tree record exactly once."""
    path = output_dir / "approved-tree.json"
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(canonical_json_bytes(record))
    return record["tree_oid"]


def build_approved_tree(state: dict[str, Any], output_dir: Path) -> str:
    """Compatibility wrapper for focused callers; new flows precompute first."""
    return write_approved_tree(compute_approved_tree(state), output_dir)


def validate_candidate_fingerprint(paths: QaBundlePaths, repo: Path, expected: str) -> None:
    """Refuse persistence when gate execution changed the approved candidate."""
    if external_worktree_fingerprint(paths, repo) != expected:
        raise RuntimeError("candidate drift after gates")


def write_candidate_and_token(state: dict[str, Any], artifacts: dict[str, Path], output_dir: Path) -> dict[str, Path]:
    def write(name: str, value: Any) -> Path:
        path = output_dir / name
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(canonical_json_bytes(value))
        artifacts[name] = path
        return path

    approved = json.loads(artifacts["approved-tree.json"].read_text())
    candidate = {
        "schema_version": "candidate-state/v1",
        "round": state["round"],
        "docs_attempt": state.get("docs_attempt"),
        "repo_root": str(state["repo"]),
        "branch": state["branch"],
        "head": state["head"],
        "fetched_base": state["base"],
        "head_is_ancestor": True,
        "worktree_fingerprint": state["fingerprint"],
        "real_index_sha256": "sha256:" + sha256_file(state["index_path"]),
        "changed_files_digest": "sha256:" + sha256_file(artifacts["changed-files.json"]),
        "baseline_diff_digest": "sha256:" + sha256_file(artifacts["baseline-diff.redacted.patch"]),
        "gate_ledger_digest": "sha256:" + sha256_file(artifacts["gate-ledger.json"]),
        "gate_results_digest": "sha256:" + sha256_file(artifacts["gate-results.json"]),
        "approved_tree_oid": approved["tree_oid"],
        "tail_plan_digest": "sha256:" + PINNED_DIGESTS[TAIL_PLAN],
        "recovery_plan_digest": "sha256:" + PINNED_DIGESTS[RECOVERY_PLAN],
        "finalization_plan_digest": "sha256:" + state["task_digest"],
        "dev_notes_digest": "sha256:" + sha256_file(artifacts["dev-notes.md"]),
        "findings_digest": "sha256:" + PINNED_DIGESTS[FINDINGS],
        "t0_log_digest": "sha256:" + T0_LOG_SHA256,
        "t0_log_bytes": 63_400,
        "t0_log_lines": 171,
        "snapshot_digest": "sha256:" + SNAPSHOT_SHA256,
        "snapshot_bytes": 23_058_628_608,
        "snapshot_mode": state["snapshot_mode"],
        "snapshot_sidecars": state["snapshot_sidecars"],
    }
    candidate_path = write("candidate-state.json", candidate)
    part_names = {
        "approved-tree": "approved-tree.json",
        "baseline-diff": "baseline-diff.redacted.patch",
        "candidate-state": "candidate-state.json",
        "changed-files": "changed-files.json",
        "dev-notes": "dev-notes.md",
        "docs-commit": "docs-commit.md",
        "external-changes": "external-changes.json",
        "external-diff": "external-diff.redacted.patch",
        "external-state": "external-state.json",
        "gate-ledger": "gate-ledger.json",
        "gate-results": "gate-results.json",
        "isolated-feature": "isolated-feature.json",
        "owner-decision": "owner-decision.md",
        "plan": "plan.md",
        "qa-report": "qa-report.md",
        "source-preservation": "source-preservation.json",
    }
    parts = {name: "sha256:" + sha256_file(artifacts[file_name]) for name, file_name in sorted(part_names.items())}
    token = "sha256:" + hashlib.sha256(b"populus-m2-11-adoption-candidate-v1\0" + canonical_json_bytes(parts)).hexdigest()
    token_path = write("combined-candidate-token.json", {"schema_version": "combined-candidate-token/v1", "algorithm": "sha256:populus-m2-11-adoption-candidate-v1", "parts": parts, "token": token})
    return {"candidate-state.json": candidate_path, "combined-candidate-token.json": token_path}


def write_markdown_artifacts(paths: QaBundlePaths, state: dict[str, Any], artifacts: dict[str, Path], output_dir: Path) -> dict[str, Path]:
    def write(name: str, data: bytes) -> Path:
        path = output_dir / name
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        artifacts[name] = path
        return path

    docs = write("docs-commit.md", state["final_docs_commit"].read_bytes())
    if state["cycle"] == "finalization-closeout-exception":
        summary = (
            "Logical finalization round 10 adopted the exact owner-authorized "
            "76-path consolidated closeout candidate. All 15 required commands "
            "exited zero, the candidate fingerprint stayed unchanged, and retained "
            "T0-v11/snapshot identities passed verification without a rerun. The "
            "repair makes no product or T0 change. No round 11 is authorized. "
            "Independent QA review remains pending and authoritative."
        )
        coverage = (
            "R1-R7 of the approved closeout plan are represented by the exact "
            "failed round-9 gate-2 predecessor, exact resolution, 76-path records, "
            "complete origin/external evidence, 15-gate ledger, approved tree, "
            "candidate state, token, and strictly typed exact-path manifests."
        )
        new_vs_existing = (
            "The exact round-9 failed-gate transport, two-digit round-10 docs/release "
            "consumers, final authority branch, and their decision/plan are new and "
            "declared. Product and T0 bytes remain unchanged."
        )
        debt = (
            "TD-QA-ORIGIN-1 through TD-QA-ORIGIN-11 are the declared run-specific "
            "runner, typed transport, finalization, mutation-oracle, release-hygiene, "
            "and consolidated-closeout debt. No hidden production or security debt "
            "is known."
        )
    elif state["cycle"] == "finalization-release-hygiene-f1-exception":
        summary = (
            "Logical finalization round 9 adopted the exact owner-authorized "
            "74-path release-hygiene F1 verification-only candidate under the "
            "exceptional release-hygiene F1 decision. All 15 required commands "
            "exited zero, the candidate fingerprint stayed unchanged, and retained "
            "T0-v11/snapshot identities passed verification without a rerun. The "
            "repair makes no product or T0 change. No round 10 is authorized. "
            "Independent QA review remains pending and authoritative."
        )
        coverage = (
            "R1-R7 of the approved release-hygiene F1 plan are represented by the "
            "sealed round-8 F1 rejection, exact F1 resolution, independent 136 "
            "refusal IDs and 9 happy IDs, exact 74-path records, complete origin/"
            "external evidence, gate ledger, approved tree, candidate state, token, "
            "and strictly typed exact-path manifests."
        )
        new_vs_existing = (
            "The independent 145-case F1 oracle, exact sealed round-8 predecessor, "
            "digest-scoped ninth-finalization cycle, and their decision/plan are new "
            "and declared. Product and T0 bytes remain unchanged. Existing dependency "
            "findings remain recorded in Dev Notes."
        )
        debt = (
            "TD-QA-ORIGIN-1 through TD-QA-ORIGIN-10 are the declared run-specific "
            "runner, custom schemas, bounded private-index overlap, finalization-cycle "
            "overlap, retries/repairs, typed historical compatibility, path/mutation "
            "oracles, release-hygiene transport, and F1 verification/ninth-finalization "
            "transport debt. No hidden production or security debt is known."
        )
    elif state["cycle"] == "finalization-release-hygiene-exception":
        summary = (
            "Logical finalization round 8 adopted the exact owner-authorized "
            "72-path release-hygiene-only repair candidate under the exceptional "
            "release-hygiene decision. All 15 required commands exited zero, the "
            "candidate fingerprint stayed unchanged, and retained T0-v11/snapshot "
            "identities passed verification without a rerun. The repair makes no "
            "product or T0 change. No round 9 is authorized. Independent QA review "
            "remains pending and authoritative."
        )
        coverage = (
            "R1-R8 of the approved release-hygiene finalization plan are represented "
            "by the release-hygiene decision, exact sealed round-7 QA/docs approvals, "
            "exact release-gate resolution, exact 13-line approved-tree comparison, "
            "complete origin/external evidence, exact 72-path records, private staged "
            "whitespace check, gate ledger, approved tree, candidate state, token, "
            "and strictly typed exact-path manifests."
        )
        new_vs_existing = (
            "The 13 Markdown suffix removals, clean owner-decision-v2 route, private "
            "staged whitespace gate, digest-scoped eighth-finalization cycle, and "
            "their decision/plan are new and declared. Product bytes remain the "
            "previously approved cumulative M2-11 candidate. Existing dependency "
            "findings remain recorded in Dev Notes."
        )
        debt = (
            "TD-QA-ORIGIN-1 through TD-QA-ORIGIN-9 are the declared run-specific "
            "runner, custom schemas, bounded private-index overlap, finalization-cycle "
            "overlap, fourth retry, fifth repair, sixth-finalization schema exception, "
            "exact-path/mutation/seventh-finalization debt, and bounded release-hygiene/"
            "eighth-finalization transport debt. No hidden production or security debt "
            "is known."
        )
    elif state["cycle"] == "finalization-f4-f5-exception":
        summary = (
            "Logical finalization round 7 adopted the exact owner-authorized "
            "70-path F4/F5-only repair candidate under the exceptional F4/F5 "
            "decision. All 15 required commands exited zero, the candidate "
            "fingerprint stayed unchanged, and retained T0-v11/snapshot identities "
            "passed verification without a rerun. Independent QA review remains "
            "pending and authoritative."
        )
        coverage = (
            "R1-R8 of the approved exceptional F4/F5 finalization plan are "
            "represented by the F4/F5 decision, exact unsealed round-6 QA rejection "
            "and adoption manifest, exact F4/F5 resolution, complete origin/external "
            "evidence, exact 70-path changed-file and redacted-diff records, gate "
            "ledger, approved tree, candidate state, token, and strictly typed "
            "exact-path manifests."
        )
        new_vs_existing = (
            "Exact current and predecessor path binding, the independent 581-ID "
            "mutation/refusal oracle, the digest-scoped seventh-finalization cycle, "
            "and their decision/plan are new and declared. Product bytes remain the "
            "previously approved cumulative M2-11 candidate. Existing dependency "
            "findings remain recorded in Dev Notes."
        )
        debt = (
            "TD-QA-ORIGIN-1 through TD-QA-ORIGIN-8 are the declared run-specific "
            "runner, custom schemas, bounded private-index overlap, finalization-cycle "
            "overlap, fourth retry, fifth repair, sixth-finalization schema exception, "
            "and exact-path/mutation/seventh-finalization debt. No hidden production "
            "or security debt is known."
        )
    elif state["cycle"] == "finalization-f3-exception":
        summary = (
            "Logical finalization round 6 adopted the exact owner-authorized "
            "68-path F3-only repair candidate under the exceptional F3 decision. "
            "All 15 required commands exited zero, the candidate fingerprint stayed "
            "unchanged, and retained T0-v11/snapshot identities passed verification "
            "without a rerun. Independent QA review remains pending and authoritative."
        )
        coverage = (
            "R1-R7 of the approved exceptional F3 finalization plan are represented "
            "by the F3 decision, sealed round-5 QA rejection and exact F3 resolution, "
            "complete origin/external evidence, exact 68-path changed-file and "
            "redacted-diff records, gate ledger, approved tree, candidate state, "
            "token, and strictly typed manifests."
        )
        new_vs_existing = (
            "Strict 23-artifact schema dispatch, exact immutable known-invalid evidence "
            "policies, the digest-scoped sixth-finalization cycle, and their decision/plan "
            "are new and declared. Product bytes remain the previously approved cumulative "
            "M2-11 candidate. Existing dependency findings remain recorded in Dev Notes."
        )
        debt = (
            "TD-QA-ORIGIN-1 through TD-QA-ORIGIN-7 are the declared run-specific "
            "runner, custom schemas, bounded private-index overlap, finalization-cycle "
            "overlap, fourth retry, fifth repair, and exact immutable schema-exception/"
            "sixth-finalization debt. No hidden production or security debt is known."
        )
    elif state["cycle"] == "finalization-repair-exception":
        summary = (
            "Logical finalization round 5 adopted the exact owner-authorized "
            "66-path F1/F2 repair candidate under the exceptional repair decision. "
            "All 15 required commands exited zero, the candidate fingerprint stayed "
            "unchanged, and retained T0-v11/snapshot identities passed verification "
            "without a rerun. Independent QA review remains pending and authoritative."
        )
        coverage = (
            "R1-R7 of the approved exceptional finalization repair plan are represented "
            "by the repair decision, sealed round-4 QA rejection and exact F1/F2 "
            "resolution, complete origin/external evidence, exact 66-path changed-file "
            "and redacted-diff records, gate ledger, approved tree, candidate state, "
            "token, and manifests."
        )
        new_vs_existing = (
            "The exact predecessor/schema repair, real hermetic round-4 handoff proof, "
            "digest-scoped fifth-finalization cycle, and their decision/plan are new "
            "and declared. Product changes are the already-approved cumulative M2-11 "
            "candidate. The unchanged dependency audit findings remain pre-existing as "
            "recorded in Dev Notes."
        )
        debt = (
            "TD-QA-ORIGIN-1 through TD-QA-ORIGIN-6 are the declared run-specific "
            "runner, custom schemas, bounded private-index overlap, finalization-cycle "
            "overlap, fourth-finalization retry, and exceptional F1/F2 repair/fifth "
            "finalization round. No hidden production or security debt is known."
        )
    elif state["cycle"] == "finalization-exception":
        summary = (
            "Logical finalization round 4 adopted the exact owner-authorized "
            "64-path current candidate under the exceptional retry decision. All "
            "15 required commands exited zero, the candidate fingerprint stayed "
            "unchanged, and retained T0-v11/snapshot identities passed verification "
            "without a rerun. Independent QA review remains pending and authoritative."
        )
        coverage = (
            "R1-R7 of the approved exceptional QA/docs finalization retry plan are "
            "represented by the exception decision, exact round-3 failed-gate "
            "predecessor and resolution, complete origin/external evidence, exact "
            "64-path changed-file and redacted-diff records, gate ledger, approved "
            "tree, candidate state, token, and manifests."
        )
        new_vs_existing = (
            "The digest-scoped fourth-finalization retry, its decision/plan, and "
            "cycle-aware recovery runner/test/report changes are new and declared. "
            "Product changes are the already-approved cumulative M2-11 candidate. "
            "The unchanged dependency audit findings remain pre-existing as recorded "
            "in Dev Notes."
        )
        debt = (
            "TD-QA-ORIGIN-1 through TD-QA-ORIGIN-5 are the declared run-specific "
            "runner, custom schemas, bounded private-index overlap, finalization-cycle "
            "overlap, and exceptional fourth-finalization retry. No hidden production "
            "or security debt is known."
        )
    else:
        summary = (
            f"Round {state['round']} adopted the exact owner-authorized current "
            "candidate as an explicit non-historical QA origin. All 15 required "
            "commands exited zero, the candidate fingerprint stayed unchanged, and "
            "retained T0-v11/snapshot identities passed verification without a rerun."
        )
        coverage = (
            "R1-R7 of the approved QA/docs finalization plan are represented by the "
            "cycle-specific owner decision, complete origin/external evidence, "
            "changed-file and redacted-diff records, gate ledger, approved tree, "
            "candidate state, token, and manifests."
        )
        new_vs_existing = (
            "The finalization decision and cycle-aware recovery runner/test changes "
            "are new and declared. Product changes are the already-approved cumulative "
            "M2-11 candidate. The unchanged dependency audit findings remain "
            "pre-existing as recorded in Dev Notes."
        )
        debt = (
            "TD-QA-ORIGIN-1 through TD-QA-ORIGIN-4 are the declared run-specific "
            "runner, custom schemas, bounded private-index overlap, and "
            "finalization-cycle overlap. No hidden production or security debt is known."
        )
    qa = f"""# RUN M2-11 — QA Report (qa-report-v1)

## Detected Stack

Python 3.12.13, TypeScript/Astro, pytest, Node test runner, Make gates, SQLite/JSON1, and static signed publication in the dedicated M2-11 worktree.

## Summary

{summary}

## Requirement Coverage

{coverage}

## Gate Evidence

`gate-ledger.json` contains 15 direct command exits and full redacted log digests. `gate-results.json` maps them once into required test, lint, typecheck, and security surfaces; all four pass.

## Issues Found

No gate or evidence-generation failure was observed. Independent QA review remains authoritative for approval.

## New vs Pre-existing

{new_vs_existing}

## Test Coverage Gaps

No known required recovery or product gate is omitted. T0-v11 is verification-only because its append-only binding run already passed and may not be rerun.

## Security

The runner rejects secret-looking paths, scrubs credential values/private-key blocks, retains the complete diff only on disk, uses mode-0600 create-once artifacts, and leaves the real Git index unchanged.

## Tech Debt Introduced

{debt}

## Memory Touch-Points

The recovery plan's deterministic ten-record memory selection and the complete shared failure-mode catalog shaped create-once evidence, batch remediation, complete gates, exact tree identity, and `git commit -F` release discipline.

## Failure-Mode Sweep

Complete inventories, secret rejection/redaction, real function gates, cross-artifact identity reconciliation, batched independent re-review, and digest/freshness invalidation are all represented in the retained bundle.

## Verdict

PASS
""".encode()
    report = write("qa-report.md", qa)
    checks = (("docs-commit-v1", docs, "docs-commit"), ("dev-notes-v1", artifacts["dev-notes.md"], "dev"), ("qa-report-v1", report, "qa-synthesis"))
    for schema, path, phase in checks:
        validate_content(paths, schema, path, phase, state["repo"])
    return {"docs-commit.md": docs, "qa-report.md": report}


def write_phase_and_adoption_manifests(paths: QaBundlePaths, state: dict[str, Any], artifacts: dict[str, Path], output_dir: Path) -> dict[str, Path]:
    created: dict[str, Path] = {}

    def record(name: str, path: Path, schema: str, required: bool = True) -> dict[str, Any]:
        return {"name": name, "path": str(path.resolve()), "digest": "sha256:" + sha256_file(path), "schema": schema, "required": required}

    def generic_input(name: str, path: Path, producer: str) -> dict[str, Any]:
        return {"name": name, "path": str(path.resolve()), "digest": "sha256:" + sha256_file(path), "producer_phase": producer, "producer_round": state["round"], "redaction": "credential-values-and-private-keys" if "diff" in name else "none", "required": True}

    def write_json(name: str, value: Any) -> Path:
        path = output_dir / name
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(canonical_json_bytes(value))
        artifacts[name] = path
        created[name] = path
        return path

    def generic_manifest(name: str, phase: str, output_name: str, output_schema: str, inputs: list[dict[str, Any]]) -> Path:
        now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        model_status = "verified" if phase in ("docs-commit", "qa-synthesis") else "not-exposed-by-codex"
        observed = [{"model": "gpt-5", "input_tokens": 0, "output_tokens": 0}] if model_status == "verified" else []
        manifest = {
            "schema_version": "workflow-artifacts/v1", "run_id": state["run_id"], "phase": phase, "round": state["round"],
            "transport_mode": "interactive-disk", "requested_profile": "quality", "effective_profile": "quality", "risk_tier": "high", "risk_floor_applied": False,
            "assurance_downgrades": [], "automated_caps": {
                "plan_reviews": 3,
                "qa_rounds": state["qa_round_cap"],
                "explicit_overrides": {
                    "plan_reviews": False,
                    "qa_rounds": state["qa_round_override"],
                },
            },
            "task_digest": "sha256:" + state["task_digest"], "base_ref": state["base"], "worktree_digest": state["fingerprint"],
            "output_artifact": {"name": output_name, "path": str(artifacts[output_name].resolve()), "digest": "sha256:" + sha256_file(artifacts[output_name]), "schema_id": output_schema, "redaction": "none", "complete": True},
            "input_artifacts": inputs, "requested_model": "gpt-5", "observed_models": observed, "primary_observed_model": "gpt-5" if observed else "",
            "model_provenance_source": "operator-supplied-artifact" if observed else "codex-exec", "model_provenance_status": model_status, "effort": "n/a", "fallback_reason": None,
            "started_at": now, "completed_at": now, "status": "complete",
        }
        return write_json(name, manifest)

    plan_i = generic_input("plan", artifacts["plan.md"], "plan")
    dev_i = generic_input("dev-notes", artifacts["dev-notes.md"], "dev")
    changed_i = generic_input("changed-files", artifacts["changed-files.json"], "dev")
    diff_i = generic_input("baseline-diff", artifacts["baseline-diff.redacted.patch"], "qa-gates")
    gates_i = generic_input("gate-results", artifacts["gate-results.json"], "qa-gates")
    core = {
        "docs-commit": generic_manifest("docs-commit.manifest.json", "docs-commit", "docs-commit.md", "docs-commit-v1", [plan_i, dev_i]),
        "qa-gates": generic_manifest("qa-gates.core.manifest.json", "qa-gates", "gate-results.json", "gate-results-v1", [plan_i, dev_i, changed_i, diff_i]),
        "qa-synthesis": generic_manifest("qa-synthesis.core.manifest.json", "qa-synthesis", "qa-report.md", "qa-report-v1", [plan_i, dev_i, changed_i, diff_i, gates_i]),
    }
    for path in core.values():
        validate_manifest(paths, path, state["fingerprint"], state["base"], state["repo"])

    schemas = current_artifact_schemas("sha256:" + state["task_digest"])
    names = {
        "owner-exception": "owner-decision.md", "plan": "plan.md", "dev-notes": "dev-notes.md", "changed-files": "changed-files.json", "baseline-diff": "baseline-diff.redacted.patch",
        "external-state": "external-state.json", "external-changes": "external-changes.json", "external-diff": "external-diff.redacted.patch", "source-preservation": "source-preservation.json",
        "isolated-feature": "isolated-feature.json", "gate-ledger": "gate-ledger.json", "gate-results": "gate-results.json", "approved-tree": "approved-tree.json", "candidate-state": "candidate-state.json",
        "combined-candidate-token": "combined-candidate-token.json", "docs-commit": "docs-commit.md", "qa-report": "qa-report.md",
    }
    phase_inputs = [record(name, artifacts[file_name], schemas[file_name]) for name, file_name in sorted(names.items())]
    if state.get("prior_bundle_adoption"):
        phase_inputs.extend((
            record("prior-qa-review", state["prior_review"], "review-output-v1"),
            record(
                "prior-bundle-adoption",
                state["prior_bundle_adoption"],
                "adoption-qa-manifest/v1",
            ),
            record("resolution-notes", state["resolution_notes"], "resolution-notes-v1"),
        ))
        phase_inputs.sort(key=lambda item: os.fsencode(item["name"]))
    elif state.get("prior_review"):
        prior_name = f"prior-{state['prior_review_phase']}-review"
        phase_inputs.extend((
            record(prior_name, state["prior_review"], "review-output-v1"),
            record("prior-review-manifest", state["prior_review_manifest"], "m2-11-phase-manifest/v1"),
            record("resolution-notes", state["resolution_notes"], "resolution-notes-v1"),
        ))
        phase_inputs.sort(key=lambda item: os.fsencode(item["name"]))
    elif state.get("prior_gate_artifacts"):
        phase_inputs.extend(state["prior_gate_artifacts"])
        phase_inputs.append(record("resolution-notes", state["resolution_notes"], "resolution-notes-v1"))
        phase_inputs.sort(key=lambda item: os.fsencode(item["name"]))
    for phase, output_name in (("qa-gates", "gate-results.json"), ("qa-synthesis", "qa-report.md"), ("qa-review-input", "qa-report.md")):
        write_json(f"{phase}.manifest.json", {
            "schema_version": "m2-11-phase-manifest/v1", "phase": phase, "round": state["round"], "base_ref": state["base"], "worktree_digest": state["fingerprint"],
            "output": record(output_name.rsplit(".", 1)[0], artifacts[output_name], schemas[output_name]), "inputs": phase_inputs,
        })

    prior = None
    if state.get("prior_bundle_adoption"):
        prior = {
            "prior-qa-review": record(
                "prior-qa-review", state["prior_review"], "review-output-v1"
            ),
            "prior-bundle-adoption": record(
                "prior-bundle-adoption",
                state["prior_bundle_adoption"],
                "adoption-qa-manifest/v1",
            ),
            "resolution-notes": record(
                "resolution-notes", state["resolution_notes"], "resolution-notes-v1"
            ),
        }
    elif state.get("prior_review"):
        prior_name = f"prior-{state['prior_review_phase']}-review"
        prior = {
            prior_name: record(prior_name, state["prior_review"], "review-output-v1"),
            "prior-review-manifest": record("prior-review-manifest", state["prior_review_manifest"], "m2-11-phase-manifest/v1"),
            "resolution-notes": record("resolution-notes", state["resolution_notes"], "resolution-notes-v1"),
        }
    elif state.get("prior_gate_artifacts"):
        prior = {
            "kind": "gate-failure",
            "round": state["prior_gate_round"],
            "artifacts": state["prior_gate_artifacts"],
            "resolution-notes": record("resolution-notes", state["resolution_notes"], "resolution-notes-v1"),
        }
    all_records = [
        record(name, path, schemas[name])
        for name, path in sorted(artifacts.items())
        if not name.endswith(".log")
    ]
    token = json.loads(artifacts["combined-candidate-token.json"].read_text())["token"]
    adoption = write_json("adoption-manifest.json", {
        "schema_version": "adoption-qa-manifest/v1", "round": state["round"], "owner_exception": True, "exception_scope": list(state["exception_scope"]),
        "base_ref": state["base"], "worktree_digest": state["fingerprint"], "combined_candidate_token": token,
        "core_manifest_digests": {name: "sha256:" + sha256_file(path) for name, path in sorted(core.items())}, "artifacts": all_records, "prior_round": prior,
    })
    return {**created, "adoption-manifest.json": adoption}


def validate_bundle(
    paths: QaBundlePaths,
    bundle_dir: Path,
    live_repo: bool = True,
    _expected_defects: tuple[str, ...] | None = None,
) -> None:
    bundle_dir = bundle_dir.resolve()
    adoption_path = bundle_dir / "adoption-manifest.json"
    if not adoption_path.is_file() or adoption_path.is_symlink():
        raise RuntimeError("adoption manifest missing/nonregular")

    def load(path: Path) -> Any:
        def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
            result: dict[str, Any] = {}
            for key, value in items:
                if key in result:
                    raise RuntimeError(f"duplicate JSON key in {path}: {key}")
                result[key] = value
            return result
        value = json.loads(path.read_text("utf-8"), object_pairs_hook=pairs)
        if path.read_bytes() != canonical_json_bytes(value):
            raise RuntimeError(f"noncanonical JSON: {path}")
        return value

    adoption = load(adoption_path)
    if set(adoption) != {"schema_version", "round", "owner_exception", "exception_scope", "base_ref", "worktree_digest", "combined_candidate_token", "core_manifest_digests", "artifacts", "prior_round"}:
        raise RuntimeError("adoption manifest keys mismatch")
    if adoption["schema_version"] != "adoption-qa-manifest/v1" or adoption["owner_exception"] is not True:
        raise RuntimeError("adoption exception contract mismatch")
    records: dict[str, dict[str, Any]] = {}
    for rec in adoption["artifacts"]:
        if not isinstance(rec, dict) or not isinstance(rec.get("name"), str):
            raise RuntimeError("invalid adoption artifact record")
        if rec["name"] in records:
            raise RuntimeError("duplicate adoption artifact name")
        path = validate_adoption_record(bundle_dir, rec, enforce_schema=False)
        if path.suffix == ".json":
            load(path)
        records[rec["name"]] = rec
    if "plan.md" not in records:
        raise RuntimeError("adoption artifact set lacks controlling plan")
    plan_digest = records["plan.md"]["digest"]
    schemas = current_artifact_schemas(plan_digest)
    required_names = set(schemas)
    if set(records) != required_names:
        raise RuntimeError(
            "adoption artifact set mismatch: "
            f"missing={sorted(required_names - set(records))!r} "
            f"extra={sorted(set(records) - required_names)!r}"
        )
    defects = [
        f"{name}: declared {records[name]['schema']}, expected {schema}"
        for name, schema in schemas.items()
        if records[name]["schema"] != schema
    ]
    try:
        validate_failed_gate_artifact(paths, 
            Path(records["owner-decision.md"]["path"]),
            schemas["owner-decision.md"],
        )
    except RuntimeError as exc:
        message = str(exc)
        if message in {
            "owner-decision-v1 heading/metadata contract mismatch",
            "owner-decision-v1 controlling-plan contract mismatch",
        }:
            defects.append(f"owner-decision.md: {message}")
        else:
            raise
    defects_tuple = tuple(sorted(defects))
    if _expected_defects is None:
        if defects_tuple:
            raise RuntimeError(f"declared current-artifact schema defects: {defects_tuple!r}")
    else:
        validate_exact_defect_set(defects_tuple, _expected_defects)
    decision_digest = records["owner-decision.md"]["digest"]
    f4_f5_exception = False
    release_hygiene_exception = False
    release_hygiene_f1_exception = False
    closeout_exception = False
    if plan_digest == "sha256:" + PINNED_DIGESTS[RECOVERY_PLAN]:
        expected_scope = RECOVERY_EXCEPTION_SCOPE
        expected_decision = "sha256:" + PINNED_DIGESTS[OWNER_DECISION]
        finalization_cycle = False
        exception_retry = False
        repair_exception = False
        f3_exception = False
        expected_rounds = (1, 2, 3)
        expected_qa_cap = 3
        expected_qa_override = False
    elif plan_digest == "sha256:" + PINNED_DIGESTS[FINALIZATION_PLAN]:
        expected_scope = FINALIZATION_EXCEPTION_SCOPE
        expected_decision = "sha256:" + PINNED_DIGESTS[FINALIZATION_DECISION]
        finalization_cycle = True
        exception_retry = False
        repair_exception = False
        f3_exception = False
        expected_rounds = (1, 2, 3)
        expected_qa_cap = 3
        expected_qa_override = False
    elif plan_digest == "sha256:" + PINNED_DIGESTS[FINALIZATION_EXCEPTION_PLAN]:
        expected_scope = FINALIZATION_RETRY_EXCEPTION_SCOPE
        expected_decision = "sha256:" + PINNED_DIGESTS[FINALIZATION_EXCEPTION_DECISION]
        finalization_cycle = True
        exception_retry = True
        repair_exception = False
        f3_exception = False
        expected_rounds = (4,)
        expected_qa_cap = 4
        expected_qa_override = True
    elif plan_digest == "sha256:" + PINNED_DIGESTS[FINALIZATION_REPAIR_PLAN]:
        expected_scope = FINALIZATION_REPAIR_EXCEPTION_SCOPE
        expected_decision = "sha256:" + PINNED_DIGESTS[FINALIZATION_REPAIR_DECISION]
        finalization_cycle = True
        exception_retry = False
        repair_exception = True
        f3_exception = False
        expected_rounds = (5,)
        expected_qa_cap = 5
        expected_qa_override = True
    elif plan_digest == "sha256:" + PINNED_DIGESTS[FINALIZATION_F3_PLAN]:
        expected_scope = FINALIZATION_F3_EXCEPTION_SCOPE
        expected_decision = "sha256:" + PINNED_DIGESTS[FINALIZATION_F3_DECISION]
        finalization_cycle = True
        exception_retry = False
        repair_exception = False
        f3_exception = True
        expected_rounds = (6,)
        expected_qa_cap = 6
        expected_qa_override = True
    elif plan_digest == "sha256:" + PINNED_DIGESTS[FINALIZATION_F4_F5_PLAN]:
        expected_scope = FINALIZATION_F4_F5_EXCEPTION_SCOPE
        expected_decision = "sha256:" + PINNED_DIGESTS[FINALIZATION_F4_F5_DECISION]
        finalization_cycle = True
        exception_retry = False
        repair_exception = False
        f3_exception = False
        f4_f5_exception = True
        expected_rounds = (7,)
        expected_qa_cap = 7
        expected_qa_override = True
    elif plan_digest == "sha256:" + PINNED_DIGESTS[FINALIZATION_RELEASE_HYGIENE_PLAN]:
        expected_scope = FINALIZATION_RELEASE_HYGIENE_EXCEPTION_SCOPE
        expected_decision = (
            "sha256:" + PINNED_DIGESTS[FINALIZATION_RELEASE_HYGIENE_DECISION]
        )
        finalization_cycle = True
        exception_retry = False
        repair_exception = False
        f3_exception = False
        release_hygiene_exception = True
        expected_rounds = (8,)
        expected_qa_cap = 8
        expected_qa_override = True
    elif plan_digest == "sha256:" + PINNED_DIGESTS[FINALIZATION_RELEASE_HYGIENE_F1_PLAN]:
        expected_scope = FINALIZATION_RELEASE_HYGIENE_F1_EXCEPTION_SCOPE
        expected_decision = (
            "sha256:" + PINNED_DIGESTS[FINALIZATION_RELEASE_HYGIENE_F1_DECISION]
        )
        finalization_cycle = True
        exception_retry = False
        repair_exception = False
        f3_exception = False
        release_hygiene_f1_exception = True
        expected_rounds = (9,)
        expected_qa_cap = 9
        expected_qa_override = True
    elif plan_digest == "sha256:" + PINNED_DIGESTS[FINALIZATION_CLOSEOUT_PLAN]:
        expected_scope = FINALIZATION_CLOSEOUT_EXCEPTION_SCOPE
        expected_decision = "sha256:" + PINNED_DIGESTS[FINALIZATION_CLOSEOUT_DECISION]
        finalization_cycle = True
        exception_retry = False
        repair_exception = False
        f3_exception = False
        closeout_exception = True
        expected_rounds = (10,)
        expected_qa_cap = 10
        expected_qa_override = True
    else:
        raise RuntimeError("adoption plan does not identify a supported evidence cycle")
    if adoption["exception_scope"] != list(expected_scope) or decision_digest != expected_decision:
        raise RuntimeError("adoption cycle authority/exception mismatch")
    if adoption["round"] not in expected_rounds:
        raise RuntimeError("adoption round is outside its digest-scoped authority")
    if exception_retry and (
        bundle_dir.parent != paths.evidence_root.resolve()
        or bundle_dir.name != "qa-v9-finalization-round-4"
    ):
        raise RuntimeError("exception bundle is outside the exact round-4 namespace")
    if repair_exception and (
        bundle_dir.parent != paths.evidence_root.resolve()
        or bundle_dir.name != "qa-v9-finalization-round-5"
    ):
        raise RuntimeError("repair exception bundle is outside the exact round-5 namespace")
    if f3_exception and (
        bundle_dir.parent != paths.evidence_root.resolve()
        or bundle_dir.name != "qa-v9-finalization-round-6"
    ):
        raise RuntimeError("F3 exception bundle is outside the exact round-6 namespace")
    if f4_f5_exception and (
        bundle_dir.parent != paths.evidence_root.resolve()
        or bundle_dir.name != "qa-v9-finalization-round-7"
    ):
        raise RuntimeError("F4/F5 exception bundle is outside the exact round-7 namespace")
    if release_hygiene_exception and (
        bundle_dir.parent != paths.evidence_root.resolve()
        or bundle_dir.name != "qa-v9-finalization-round-8"
    ):
        raise RuntimeError(
            "release-hygiene exception bundle is outside the exact round-8 namespace"
        )
    if release_hygiene_f1_exception and (
        bundle_dir.parent != paths.evidence_root.resolve()
        or bundle_dir.name != "qa-v9-finalization-round-9"
    ):
        raise RuntimeError(
            "release-hygiene F1 exception bundle is outside the exact round-9 namespace"
        )
    if closeout_exception and (
        bundle_dir.parent != paths.evidence_root.resolve()
        or bundle_dir.name != "qa-v9-finalization-round-10"
    ):
        raise RuntimeError("closeout exception bundle is outside the exact round-10 namespace")
    predecessor_records = phase_expected_predecessors(bundle_dir.name, adoption)
    owner_is_expected_invalid = any(
        defect.startswith("owner-decision.md: ")
        for defect in (_expected_defects or ())
    )
    for name in sorted(schemas, key=os.fsencode):
        if name == "owner-decision.md" and owner_is_expected_invalid:
            continue
        validate_current_artifact(paths, 
            name,
            Path(records[name]["path"]),
            adoption,
            records,
            predecessor_records,
            schemas,
        )
    qa_report_path = Path(records["qa-report.md"]["path"])
    if closeout_exception:
        qa_text = qa_report_path.read_text("utf-8")
        for marker in (
            "Logical finalization round 10",
            "76-path consolidated closeout candidate",
            "TD-QA-ORIGIN-1 through TD-QA-ORIGIN-11",
            "no product or T0 change",
            "No round 11 is authorized.",
            "Independent QA review remains pending and authoritative.",
        ):
            if marker not in qa_text:
                raise RuntimeError(f"closeout QA report marker absent: {marker}")
    elif release_hygiene_f1_exception:
        qa_text = qa_report_path.read_text("utf-8")
        for marker in (
            "Logical finalization round 9",
            "74-path release-hygiene F1 verification-only candidate",
            "exceptional release-hygiene F1 decision",
            "TD-QA-ORIGIN-1 through TD-QA-ORIGIN-10",
            "136 refusal IDs and 9 happy IDs",
            "no product or T0 change",
            "No round 10 is authorized.",
            "Independent QA review remains pending and authoritative.",
        ):
            if marker not in qa_text:
                raise RuntimeError(
                    f"release-hygiene F1 QA report marker absent: {marker}"
                )
    elif release_hygiene_exception:
        qa_text = qa_report_path.read_text("utf-8")
        for marker in (
            "Logical finalization round 8",
            "72-path release-hygiene-only repair candidate",
            "exceptional release-hygiene decision",
            "TD-QA-ORIGIN-1 through TD-QA-ORIGIN-9",
            "no product or T0 change",
            "No round 9 is authorized.",
            "Independent QA review remains pending and authoritative.",
        ):
            if marker not in qa_text:
                raise RuntimeError(
                    f"release-hygiene QA report marker absent: {marker}"
                )
    elif f4_f5_exception:
        qa_text = qa_report_path.read_text("utf-8")
        for marker in (
            "Logical finalization round 7",
            "70-path F4/F5-only repair candidate",
            "exceptional F4/F5 decision",
            "TD-QA-ORIGIN-1 through TD-QA-ORIGIN-8",
            "Independent QA review remains pending and authoritative.",
        ):
            if marker not in qa_text:
                raise RuntimeError(f"F4/F5 QA report marker absent: {marker}")
    elif exception_retry:
        qa_text = qa_report_path.read_text("utf-8")
        for marker in (
            "Logical finalization round 4",
            "64-path current candidate",
            "exceptional retry decision",
            "TD-QA-ORIGIN-1 through TD-QA-ORIGIN-5",
            "Independent QA review remains pending and authoritative.",
        ):
            if marker not in qa_text:
                raise RuntimeError(f"exception QA report marker absent: {marker}")
    elif repair_exception:
        qa_text = qa_report_path.read_text("utf-8")
        for marker in (
            "Logical finalization round 5",
            "66-path F1/F2 repair candidate",
            "exceptional repair decision",
            "TD-QA-ORIGIN-1 through TD-QA-ORIGIN-6",
            "Independent QA review remains pending and authoritative.",
        ):
            if marker not in qa_text:
                raise RuntimeError(f"repair QA report marker absent: {marker}")
    elif f3_exception:
        qa_text = qa_report_path.read_text("utf-8")
        for marker in (
            "Logical finalization round 6",
            "68-path F3-only repair candidate",
            "exceptional F3 decision",
            "TD-QA-ORIGIN-1 through TD-QA-ORIGIN-7",
            "Independent QA review remains pending and authoritative.",
        ):
            if marker not in qa_text:
                raise RuntimeError(f"F3 QA report marker absent: {marker}")
    prior = adoption["prior_round"]
    candidate = load(Path(records["candidate-state.json"]["path"]))
    if (
        exception_retry
        or repair_exception
        or f3_exception
        or f4_f5_exception
        or release_hygiene_exception
        or release_hygiene_f1_exception
        or closeout_exception
    ) and candidate.get("finalization_plan_digest") != plan_digest:
        raise RuntimeError("exception candidate does not bind its controlling plan")
    candidate_docs_attempt = candidate.get("docs_attempt")
    if finalization_cycle and candidate_docs_attempt not in (1, 2, 3):
        if (
            adoption["round"] == 1
            and adoption["combined_candidate_token"] == LEGACY_FINALIZATION_R1_TOKEN
            and sha256_file(adoption_path) == LEGACY_FINALIZATION_R1_ADOPTION_SHA256
        ):
            candidate_docs_attempt = 1
        else:
            raise RuntimeError("finalization candidate lacks a valid global docs attempt")
    if adoption["round"] == 1:
        if prior is not None:
            raise RuntimeError("round 1 must not contain prior-round inputs")
    elif not finalization_cycle:
        if not isinstance(prior, dict) or set(prior) != {"prior-review", "resolution-notes"}:
            raise RuntimeError("delta QA bundle lacks the exact prior review/resolution pair")
        for rec in prior.values():
            path = Path(rec["path"])
            if not path.is_file() or path.is_symlink() or rec["digest"] != "sha256:" + sha256_file(path):
                raise RuntimeError("prior-round input is missing, substituted, or stale")
        prior_review_path = Path(prior["prior-review"]["path"])
        resolution_path = Path(prior["resolution-notes"]["path"])
        validate_content(paths, "review-output-v1", prior_review_path, "qa-review")
        if prior_review_path.read_text("utf-8").splitlines()[-1] != "VERDICT: CHANGES_REQUESTED":
            raise RuntimeError("delta bundle prior review is not CHANGES_REQUESTED")
        validate_resolution_notes(paths, prior_review_path, resolution_path)
    else:
        if not isinstance(prior, dict):
            raise RuntimeError("finalization delta lacks predecessor provenance")
        if release_hygiene_f1_exception:
            expected = {
                "prior-qa-review",
                "prior-review-manifest",
                "resolution-notes",
            }
            if set(prior) != expected:
                raise RuntimeError(
                    "round-9 release-hygiene F1 predecessor record set is invalid"
                )
            predecessor = validate_release_hygiene_f1_predecessor(paths, 
                Path(prior["prior-qa-review"]["path"])
            )
            expected_review = {
                "name": "prior-qa-review",
                "path": str(predecessor["review"]),
                "digest": "sha256:" + ROUND8_REVIEW_SHA256,
                "schema": "review-output-v1",
                "required": True,
            }
            expected_manifest = {
                "name": "prior-review-manifest",
                "path": str(predecessor["manifest"].resolve()),
                "digest": "sha256:" + ROUND8_REVIEW_MANIFEST_SHA256,
                "schema": "m2-11-phase-manifest/v1",
                "required": True,
            }
            if (
                prior["prior-qa-review"] != expected_review
                or prior["prior-review-manifest"] != expected_manifest
            ):
                raise RuntimeError(
                    "round-9 release-hygiene F1 predecessor path/digest graph mismatch"
                )
            resolution_record = normalized_record(prior["resolution-notes"])
            resolution_path = validate_release_hygiene_f1_resolution(paths, 
                Path(resolution_record["path"])
            )
            if (
                resolution_record["name"] != "resolution-notes"
                or resolution_record["schema"] != "resolution-notes-v1"
                or resolution_record["digest"]
                != "sha256:" + sha256_file(resolution_path)
                or candidate_docs_attempt != 3
            ):
                raise RuntimeError(
                    "round-9 release-hygiene F1 resolution/docs-attempt mismatch"
                )
        elif release_hygiene_exception:
            expected = {
                "prior-docs-review",
                "prior-review-manifest",
                "resolution-notes",
            }
            if set(prior) != expected:
                raise RuntimeError(
                    "round-8 release-hygiene predecessor record set is invalid"
                )
            predecessor = validate_release_hygiene_predecessor(paths, 
                Path(prior["prior-docs-review"]["path"])
            )
            expected_review = {
                "name": "prior-docs-review",
                "path": str(predecessor["review"]),
                "digest": "sha256:" + ROUND7_DOCS_REVIEW_SHA256,
                "schema": "review-output-v1",
                "required": True,
            }
            expected_manifest = {
                "name": "prior-review-manifest",
                "path": str(predecessor["manifest"].resolve()),
                "digest": "sha256:" + ROUND7_DOCS_REVIEW_MANIFEST_SHA256,
                "schema": "m2-11-phase-manifest/v1",
                "required": True,
            }
            if (
                prior["prior-docs-review"] != expected_review
                or prior["prior-review-manifest"] != expected_manifest
            ):
                raise RuntimeError(
                    "round-8 release-hygiene predecessor path/digest graph mismatch"
                )
            resolution_record = normalized_record(prior["resolution-notes"])
            resolution_path = validate_release_hygiene_resolution(paths, 
                Path(resolution_record["path"])
            )
            if (
                resolution_record["name"] != "resolution-notes"
                or resolution_record["schema"] != "resolution-notes-v1"
                or resolution_record["digest"]
                != "sha256:" + sha256_file(resolution_path)
                or candidate_docs_attempt != 3
            ):
                raise RuntimeError(
                    "round-8 release-hygiene resolution/docs-attempt mismatch"
                )
        elif f4_f5_exception:
            expected = {
                "prior-qa-review",
                "prior-bundle-adoption",
                "resolution-notes",
            }
            if set(prior) != expected:
                raise RuntimeError("round-7 predecessor record set is invalid")
            predecessor = validate_rejected_round6_qa_review(paths, 
                Path(prior["prior-qa-review"]["path"])
            )
            expected_review = {
                "name": "prior-qa-review",
                "path": str(predecessor["review"]),
                "digest": "sha256:" + ROUND6_REVIEW_SHA256,
                "schema": "review-output-v1",
                "required": True,
            }
            expected_adoption = {
                "name": "prior-bundle-adoption",
                "path": str(predecessor["adoption"].resolve()),
                "digest": "sha256:" + ROUND6_ADOPTION_SHA256,
                "schema": "adoption-qa-manifest/v1",
                "required": True,
            }
            if (
                prior["prior-qa-review"] != expected_review
                or prior["prior-bundle-adoption"] != expected_adoption
            ):
                raise RuntimeError("round-7 predecessor path/digest graph mismatch")
            resolution_record = normalized_record(prior["resolution-notes"])
            resolution_path = Path(resolution_record["path"])
            if (
                resolution_record["name"] != "resolution-notes"
                or resolution_record["schema"] != "resolution-notes-v1"
                or not resolution_path.is_absolute()
                or resolution_path.parent != paths.evidence_root.resolve()
                or resolution_path.name != "resolution-notes.finalization-r6-qa.md"
                or not resolution_path.is_file()
                or resolution_path.is_symlink()
                or resolution_record["digest"]
                != "sha256:" + sha256_file(resolution_path)
            ):
                raise RuntimeError("round-7 F4/F5 resolution path/digest mismatch")
            if candidate_docs_attempt != predecessor["candidate"].get("docs_attempt"):
                raise RuntimeError("round-7 rejection must preserve the global docs attempt")
            validate_resolution_notes(paths, predecessor["review"], resolution_path)
        elif exception_retry and prior.get("kind") != "gate-failure":
            raise RuntimeError("exception retry requires the exact failed-gate predecessor")
        if repair_exception and prior.get("kind") == "gate-failure":
            raise RuntimeError("repair exception requires the sealed round-4 QA predecessor")
        if release_hygiene_exception or f4_f5_exception:
            pass
        elif prior.get("kind") == "gate-failure":
            if set(prior) != {"kind", "round", "artifacts", "resolution-notes"} or prior["round"] != adoption["round"] - 1:
                raise RuntimeError("failed-gate predecessor identity mismatch")
            resolution_record = prior["resolution-notes"]
            resolution_path = Path(resolution_record["path"])
            if (
                not resolution_path.is_file()
                or resolution_path.is_symlink()
                or resolution_record["digest"] != "sha256:" + sha256_file(resolution_path)
            ):
                raise RuntimeError("failed-gate resolution notes are missing or stale")
            artifacts = prior["artifacts"]
            ledger_records = [item for item in artifacts if item.get("name") == "prior-gate-gate-ledger.json"]
            if len(ledger_records) != 1:
                raise RuntimeError("failed-gate predecessor lacks one exact ledger")
            failed = validate_failed_gate_bundle(paths, Path(ledger_records[0]["path"]).parent, prior["round"])
            if artifacts != failed["artifacts"]:
                raise RuntimeError("failed-gate predecessor artifact graph mismatch")
            if closeout_exception:
                validate_finalization_closeout_resolution(paths, resolution_path)
            validate_gate_resolution_notes(paths, failed, resolution_path)
        else:
            qa_keys = {"prior-qa-review", "prior-review-manifest", "resolution-notes"}
            docs_keys = {"prior-docs-review", "prior-review-manifest", "resolution-notes"}
            if set(prior) == qa_keys:
                review_name, review_phase = "prior-qa-review", "qa"
            elif set(prior) == docs_keys:
                review_name, review_phase = "prior-docs-review", "docs"
            else:
                raise RuntimeError("finalization delta predecessor record set is invalid")
            if (repair_exception or f3_exception) and review_phase != "qa":
                raise RuntimeError("repair/F3 exception requires only a QA-review predecessor")
            for rec in prior.values():
                path = Path(rec["path"])
                if not path.is_file() or path.is_symlink() or rec["digest"] != "sha256:" + sha256_file(path):
                    raise RuntimeError("finalization predecessor is missing, substituted, or stale")
            prior_review_path = Path(prior[review_name]["path"])
            resolution_path = Path(prior["resolution-notes"]["path"])
            if review_phase == "qa":
                if f3_exception:
                    predecessor = validate_known_invalid_round5_qa_review(paths, 
                        prior_review_path
                    )
                else:
                    historical_validator = (
                        (lambda bundle: validate_historical_bundle(paths, bundle))
                        if repair_exception and _expected_defects is not None
                        else None
                    )
                    predecessor = validate_sealed_qa_review(paths, 
                        prior_review_path,
                        adoption["round"] - 1,
                        bundle_validator=historical_validator,
                    )
                if candidate_docs_attempt != predecessor["candidate"].get("docs_attempt"):
                    raise RuntimeError("QA rejection must preserve the global docs attempt")
            else:
                predecessor = validate_sealed_docs_review(paths, prior_review_path, candidate_docs_attempt - 1)
                if predecessor["round"] != adoption["round"] - 1:
                    raise RuntimeError("docs-originating repair did not advance exactly one QA round")
            if Path(prior["prior-review-manifest"]["path"]).resolve() != predecessor["manifest"].resolve():
                raise RuntimeError("finalization predecessor manifest path mismatch")
            if prior_review_path.read_text("utf-8").splitlines()[-1] != "VERDICT: CHANGES_REQUESTED":
                raise RuntimeError("finalization predecessor is not CHANGES_REQUESTED")
            validate_resolution_notes(paths, prior_review_path, resolution_path)
    token_doc = load(Path(records["combined-candidate-token.json"]["path"]))
    parts = token_doc["parts"]
    expected_token = "sha256:" + hashlib.sha256(b"populus-m2-11-adoption-candidate-v1\0" + canonical_json_bytes(parts)).hexdigest()
    if token_doc["token"] != expected_token or adoption["combined_candidate_token"] != expected_token:
        raise RuntimeError("combined candidate token mismatch")
    for name, digest in parts.items():
        file_name = {"source-preservation": "source-preservation.json", "isolated-feature": "isolated-feature.json", "owner-decision": "owner-decision.md", "baseline-diff": "baseline-diff.redacted.patch", "external-diff": "external-diff.redacted.patch"}.get(name, name + (".json" if name in {"approved-tree", "candidate-state", "changed-files", "external-changes", "external-state", "gate-ledger", "gate-results"} else ".md"))
        if file_name not in records or records[file_name]["digest"] != digest:
            raise RuntimeError(f"token part mismatch: {name}")
    extras = {"owner-exception", "docs-commit", "source-preservation", "isolated-feature", "external-state", "external-changes", "external-diff", "approved-tree", "candidate-state", "combined-candidate-token"}
    for name in ("qa-gates.manifest.json", "qa-synthesis.manifest.json", "qa-review-input.manifest.json"):
        phase = load(Path(records[name]["path"]))
        if phase["schema_version"] != "m2-11-phase-manifest/v1" or not extras.issubset({item["name"] for item in phase["inputs"]}):
            raise RuntimeError(f"phase manifest missing v9 inputs: {name}")
        for item in phase["inputs"]:
            path = Path(item["path"])
            if item["digest"] != "sha256:" + sha256_file(path):
                raise RuntimeError(f"phase input digest mismatch: {path}")
    expected_caps = {
        "plan_reviews": 3,
        "qa_rounds": expected_qa_cap,
        "explicit_overrides": {
            "plan_reviews": False,
            "qa_rounds": expected_qa_override,
        },
    }
    for name in ("docs-commit.manifest.json", "qa-gates.core.manifest.json", "qa-synthesis.core.manifest.json"):
        path = Path(records[name]["path"])
        if load(path).get("automated_caps") != expected_caps:
            raise RuntimeError("core manifest QA cap/override contradicts cycle authority")
        validate_manifest(paths, path, adoption["worktree_digest"], adoption["base_ref"])
    if live_repo and external_worktree_fingerprint(paths, paths.expected_root) != adoption["worktree_digest"]:
        raise RuntimeError("live candidate fingerprint no longer matches bundle")


def validate_historical_bundle(paths: QaBundlePaths, bundle: Path) -> dict[str, Any]:
    """Validate one exact immutable historical bundle without calling it valid."""
    bundle = bundle.resolve()
    policy = HISTORICAL_POLICIES.get(bundle.name)
    if (
        policy is None
        or bundle.parent != paths.evidence_root.resolve()
        or not bundle.is_dir()
        or bundle.is_symlink()
    ):
        raise RuntimeError("bundle is outside the exact immutable historical policy")
    adoption = bundle / "adoption-manifest.json"
    token_file = bundle / "combined-candidate-token.json"
    decision = bundle / "owner-decision.md"
    if (
        sha256_file(adoption) != policy["adoption"]
        or sha256_file(token_file) != policy["token_file"]
        or sha256_file(decision) != policy["decision"]
        or load_canonical_file(token_file).get("token") != policy["token"]
    ):
        raise RuntimeError("immutable historical bundle pin mismatch")
    validate_bundle(paths, 
        bundle,
        live_repo=False,
        _expected_defects=policy["defects"],
    )
    return {"bundle": bundle, "marker": policy["marker"], "defects": policy["defects"]}


def validate_known_invalid_round5_bundle(paths: QaBundlePaths, bundle: Path) -> dict[str, Any]:
    """Validate the exact rejected round-5 F3 bundle without relabelling it valid."""
    bundle = bundle.resolve()
    if (
        bundle.parent != paths.evidence_root.resolve()
        or bundle.name != "qa-v9-finalization-round-5"
        or not bundle.is_dir()
        or bundle.is_symlink()
    ):
        raise RuntimeError("round-5 F3 bundle is outside the exact predecessor namespace")
    adoption = bundle / "adoption-manifest.json"
    token_file = bundle / "combined-candidate-token.json"
    decision = bundle / "owner-decision.md"
    if (
        sha256_file(adoption) != ROUND5_ADOPTION_SHA256
        or sha256_file(token_file) != ROUND5_TOKEN_FILE_SHA256
        or load_canonical_file(token_file).get("token") != ROUND5_TOKEN
        or sha256_file(decision) != ROUND5_DECISION_SHA256
    ):
        raise RuntimeError("round-5 F3 bundle pin mismatch")
    defects = tuple(sorted((*FALSE_CUSTOM_LABEL_DEFECTS, OWNER_CONTROLLING_DEFECT)))
    validate_bundle(paths, bundle, live_repo=False, _expected_defects=defects)
    return {
        "bundle": bundle,
        "marker": "known-invalid-round5-f3",
        "defects": defects,
    }


def validate_known_invalid_round5_qa_review(paths: QaBundlePaths, review: Path) -> dict[str, Any]:
    """Validate the exact sealed round-5 rejection used by round 6."""
    review = review.resolve()
    manifest = review.parent / "qa-review.manifest.json"
    if (
        sha256_file(review) != ROUND5_REVIEW_SHA256
        or sha256_file(manifest) != ROUND5_REVIEW_MANIFEST_SHA256
    ):
        raise RuntimeError("round-5 F3 review pin mismatch")
    result = validate_sealed_qa_review(paths, 
        review,
        5,
        bundle_validator=lambda bundle: validate_known_invalid_round5_bundle(paths, bundle),
    )
    validate_content(paths, "review-output-v1", review, "qa-review")
    if (
        review.read_text("utf-8").splitlines()[-1] != "VERDICT: CHANGES_REQUESTED"
        or open_blocker_ids(review) != ("F3",)
    ):
        raise RuntimeError("round-5 F3 review verdict/open-blocker mismatch")
    result["marker"] = "known-invalid-round5-f3"
    return result


def validate_rejected_review_identity(
    review: Path,
    expected_path: Path,
    expected_digest: str,
    expected_open_ids: tuple[str, ...],
    expected_token: str,
    expected_fingerprint: str,
) -> Path:
    """Validate the independent path, digest, verdict, blocker, and marker dimensions."""
    raw_review = review
    review = review.resolve()
    if (
        raw_review.is_symlink()
        or review != expected_path.resolve()
        or not review.is_file()
        or sha256_file(review) != expected_digest
    ):
        raise RuntimeError("rejected QA review path/digest mismatch")
    text = review.read_text("utf-8")
    if (
        text.splitlines()[-1] != "VERDICT: CHANGES_REQUESTED"
        or open_blocker_ids(review) != expected_open_ids
        or expected_token not in text
        or expected_fingerprint not in text
    ):
        raise RuntimeError("rejected QA review verdict/open-blocker/marker mismatch")
    return review


def validate_rejected_round6_qa_review(paths: QaBundlePaths, review: Path) -> dict[str, Any]:
    """Validate the exact unsealed round-6 F4/F5 rejection used by round 7."""
    raw_review = review
    review = review.resolve()
    bundle = paths.evidence_root.resolve() / "qa-v9-finalization-round-6"
    adoption = bundle / "adoption-manifest.json"
    token_file = bundle / "combined-candidate-token.json"
    decision = bundle / "owner-decision.md"
    if (
        raw_review.is_symlink()
        or review != paths.round6_review.resolve()
        or not review.is_file()
        or bundle.parent != paths.evidence_root.resolve()
        or not bundle.is_dir()
        or bundle.is_symlink()
    ):
        raise RuntimeError("round-6 F4/F5 review path/namespace mismatch")
    if (
        sha256_file(adoption) != ROUND6_ADOPTION_SHA256
        or sha256_file(token_file) != ROUND6_TOKEN_FILE_SHA256
        or load_canonical_file(token_file).get("token") != ROUND6_TOKEN
        or sha256_file(decision) != ROUND6_DECISION_SHA256
    ):
        raise RuntimeError("round-6 F4/F5 predecessor pin mismatch")
    if (
        (bundle / "qa-review.manifest.json").exists()
        or (bundle / "qa-review.round-6.md").exists()
    ):
        raise RuntimeError("round-6 F4/F5 review must remain unsealed")
    validate_bundle(paths, bundle, live_repo=False)
    adoption_value = load_canonical_file(adoption)
    if adoption_value.get("worktree_digest") != ROUND6_FINGERPRINT:
        raise RuntimeError("round-6 F4/F5 fingerprint mismatch")
    validate_content(paths, "review-output-v1", review, "qa-review")
    validate_rejected_review_identity(
        review,
        paths.round6_review,
        ROUND6_REVIEW_SHA256,
        ("F4", "F5"),
        ROUND6_TOKEN,
        ROUND6_FINGERPRINT,
    )
    candidate = load_canonical_file(bundle / "candidate-state.json")
    return {
        "review": review,
        "bundle": bundle,
        "adoption": adoption,
        "candidate": candidate,
        "marker": "rejected-round6-f4-f5",
    }


def absolute_path(value: str) -> Path:
    """Parse one CLI path argument to an absolute Path (no symlink resolution)."""
    path = Path(value)
    return path if path.is_absolute() else Path(os.path.abspath(value))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--expected-root",
        type=absolute_path,
        required=True,
        help="absolute path of the dedicated M2-11 worktree",
    )
    parser.add_argument(
        "--orchestrate",
        type=absolute_path,
        required=True,
        help="absolute path of the orchestrate.sh entrypoint",
    )
    parser.add_argument(
        "--evidence-root",
        type=absolute_path,
        required=True,
        help="absolute path of the M2-11 evidence root",
    )
    parser.add_argument(
        "--snapshot",
        type=absolute_path,
        required=True,
        help="absolute path of the pinned institutional source snapshot",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    run_p = sub.add_parser("run")
    run_p.add_argument(
        "--cycle",
        choices=(
            "finalization",
            "finalization-exception",
            "finalization-repair-exception",
            "finalization-f3-exception",
            "finalization-f4-f5-exception",
            "finalization-release-hygiene-exception",
            "finalization-release-hygiene-f1-exception",
            "finalization-closeout-exception",
        ),
        required=True,
    )
    run_p.add_argument("--round", type=int, required=True)
    run_p.add_argument("--final-docs-commit", type=Path, required=True)
    run_p.add_argument("--output", type=Path, required=True)
    run_p.add_argument("--prior-review", type=Path)
    run_p.add_argument("--prior-docs-review", type=Path)
    run_p.add_argument("--prior-gate-bundle", type=Path)
    run_p.add_argument("--resolution-notes", type=Path)
    val_p = sub.add_parser("validate")
    val_p.add_argument("--bundle", type=Path, required=True)
    val_p.add_argument("--no-live", action="store_true")
    seal_p = sub.add_parser("seal-review")
    seal_p.add_argument("--bundle", type=Path, required=True)
    seal_p.add_argument("--review", type=Path, required=True)
    docs_p = sub.add_parser("seal-docs")
    docs_p.add_argument("--bundle", type=Path, required=True)
    docs_p.add_argument("--qa-review", type=Path, required=True)
    docs_p.add_argument("--final-docs-commit", type=Path, required=True)
    docs_p.add_argument("--attempt", type=int, required=True)
    docs_p.add_argument("--prior-docs-review", type=Path)
    docs_p.add_argument("--resolution-notes", type=Path)
    docs_p.add_argument("--output", type=Path, required=True)
    docs_review_p = sub.add_parser("seal-docs-review")
    docs_review_p.add_argument("--docs-bundle", type=Path, required=True)
    docs_review_p.add_argument("--review", type=Path, required=True)
    release_p = sub.add_parser("validate-release")
    release_p.add_argument("--docs-bundle", type=Path, required=True)
    release_p.add_argument("--mode", choices=("pre-stage", "post-stage"), required=True)
    args = parser.parse_args(argv)
    paths = QaBundlePaths(
        expected_root=args.expected_root,
        orchestrate=args.orchestrate,
        evidence_root=args.evidence_root,
        snapshot=args.snapshot,
    )
    try:
        if args.command == "validate":
            validate_bundle(paths, args.bundle, live_repo=not args.no_live)
            token = json.loads((args.bundle / "combined-candidate-token.json").read_text())["token"]
            print(f"VALID {token}")
            return 0
        if args.command == "run":
            exception_retry = args.cycle == "finalization-exception"
            repair_exception = args.cycle == "finalization-repair-exception"
            f3_exception = args.cycle == "finalization-f3-exception"
            f4_f5_exception = args.cycle == "finalization-f4-f5-exception"
            release_hygiene_exception = (
                args.cycle == "finalization-release-hygiene-exception"
            )
            release_hygiene_f1_exception = (
                args.cycle == "finalization-release-hygiene-f1-exception"
            )
            closeout_exception = args.cycle == "finalization-closeout-exception"
            if closeout_exception:
                if args.round != 10:
                    raise RuntimeError("closeout exception QA round must be exactly 10")
                cycle_plan = FINALIZATION_CLOSEOUT_PLAN
                cycle_decision = FINALIZATION_CLOSEOUT_DECISION
                cycle_scope = FINALIZATION_CLOSEOUT_EXCEPTION_SCOPE
                allowed_rounds = (10,)
                qa_round_cap = 10
                qa_round_override = True
                run_id = "RUN-M2-11-QA-finalization-closeout-exception"
            elif release_hygiene_f1_exception:
                if args.round != 9:
                    raise RuntimeError(
                        "release-hygiene F1 exception QA round must be exactly 9"
                    )
                cycle_plan = FINALIZATION_RELEASE_HYGIENE_F1_PLAN
                cycle_decision = FINALIZATION_RELEASE_HYGIENE_F1_DECISION
                cycle_scope = FINALIZATION_RELEASE_HYGIENE_F1_EXCEPTION_SCOPE
                allowed_rounds = (9,)
                qa_round_cap = 9
                qa_round_override = True
                run_id = "RUN-M2-11-QA-finalization-release-hygiene-F1-exception"
            elif release_hygiene_exception:
                if args.round != 8:
                    raise RuntimeError(
                        "release-hygiene exception QA round must be exactly 8"
                    )
                cycle_plan = FINALIZATION_RELEASE_HYGIENE_PLAN
                cycle_decision = FINALIZATION_RELEASE_HYGIENE_DECISION
                cycle_scope = FINALIZATION_RELEASE_HYGIENE_EXCEPTION_SCOPE
                allowed_rounds = (8,)
                qa_round_cap = 8
                qa_round_override = True
                run_id = "RUN-M2-11-QA-finalization-release-hygiene-exception"
            elif f4_f5_exception:
                if args.round != 7:
                    raise RuntimeError("F4/F5 exception QA round must be exactly 7")
                cycle_plan = FINALIZATION_F4_F5_PLAN
                cycle_decision = FINALIZATION_F4_F5_DECISION
                cycle_scope = FINALIZATION_F4_F5_EXCEPTION_SCOPE
                allowed_rounds = (7,)
                qa_round_cap = 7
                qa_round_override = True
                run_id = "RUN-M2-11-QA-finalization-f4-f5-exception"
            elif f3_exception:
                if args.round != 6:
                    raise RuntimeError("F3 exception QA round must be exactly 6")
                cycle_plan = FINALIZATION_F3_PLAN
                cycle_decision = FINALIZATION_F3_DECISION
                cycle_scope = FINALIZATION_F3_EXCEPTION_SCOPE
                allowed_rounds = (6,)
                qa_round_cap = 6
                qa_round_override = True
                run_id = "RUN-M2-11-QA-finalization-f3-exception"
            elif repair_exception:
                if args.round != 5:
                    raise RuntimeError("repair exception QA round must be exactly 5")
                cycle_plan = FINALIZATION_REPAIR_PLAN
                cycle_decision = FINALIZATION_REPAIR_DECISION
                cycle_scope = FINALIZATION_REPAIR_EXCEPTION_SCOPE
                allowed_rounds = (5,)
                qa_round_cap = 5
                qa_round_override = True
                run_id = "RUN-M2-11-QA-finalization-repair-exception"
            elif exception_retry:
                if args.round != 4:
                    raise RuntimeError("exception QA round must be exactly 4")
                cycle_plan = FINALIZATION_EXCEPTION_PLAN
                cycle_decision = FINALIZATION_EXCEPTION_DECISION
                cycle_scope = FINALIZATION_RETRY_EXCEPTION_SCOPE
                allowed_rounds = (4,)
                qa_round_cap = 4
                qa_round_override = True
                run_id = "RUN-M2-11-QA-finalization-exception"
            else:
                if args.round not in (1, 2, 3):
                    raise RuntimeError("finalization QA round must be 1, 2, or 3")
                cycle_plan = FINALIZATION_PLAN
                cycle_decision = FINALIZATION_DECISION
                cycle_scope = FINALIZATION_EXCEPTION_SCOPE
                allowed_rounds = (1, 2, 3)
                qa_round_cap = 3
                qa_round_override = False
                run_id = "RUN-M2-11-QA-finalization"
            validate_content(paths, "plan-v1", paths.expected_root / cycle_plan, "plan")
            if release_hygiene_exception or release_hygiene_f1_exception or closeout_exception:
                validate_failed_gate_artifact(paths, 
                    paths.expected_root / cycle_decision,
                    "owner-decision-v2",
                )
            validate_content(paths, "dev-notes-v1", paths.expected_root / DEV_NOTES, "dev")
            docs_attempt = next_finalization_docs_attempt(paths)
            final_commit_arg = args.final_docs_commit
            final_commit = final_commit_arg.resolve()
            expected_message = re.fullmatch(
                rf"final-docs-commit\.finalization-r{args.round}-a([1-3])\.md",
                final_commit.name,
            )
            if (
                final_commit_arg.is_symlink()
                or not final_commit.is_file()
                or final_commit.parent != paths.evidence_root.resolve()
                or expected_message is None
                or int(expected_message.group(1)) != docs_attempt
            ):
                raise RuntimeError("finalization message path/round/global attempt is invalid")
            validate_content(paths, "docs-commit-v1", final_commit, "docs-commit")
            predecessor_count = sum(
                value is not None
                for value in (args.prior_review, args.prior_docs_review, args.prior_gate_bundle)
            )
            if predecessor_count > 1 or (predecessor_count == 0) != (args.resolution_notes is None):
                raise RuntimeError("exactly one prior review and resolution notes must be paired")
            if args.round == 1 and predecessor_count:
                raise RuntimeError("round 1 cannot have prior-round inputs")
            if args.round > 1 and predecessor_count != 1:
                raise RuntimeError("delta round requires one exact predecessor and resolution notes")
            if exception_retry and (
                args.prior_gate_bundle is None
                or args.prior_review is not None
                or args.prior_docs_review is not None
            ):
                raise RuntimeError("exception round 4 requires only the failed round-3 gate bundle")
            if repair_exception and (
                args.prior_review is None
                or args.prior_gate_bundle is not None
                or args.prior_docs_review is not None
            ):
                raise RuntimeError("repair exception round 5 requires only the sealed round-4 QA review")
            if f3_exception and (
                args.prior_review is None
                or args.prior_gate_bundle is not None
                or args.prior_docs_review is not None
            ):
                raise RuntimeError("F3 exception round 6 requires only the sealed round-5 QA review")
            if f4_f5_exception and (
                args.prior_review is None
                or args.prior_gate_bundle is not None
                or args.prior_docs_review is not None
            ):
                raise RuntimeError(
                    "F4/F5 exception round 7 requires only the exact unsealed round-6 QA review"
                )
            if release_hygiene_exception and (
                args.prior_docs_review is None
                or args.prior_review is not None
                or args.prior_gate_bundle is not None
            ):
                raise RuntimeError(
                    "release-hygiene round 8 requires only the exact sealed round-7 docs approval"
                )
            if release_hygiene_f1_exception and (
                args.prior_review is None
                or args.prior_gate_bundle is not None
                or args.prior_docs_review is not None
            ):
                raise RuntimeError(
                    "release-hygiene F1 round 9 requires only the exact sealed round-8 QA rejection"
                )
            if closeout_exception and (
                args.prior_gate_bundle is None
                or args.prior_review is not None
                or args.prior_docs_review is not None
            ):
                raise RuntimeError(
                    "closeout round 10 requires only the exact failed round-9 gate bundle"
                )
            predecessor: dict[str, Any] | None = None
            if args.prior_review:
                predecessor = (
                    validate_release_hygiene_f1_predecessor(paths, args.prior_review)
                    if release_hygiene_f1_exception
                    else (
                        validate_rejected_round6_qa_review(paths, args.prior_review)
                        if f4_f5_exception
                        else (
                            validate_known_invalid_round5_qa_review(paths, args.prior_review)
                            if f3_exception
                            else validate_sealed_qa_review(paths, args.prior_review, args.round - 1)
                        )
                    )
                )
                prior_review = predecessor["review"]
                if prior_review.read_text("utf-8").splitlines()[-1] != "VERDICT: CHANGES_REQUESTED":
                    raise RuntimeError("QA predecessor must be CHANGES_REQUESTED")
                predecessor["phase"] = "qa"
            elif args.prior_docs_review:
                if docs_attempt <= 1:
                    raise RuntimeError("docs predecessor must advance the global docs attempt")
                attempts = finalization_docs_attempts(paths)
                predecessor = (
                    validate_release_hygiene_predecessor(paths, args.prior_docs_review)
                    if release_hygiene_exception
                    else validate_sealed_docs_review(paths, 
                        args.prior_docs_review, docs_attempt - 1
                    )
                )
                if attempts.get(docs_attempt - 1) != (predecessor["round"], predecessor["review"].parent):
                    raise RuntimeError("docs predecessor is not the exact prior global attempt")
                if predecessor["round"] != args.round - 1:
                    raise RuntimeError("docs-originating repo repair must advance exactly one QA round")
                prior_review = predecessor["review"]
                expected_docs_verdict = (
                    "VERDICT: APPROVED"
                    if release_hygiene_exception
                    else "VERDICT: CHANGES_REQUESTED"
                )
                if prior_review.read_text("utf-8").splitlines()[-1] != expected_docs_verdict:
                    raise RuntimeError(
                        "docs predecessor verdict does not match cycle authority"
                    )
                predecessor["phase"] = "docs"
            elif args.prior_gate_bundle:
                predecessor = validate_failed_gate_bundle(paths, args.prior_gate_bundle, args.round - 1)
                predecessor["phase"] = "gate"
            if predecessor is not None:
                resolution_arg = args.resolution_notes
                resolution_notes = resolution_arg.resolve()
                if not resolution_notes.is_file() or resolution_arg.is_symlink():
                    raise RuntimeError("resolution notes are missing/nonregular")
                if f4_f5_exception and (
                    resolution_notes.parent != paths.evidence_root.resolve()
                    or resolution_notes.name
                    != "resolution-notes.finalization-r6-qa.md"
                ):
                    raise RuntimeError("F4/F5 resolution path is not exact")
                if release_hygiene_exception:
                    validate_release_hygiene_resolution(paths, resolution_notes)
                elif release_hygiene_f1_exception:
                    validate_release_hygiene_f1_resolution(paths, resolution_notes)
                elif closeout_exception:
                    validate_finalization_closeout_resolution(paths, resolution_notes)
                    validate_gate_resolution_notes(paths, predecessor, resolution_notes)
                elif predecessor["phase"] == "gate":
                    validate_gate_resolution_notes(paths, predecessor, resolution_notes)
                else:
                    validate_resolution_notes(paths, prior_review, resolution_notes)
            state = validate_fixed_state(paths, 
                paths.expected_root,
                args.round,
                EXPECTED_QA_PATHS,
                allowed_rounds,
            )
            state.update({
                "cycle": args.cycle,
                "plan": cycle_plan,
                "owner_decision": cycle_decision,
                "task_digest": PINNED_DIGESTS[cycle_plan],
                "run_id": run_id,
                "exception_scope": cycle_scope,
                "qa_round_cap": qa_round_cap,
                "qa_round_override": qa_round_override,
                "final_docs_commit": final_commit,
                "docs_attempt": docs_attempt,
            })
            if predecessor is not None and predecessor["phase"] != "gate":
                state["prior_review"] = predecessor["review"]
                if f4_f5_exception:
                    state["prior_bundle_adoption"] = predecessor["adoption"]
                else:
                    state["prior_review_manifest"] = predecessor["manifest"]
                state["prior_review_phase"] = predecessor["phase"]
                state["resolution_notes"] = args.resolution_notes.resolve()
            elif predecessor is not None:
                state["prior_gate_artifacts"] = predecessor["artifacts"]
                state["prior_gate_round"] = predecessor["round"]
                state["resolution_notes"] = args.resolution_notes.resolve()
            output = args.output.resolve()
            if output.parent != paths.evidence_root.resolve() or output.name != f"qa-v9-finalization-round-{args.round}":
                raise RuntimeError("finalization QA output path is not the exact round namespace")
            if not output.parent.is_dir() or output.parent.is_symlink():
                raise RuntimeError("finalization QA output parent is invalid")
            approved_record = compute_approved_tree(state)
            output.mkdir(mode=0o700)
            artifacts = write_origin_artifacts(paths, state, output)
            records: list[dict[str, Any]] = []
            for gate in GATES:
                record = run_gate(paths, gate, state, output)
                records.append(record)
                if record["exit_code"] != 0:
                    write_gate_artifacts(paths, records, state, output)
            artifacts.update(write_gate_artifacts(paths, records, state, output))
            validate_candidate_fingerprint(paths, state["repo"], state["fingerprint"])
            tree_oid = write_approved_tree(approved_record, output)
            artifacts["approved-tree.json"] = output / "approved-tree.json"
            if not tree_oid:
                raise RuntimeError("approved tree OID missing")
            artifacts.update(write_markdown_artifacts(paths, state, artifacts, output))
            artifacts.update(write_candidate_and_token(state, artifacts, output))
            artifacts.update(write_phase_and_adoption_manifests(paths, state, artifacts, output))
            validate_bundle(paths, output)
            token = json.loads(artifacts["combined-candidate-token.json"].read_text())["token"]
            print(f"BUNDLE {output}\nTOKEN {token}")
            return 0
        if args.command == "seal-review":
            validate_bundle(paths, args.bundle)
            review = args.review.resolve()
            if not review.is_file() or args.review.is_symlink():
                raise RuntimeError("QA review is missing/nonregular")
            validate_content(paths, "review-output-v1", review, "qa-review")
            adoption = load_canonical_file(args.bundle / "adoption-manifest.json")
            target = args.bundle / f"qa-review.round-{adoption['round']}.md"
            path = args.bundle / "qa-review.manifest.json"
            if target.exists() or target.is_symlink() or path.exists() or path.is_symlink():
                raise RuntimeError("QA review output or manifest already exists")
            review_bytes = review.read_bytes()
            review_digest = "sha256:" + hashlib.sha256(review_bytes).hexdigest()
            base_inputs = load_canonical_file(args.bundle / "qa-review-input.manifest.json")["inputs"]
            base_inputs += [{"name": "adoption-manifest", "path": str((args.bundle / "adoption-manifest.json").resolve()), "digest": "sha256:" + sha256_file(args.bundle / "adoption-manifest.json"), "schema": "adoption-qa-manifest/v1", "required": True}]
            manifest = {"schema_version": "m2-11-phase-manifest/v1", "phase": "qa-review", "round": adoption["round"], "base_ref": adoption["base_ref"], "worktree_digest": adoption["worktree_digest"], "output": {"name": "qa-review", "path": str(target), "digest": review_digest, "schema": "review-output-v1", "required": True}, "inputs": sorted(base_inputs, key=lambda item: os.fsencode(item["name"]))}
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as handle:
                handle.write(review_bytes)
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as handle:
                handle.write(canonical_json_bytes(manifest))
            print(f"SEALED {path}")
            return 0
        if args.command == "seal-docs":
            validate_bundle(paths, args.bundle)
            review = args.qa_review.resolve()
            adoption = load_canonical_file(args.bundle / "adoption-manifest.json")
            adoption_records = {
                item["name"]: item for item in adoption.get("artifacts", [])
            }
            adoption_plan_digest = adoption_records.get("plan.md", {}).get("digest")
            release_hygiene_f1_docs = (
                adoption_plan_digest
                == "sha256:" + PINNED_DIGESTS[FINALIZATION_RELEASE_HYGIENE_F1_PLAN]
            )
            closeout_docs = (
                adoption_plan_digest
                == "sha256:" + PINNED_DIGESTS[FINALIZATION_CLOSEOUT_PLAN]
            )
            release_hygiene_docs = release_hygiene_f1_docs or closeout_docs or (
                adoption_plan_digest
                == "sha256:" + PINNED_DIGESTS[FINALIZATION_RELEASE_HYGIENE_PLAN]
            )
            attempts = finalization_docs_attempts(paths)
            if args.attempt != next_finalization_docs_attempt(paths):
                raise RuntimeError("docs attempt is not the next global finalization attempt")
            if (args.prior_docs_review is None) != (args.resolution_notes is None):
                raise RuntimeError("prior docs review and resolution notes must be paired")
            if args.attempt == 1 and args.prior_docs_review is not None:
                raise RuntimeError("docs attempt 1 cannot have prior-attempt inputs")
            if args.attempt > 1 and args.prior_docs_review is None:
                raise RuntimeError("docs attempt 2/3 requires prior review and resolution notes")
            sealed_review = (args.bundle / f"qa-review.round-{adoption['round']}.md").resolve()
            sealed_manifest_path = (args.bundle / "qa-review.manifest.json").resolve()
            if review != sealed_review or not sealed_manifest_path.is_file() or sealed_manifest_path.is_symlink():
                raise RuntimeError("docs seal requires the bundle's candidate-bound sealed QA review and manifest")
            validate_content(paths, "review-output-v1", review, "qa-review")
            if review.read_text().splitlines()[-1] != "VERDICT: APPROVED":
                raise RuntimeError("docs seal requires approved QA review")

            review_input = load_canonical_file((args.bundle / "qa-review-input.manifest.json").resolve())
            review_input_records = {item["name"]: item for item in review_input["inputs"]}
            if len(review_input_records) != len(review_input["inputs"]) or "candidate-state" not in review_input_records:
                raise RuntimeError("QA review input lacks one exact candidate-state record")
            candidate = load_canonical_file(Path(review_input_records["candidate-state"]["path"]))
            if candidate.get("docs_attempt") not in (1, 2, 3) or candidate["docs_attempt"] > args.attempt:
                raise RuntimeError("QA candidate global docs attempt is incompatible with seal request")
            adoption_record = {
                "name": "adoption-manifest",
                "path": str((args.bundle / "adoption-manifest.json").resolve()),
                "digest": "sha256:" + sha256_file(args.bundle / "adoption-manifest.json"),
                "schema": "adoption-qa-manifest/v1",
                "required": True,
            }
            expected_review_manifest = {
                "schema_version": "m2-11-phase-manifest/v1",
                "phase": "qa-review",
                "round": adoption["round"],
                "base_ref": adoption["base_ref"],
                "worktree_digest": adoption["worktree_digest"],
                "output": {
                    "name": "qa-review",
                    "path": str(review),
                    "digest": "sha256:" + sha256_file(review),
                    "schema": "review-output-v1",
                    "required": True,
                },
                "inputs": sorted([*review_input["inputs"], adoption_record], key=lambda item: os.fsencode(item["name"])),
            }
            sealed_manifest = load_canonical_file(sealed_manifest_path)
            if sealed_manifest != expected_review_manifest:
                raise RuntimeError("sealed QA-review manifest is not the exact candidate-bound manifest")
            for item in sealed_manifest["inputs"]:
                path = Path(item["path"])
                if not path.is_file() or path.is_symlink() or item["digest"] != "sha256:" + sha256_file(path):
                    raise RuntimeError("sealed QA-review manifest input is missing or stale")
            final_commit_arg = args.final_docs_commit
            final_commit = final_commit_arg.resolve()
            expected_message_name = f"final-docs-commit.finalization-r{adoption['round']}-a{args.attempt}.md"
            if (
                final_commit_arg.is_symlink()
                or not final_commit.is_file()
                or final_commit.parent != paths.evidence_root.resolve()
                or final_commit.name != expected_message_name
            ):
                raise RuntimeError("final docs-commit path does not match QA round/docs attempt")
            validate_content(paths, "docs-commit-v1", final_commit, "docs-commit")
            output = args.output.resolve()
            expected_output_name = f"docs-v9-finalization-r{adoption['round']}-a{args.attempt}"
            if output.exists() or output.is_symlink():
                raise RuntimeError("docs output already exists")
            if output.parent != paths.evidence_root.resolve() or output.name != expected_output_name:
                raise RuntimeError("docs output path does not match QA round/docs attempt")
            if not output.parent.is_dir() or output.parent.is_symlink():
                raise RuntimeError("docs output parent must already be a regular directory")
            prior_docs_inputs: list[dict[str, Any]] = []
            if args.prior_docs_review:
                resolution_notes = args.resolution_notes.resolve()
                if not resolution_notes.is_file() or resolution_notes.is_symlink():
                    raise RuntimeError("prior docs review/resolution path is invalid")
                predecessor = (
                    validate_release_hygiene_predecessor(paths, args.prior_docs_review)
                    if release_hygiene_docs
                    else validate_sealed_docs_review(paths, 
                        args.prior_docs_review, args.attempt - 1
                    )
                )
                prior_docs_review = predecessor["review"]
                prior_manifest_path = predecessor["manifest"]
                if attempts.get(args.attempt - 1) != (predecessor["round"], prior_docs_review.parent):
                    raise RuntimeError("prior docs review is not the exact prior global attempt")
                same_candidate = predecessor["adoption_record"] == adoption_record
                if same_candidate:
                    if (
                        predecessor["round"] != adoption["round"]
                        or predecessor["input"].get("base_ref") != adoption["base_ref"]
                        or predecessor["input"].get("worktree_digest") != adoption["worktree_digest"]
                    ):
                        raise RuntimeError("prior docs review contradicts the current candidate")
                else:
                    prior = adoption.get("prior_round")
                    if closeout_docs:
                        if (
                            predecessor["round"] != 7
                            or adoption["round"] != 10
                            or candidate["docs_attempt"] != args.attempt
                            or not isinstance(prior, dict)
                            or set(prior)
                            != {"kind", "round", "artifacts", "resolution-notes"}
                            or prior.get("kind") != "gate-failure"
                            or prior.get("round") != 9
                        ):
                            raise RuntimeError(
                                "prior docs approval is not transitively bound by the closeout candidate"
                            )
                        ledger_records = [
                            item
                            for item in prior["artifacts"]
                            if item.get("name") == "prior-gate-gate-ledger.json"
                        ]
                        if len(ledger_records) != 1:
                            raise RuntimeError("closeout candidate lacks exact round-9 ledger")
                        validate_failed_gate_bundle(paths, 
                            Path(ledger_records[0]["path"]).parent, 9
                        )
                        validate_finalization_closeout_resolution(paths, 
                            Path(prior["resolution-notes"]["path"])
                        )
                    elif release_hygiene_f1_docs:
                        if (
                            predecessor["round"] != 7
                            or adoption["round"] != 9
                            or candidate["docs_attempt"] != args.attempt
                            or not isinstance(prior, dict)
                            or set(prior)
                            != {"prior-qa-review", "prior-review-manifest", "resolution-notes"}
                        ):
                            raise RuntimeError(
                                "prior docs approval is not transitively bound by the F1 QA candidate"
                            )
                        validate_release_hygiene_f1_predecessor(paths, 
                            Path(prior["prior-qa-review"]["path"])
                        )
                    elif (
                        predecessor["round"] != adoption["round"] - 1
                        or candidate["docs_attempt"] != args.attempt
                        or not isinstance(prior, dict)
                        or set(prior) != {"prior-docs-review", "prior-review-manifest", "resolution-notes"}
                        or Path(prior["prior-docs-review"]["path"]).resolve() != prior_docs_review
                        or Path(prior["prior-review-manifest"]["path"]).resolve() != prior_manifest_path.resolve()
                    ):
                        raise RuntimeError("prior docs review is not bound by the repaired QA candidate")
                expected_prior_verdict = (
                    "VERDICT: APPROVED"
                    if release_hygiene_docs
                    else "VERDICT: CHANGES_REQUESTED"
                )
                if prior_docs_review.read_text("utf-8").splitlines()[-1] != expected_prior_verdict:
                    raise RuntimeError(
                        "next docs attempt predecessor verdict contradicts cycle authority"
                    )
                if release_hygiene_docs:
                    validate_release_hygiene_resolution(paths, resolution_notes)
                else:
                    validate_resolution_notes(paths, prior_docs_review, resolution_notes)
                prior_docs_inputs.extend((
                    {"name": "prior-docs-review", "path": str(prior_docs_review), "digest": "sha256:" + sha256_file(prior_docs_review), "schema": "review-output-v1", "required": True},
                    {"name": "docs-resolution-notes", "path": str(resolution_notes), "digest": "sha256:" + sha256_file(resolution_notes), "schema": "resolution-notes-v1", "required": True},
                    {"name": "prior-docs-review-manifest", "path": str(prior_manifest_path.resolve()), "digest": "sha256:" + sha256_file(prior_manifest_path), "schema": "m2-11-phase-manifest/v1", "required": True},
                ))
            docs_state = dict(
                validate_fixed_state(paths, 
                    paths.expected_root,
                    adoption["round"],
                    EXPECTED_RELEASE_PATHS,
                    (adoption["round"],),
                )
            )
            final_fp = docs_state["fingerprint"]
            approved_record = compute_approved_tree(docs_state)
            output.mkdir(mode=0o700)
            inputs = list(review_input["inputs"])
            inputs += [
                adoption_record,
                {"name": "qa-review", "path": str(review), "digest": "sha256:" + sha256_file(review), "schema": "review-output-v1", "required": True},
                {"name": "qa-review-manifest", "path": str(sealed_manifest_path), "digest": "sha256:" + sha256_file(sealed_manifest_path), "schema": "m2-11-phase-manifest/v1", "required": True},
                {"name": "final-docs-commit", "path": str(final_commit), "digest": "sha256:" + sha256_file(final_commit), "schema": "docs-commit-v1", "required": True},
            ]
            inputs += prior_docs_inputs
            tree_oid = write_approved_tree(approved_record, output)
            tree_path = output / "approved-tree.json"
            inputs.append({"name": "final-docs-tree", "path": str(tree_path), "digest": "sha256:" + sha256_file(tree_path), "schema": "approved-tree/v1", "required": True})
            output_artifact = {"name": "final-docs-tree", "path": str(tree_path), "digest": "sha256:" + sha256_file(tree_path), "schema": "approved-tree/v1", "required": True}
            manifest = {"schema_version": "m2-11-phase-manifest/v1", "phase": "docs-review-input", "round": adoption["round"], "attempt": args.attempt, "base_ref": adoption["base_ref"], "worktree_digest": final_fp, "output": output_artifact, "inputs": sorted(inputs, key=lambda item: os.fsencode(item["name"]))}
            path = output / "docs-review-input.manifest.json"
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as handle:
                handle.write(canonical_json_bytes(manifest))
            print(f"SEALED {path}\nTREE {tree_oid}")
            return 0
        if args.command == "seal-docs-review":
            docs_bundle = args.docs_bundle.resolve()
            match = re.fullmatch(r"docs-v9-finalization-r(10|[1-9])-a([1-3])", docs_bundle.name)
            if docs_bundle.parent != paths.evidence_root.resolve() or match is None:
                raise RuntimeError("docs bundle is outside the exact finalization namespace")
            review_input_path = docs_bundle / "docs-review-input.manifest.json"
            review_input = load_canonical_file(review_input_path)
            round_no, attempt = int(match.group(1)), int(match.group(2))
            if (
                review_input.get("phase") != "docs-review-input"
                or review_input.get("round") != round_no
                or review_input.get("attempt") != attempt
                or external_worktree_fingerprint(paths, paths.expected_root) != review_input.get("worktree_digest")
            ):
                raise RuntimeError("docs-review input manifest/live candidate mismatch")
            for item in review_input["inputs"]:
                item_path = Path(item["path"])
                if not item_path.is_file() or item_path.is_symlink() or item["digest"] != "sha256:" + sha256_file(item_path):
                    raise RuntimeError("docs-review input is missing or stale")
            review = args.review.resolve()
            if not review.is_file() or review.is_symlink():
                raise RuntimeError("docs review is missing/nonregular")
            validate_content(paths, "review-output-v1", review, "docs-review")
            target = docs_bundle / f"docs-review.attempt-{attempt}.md"
            manifest_path = docs_bundle / "docs-review.manifest.json"
            if target.exists() or target.is_symlink() or manifest_path.exists() or manifest_path.is_symlink():
                raise RuntimeError("docs review output already sealed")
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as handle:
                handle.write(review.read_bytes())
            manifest_input = {
                "name": "docs-review-input-manifest",
                "path": str(review_input_path.resolve()),
                "digest": "sha256:" + sha256_file(review_input_path),
                "schema": "m2-11-phase-manifest/v1",
                "required": True,
            }
            output_record = {
                "name": "docs-review",
                "path": str(target.resolve()),
                "digest": "sha256:" + sha256_file(target),
                "schema": "review-output-v1",
                "required": True,
            }
            manifest = {
                "schema_version": "m2-11-phase-manifest/v1",
                "phase": "docs-review",
                "round": round_no,
                "attempt": attempt,
                "base_ref": review_input["base_ref"],
                "worktree_digest": review_input["worktree_digest"],
                "output": output_record,
                "inputs": sorted([*review_input["inputs"], manifest_input], key=lambda item: os.fsencode(item["name"])),
            }
            fd = os.open(manifest_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as handle:
                handle.write(canonical_json_bytes(manifest))
            print(f"SEALED {manifest_path}")
            return 0
        if args.command == "validate-release":
            docs_bundle = args.docs_bundle.resolve()
            match = re.fullmatch(r"docs-v9-finalization-r(10|[1-9])-a([1-3])", docs_bundle.name)
            if docs_bundle.parent != paths.evidence_root.resolve() or match is None:
                raise RuntimeError("docs bundle is outside the exact finalization namespace")
            review_input_path = docs_bundle / "docs-review-input.manifest.json"
            review_manifest_path = docs_bundle / "docs-review.manifest.json"
            review_input = load_canonical_file(review_input_path)
            review_manifest = load_canonical_file(review_manifest_path)
            round_no, attempt = int(match.group(1)), int(match.group(2))
            if (
                review_input.get("phase") != "docs-review-input"
                or review_manifest.get("phase") != "docs-review"
                or review_input.get("round") != round_no
                or review_manifest.get("round") != round_no
                or review_input.get("attempt") != attempt
                or review_manifest.get("attempt") != attempt
                or review_manifest.get("base_ref") != review_input.get("base_ref")
                or review_manifest.get("worktree_digest") != review_input.get("worktree_digest")
            ):
                raise RuntimeError("docs review manifest graph identity mismatch")
            expected_manifest_input = {
                "name": "docs-review-input-manifest",
                "path": str(review_input_path.resolve()),
                "digest": "sha256:" + sha256_file(review_input_path),
                "schema": "m2-11-phase-manifest/v1",
                "required": True,
            }
            if review_manifest.get("inputs") != sorted([*review_input["inputs"], expected_manifest_input], key=lambda item: os.fsencode(item["name"])):
                raise RuntimeError("sealed docs review does not bind the exact input manifest")
            review_path = docs_bundle / f"docs-review.attempt-{attempt}.md"
            expected_output = {
                "name": "docs-review",
                "path": str(review_path.resolve()),
                "digest": "sha256:" + sha256_file(review_path),
                "schema": "review-output-v1",
                "required": True,
            }
            if review_manifest.get("output") != expected_output:
                raise RuntimeError("sealed docs review output mismatch")
            validate_content(paths, "review-output-v1", review_path, "docs-review")
            if review_path.read_text("utf-8").splitlines()[-1] != "VERDICT: APPROVED":
                raise RuntimeError("release requires an APPROVED sealed docs review")
            input_records = {item["name"]: item for item in review_input["inputs"]}
            if len(input_records) != len(review_input["inputs"]):
                raise RuntimeError("docs-review input contains duplicate names")
            for item in review_manifest["inputs"]:
                item_path = Path(item["path"])
                if not item_path.is_file() or item_path.is_symlink() or item["digest"] != "sha256:" + sha256_file(item_path):
                    raise RuntimeError("sealed docs-review input is missing or stale")
            for required_name in ("final-docs-commit", "final-docs-tree", "qa-review", "qa-review-manifest", "dev-notes", "qa-report", "changed-files", "baseline-diff"):
                if required_name not in input_records:
                    raise RuntimeError(f"docs-review input missing required typed artifact: {required_name}")
            if review_input.get("output") != input_records["final-docs-tree"]:
                raise RuntimeError("docs-review output is not the exact bound final docs tree")
            final_commit = Path(input_records["final-docs-commit"]["path"])
            validate_content(paths, "docs-commit-v1", final_commit, "docs-commit")
            approved_tree_path = Path(input_records["final-docs-tree"]["path"])
            approved_tree = load_canonical_file(approved_tree_path)
            if (
                approved_tree.get("schema_version") != "approved-tree/v1"
                or approved_tree.get("baseline_commit") != EXPECTED_HEAD
                or approved_tree.get("expected_paths") != list(EXPECTED_RELEASE_PATHS)
                or approved_tree.get("private_object_dir_removed") is not True
            ):
                raise RuntimeError("approved final docs tree contract mismatch")

            def git_text(*git_args: str) -> str:
                return run_checked(["git", *git_args], paths.expected_root).stdout.decode("utf-8").strip()

            if git_text("branch", "--show-current") != EXPECTED_BRANCH or git_text("rev-parse", "HEAD") != EXPECTED_HEAD:
                raise RuntimeError("release Git branch/HEAD drift")
            if git_text("rev-parse", "origin/main") != review_input["base_ref"] or review_input["base_ref"] != EXPECTED_BASE:
                raise RuntimeError("release base drift")
            if args.mode == "pre-stage":
                if git_text("diff", "--cached", "--name-only"):
                    raise RuntimeError("pre-stage release validation requires an empty index")
                if tuple(changed_paths(paths.expected_root)) != EXPECTED_RELEASE_PATHS:
                    raise RuntimeError("pre-stage release inventory drift")
                if external_worktree_fingerprint(paths, paths.expected_root) != review_input["worktree_digest"]:
                    raise RuntimeError("pre-stage live fingerprint differs from docs approval")
            else:
                if git_text("diff", "--name-only") or git_text("ls-files", "--others", "--exclude-standard"):
                    raise RuntimeError("post-stage release validation requires no unstaged/untracked paths")
                cached = tuple(sorted(git_text("diff", "--cached", "--name-only").splitlines(), key=os.fsencode))
                if cached != EXPECTED_RELEASE_PATHS:
                    raise RuntimeError("post-stage cached inventory drift")
                if git_text("write-tree") != approved_tree["tree_oid"]:
                    raise RuntimeError("post-stage cached tree differs from docs approval")
                run_checked(["git", "diff", "--cached", "--check"], paths.expected_root)
            print(f"VALID RELEASE {args.mode} {review_manifest['output']['digest']}")
            return 0
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
