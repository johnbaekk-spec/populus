"""The RUN M1-B Phase A acceptance command (R11/R16): hermetic, never skips.

Like the M2-6 acceptance, this drives committed fixtures through fake
transports, so the wrapper always runs the whole chain and asserts a clean pass
plus the measured figures. Unlike it, the acceptance deliberately does NOT
require the fixtures to meet ≥97% — a below-gate era is a surfaced decision, not
a build failure — so the substrings below check the chain and the gate
*behaviour*, including both crafted non-passing eras.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_accept():
    sys.path.insert(0, str(REPO_ROOT / "tests"))
    spec = importlib.util.spec_from_file_location(
        "accept_m1_b", REPO_ROOT / "scripts" / "acceptance" / "congress_history.py"
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

    # Measured evidence (not prose), stage by stage.
    assert "house 2015: index PTRs 6" in output          # the committed index
    assert "checkpoint-first sidecars" in output         # R2 provenance
    assert "1 missing + 1 corrupt archive refetched exactly once each" in output
    assert "ZERO transport" in output                    # R3 fresh-db resume
    assert "cross-year pair: 2015-12-15 original superseded by a 2016-01-20" in output
    assert "window seam: requested submitted 01/01/2015 → 03/31/2016" in output
    assert "member join: house 2015" in output           # R15 per-era join
    assert "unresolved: Clawson" in output               # unjoined stays visible

    # The per-era gate line, on the same 97% ruler as the 2026 baseline.
    assert "house 2015 | e-file rows 19/19 = 100.0% (rate) vs gate 97%" in output
    assert "status pass" in output

    # Both crafted non-passing eras surface, worst-first, with all three options.
    assert "OWNER DECISION REQUIRED: 2 era(s)" in output
    assert "house 2014 [unmeasurable]" in output
    assert "house 2013 [miss]" in output
    assert "(a) era-scoped gates" in output
    assert "(b) a parser extension" in output
    assert "(c) accepting a higher needs_ocr share" in output

    # Publication, the consumer contract, and the budget.
    assert "verify: ok" in output
    assert "congress/feed.json == the DB's expected latest 500" in output
    assert "qualifying slice(s) carry 2015 rows" in output
    assert "/ 8500 M1 budget" in output
    assert "ACCEPTANCE PASSED" in output


def test_the_operational_mode_shares_the_hermetic_assertion_body():
    """R18/LD11: the real-corpus run is a re-run of this gate, not a second,
    weaker script. Both entry points call one ``assert_corpus``."""
    import inspect

    accept = _load_accept()
    hermetic = inspect.getsource(accept.run_acceptance)
    operational = inspect.getsource(accept.run_operational_acceptance)
    assert "assert_corpus(" in hermetic
    assert "assert_corpus(" in operational


def test_the_hermetic_gate_reads_only_committed_fixtures():
    """data-cache/ is gitignored, so an acceptance that depended on it would
    pass on this machine and fail everywhere else."""
    accept = _load_accept()
    source = (REPO_ROOT / "scripts" / "acceptance" / "congress_history.py").read_text(encoding="utf-8")
    assert "data-cache" not in source
    assert accept.FIXTURES == REPO_ROOT / "tests" / "fixtures"
    for name in accept.HOUSE_2015_PDFS.values():
        assert (accept.FIXTURES / "house" / name).is_file()
    assert (accept.FIXTURES / "house" / "2015FD.index.xml").is_file()
    assert (accept.FIXTURES / "senate" / "hist-ptr-index.json").is_file()


def test_the_feed_contract_check_is_exact_not_containment():
    """R16/A13: `feed.json` is contractually the latest FEED_LIMIT rows by filed
    date. A containment or set check would accept a truncated or reordered feed
    — and would let a real publication defect through on any corpus where every
    published row happens to be an expected one."""
    accept = _load_accept()
    expected = ["a", "b", "c"]

    assert accept.feed_matches_contract(["a", "b", "c"], expected) is True
    # Same members, wrong order — the feed is ordered latest-first.
    assert accept.feed_matches_contract(["a", "c", "b"], expected) is False
    # Truncated: a "contains" check would accept this.
    assert accept.feed_matches_contract(["a", "b"], expected) is False
    # A row the database's latest window does not contain.
    assert accept.feed_matches_contract(["a", "b", "c", "d"], expected) is False
    assert accept.feed_matches_contract([], expected) is False


def test_the_file_budget_is_a_hard_cap():
    accept = _load_accept()
    assert accept.FILE_BUDGET == 8500            # ARCHITECTURE.md §9.10 (2026-08-01)
    assert accept.within_file_budget(8499, 8500) is True
    assert accept.within_file_budget(8500, 8500) is True
    assert accept.within_file_budget(8501, 8500) is False


def test_an_over_budget_corpus_fails_the_acceptance_end_to_end(tmp_path):
    """The budget assertion is wired into the real chain, not merely defined:
    the same corpus that passes at the real cap fails against a smaller one."""
    accept = _load_accept()
    lines: list[str] = []
    assert accept.run_acceptance(out=lines.append) == 0

    # Rebuild the same hermetic corpus, then hold it to a budget it exceeds.
    import tempfile

    tmp = Path(tempfile.mkdtemp(prefix="accept-m1-b-budget-"))
    raw_root = tmp / "raw" / "house"
    db_path = tmp / "phase-a.db"
    conn = accept._new_db(db_path)
    try:
        assert accept._stage_house(conn, raw_root, lambda _line: None)
    finally:
        conn.close()

    over: list[str] = []
    repo = tmp / "data-repo"
    repo.mkdir(parents=True)
    ok = accept.assert_corpus(
        db_path, raw_root=raw_root, data_repo=repo, file_budget=1, out=over.append
    )
    output = "\n".join(over)
    assert ok is False, output
    assert "exceed the hard M1 budget" in output
