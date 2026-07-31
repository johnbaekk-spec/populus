"""The RUN M2-6 acceptance command (R8): fully hermetic, it NEVER skips.

Unlike the M2-5 acceptance (which gates on the local 13(f)-list cache), the M2-6
acceptance drives a committed synthetic corpus through a fake transport, so this
pytest wrapper always runs the whole discover→rank→drive→finalize→build→publish→
install→serve chain and asserts a clean pass plus the measured figures.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_accept():
    # The acceptance imports tests/bulk_corpus; make it importable exactly as the
    # script does (it inserts tests/ on sys.path itself, but be explicit here too).
    sys.path.insert(0, str(REPO_ROOT / "tests"))
    spec = importlib.util.spec_from_file_location(
        "accept_m2_6", REPO_ROOT / "scripts" / "accept_m2_6.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_acceptance_passes_and_prints_measured_figures():
    accept = _load_accept()
    lines: list[str] = []
    rc = accept.run_acceptance(out=lines.append)
    output = "\n".join(lines)
    assert rc == 0, output
    # Measured evidence (not prose): the chain reached each stage.
    assert "13 refs" in output                          # discovery
    assert "survivor values match v_default oracle: yes" in output
    assert "top-5 = " in output                         # selection
    assert "5/5 filers loaded" in output                # coordinator
    assert "= 1.0000 | meets_threshold True" in output  # coverage gate
    assert "inst in manifest = True" in output          # admission
    assert "provenance: published-snapshot" in output   # served
    assert "with snapshot build_id" in output           # aggregate query
    assert "ZERO transport" in output                   # R13 resume proof
    assert "ACCEPTANCE PASSED" in output


def test_acceptance_ranking_matches_the_v_default_oracle_constants():
    # The acceptance's ranking oracle IS the six-topology expectation set; assert
    # the corpus wires the amendment cases the ranking rule must match.
    accept = _load_accept()
    from bulk_corpus import EXPECTED_EFFECTIVE

    assert EXPECTED_EFFECTIVE["0009100002"] == 500_000_000    # restatement wins
    assert EXPECTED_EFFECTIVE["0009100003"] == 350_000_000    # NH after restatement
    assert EXPECTED_EFFECTIVE["0009100004"] == 200_000_000    # NH before restatement
