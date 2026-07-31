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


def test_acceptance_report_names_a_non_empty_conflict_set(monkeypatch):
    """M2-7 §I5 / external review round 2 F3, surface 6 of 6: the M2-6
    acceptance prints a coverage number, so it must print what was tolerated and
    which filings were EXCLUDED to produce it — by `filing_id`.

    The committed synthetic corpus reconciles exactly, so its disposition set is
    empty and asserting on it would be the "empty-list key-presence test" the
    reviewer rejected. Instead the REAL coverage the run computes is passed
    through `dataclasses.replace` on its way out of the ingest, giving the
    surface a genuinely non-empty conflict set while every measured figure, the
    gate decision and the published manifest stay exactly as computed.

    Mutation guard: deleting the `disposition_line` line from
    `accept_m2_6.run_acceptance` fails the last two assertions.
    """
    import dataclasses

    accept = _load_accept()
    import populus.inst_bulk as ib

    real_run = ib.run_bulk_ingest

    def _with_dispositions(*args, **kwargs):
        report = real_run(*args, **kwargs)
        report.coverage = dataclasses.replace(
            report.coverage,
            cover_rounding_count=2,
            cover_rounding_max_delta_usd=999,
            cover_conflict_filing_ids=("inst:ACC-CONFLICT",),
        )
        return report

    monkeypatch.setattr(ib, "run_bulk_ingest", _with_dispositions)

    lines: list[str] = []
    rc = accept.run_acceptance(out=lines.append)
    output = "\n".join(lines)

    assert rc == 0, output                                   # figures unchanged
    assert "= 1.0000 | meets_threshold True" in output
    assert "cover_conflict EXCLUDED 1: inst:ACC-CONFLICT" in output
    assert "cover_rounding 2 (max delta 999)" in output
