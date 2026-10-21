"""Launch review (weight item 2): every acceptance script that restates the
forward file-budget projection sums EVERY term `worst_case_file_count` sums.

`make accept-m2-11` went red (20,744 vs 20,736) because the launch redesign
added `INST_DIRECTORY_SHARDS_MAX` to `worst_case_file_count` and to one of the
two acceptance twins (`holdings_substrate.py`) but not the other
(`institutional_serving.py`). The acceptance scripts need a real build to run,
so this test reads them statically: the terms are the projection's keyword
defaults (plus the required measured term), and each script must carry one
`+` chain that names them all. A re-planted control drops a term from a
script's source and requires the check to name it.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
BUDGET = ROOT / "src" / "populus" / "inst_budget.py"
SCRIPTS = [
    ROOT / "scripts" / "acceptance" / "institutional_serving.py",
    ROOT / "scripts" / "acceptance" / "holdings_substrate.py",
]


def projection_terms() -> set[str]:
    """The constants `worst_case_file_count` sums: its keyword defaults, plus
    `M1_MEASURED_PAGES`, the measured term every caller passes."""
    tree = ast.parse(BUDGET.read_text())
    fn = next(
        n for n in ast.walk(tree)
        if isinstance(n, ast.FunctionDef) and n.name == "worst_case_file_count"
    )
    names = {d.id for d in fn.args.kw_defaults if isinstance(d, ast.Name)}
    return names | {"M1_MEASURED_PAGES"}


def _add_leaves(node: ast.AST) -> list[str]:
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        return _add_leaves(node.left) + _add_leaves(node.right)
    return [node.id] if isinstance(node, ast.Name) else []


def missing_terms(source: str, terms: set[str]) -> set[str]:
    """The terms the script's best restated sum lacks (empty when one `+`
    chain that starts from the measured term names every term)."""
    best: set[str] | None = None
    for node in ast.walk(ast.parse(source)):
        if not (isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add)):
            continue
        leaves = set(_add_leaves(node))
        if "M1_MEASURED_PAGES" not in leaves:
            continue
        gap = terms - leaves
        if best is None or len(gap) < len(best):
            best = gap
    return terms if best is None else best


def test_projection_terms_include_the_directory_family() -> None:
    terms = projection_terms()
    assert "INST_DIRECTORY_SHARDS_MAX" in terms
    assert len(terms) == 9, sorted(terms)


@pytest.mark.parametrize("script", SCRIPTS, ids=lambda p: p.name)
def test_acceptance_sum_restates_every_projection_term(script: Path) -> None:
    assert missing_terms(script.read_text(), projection_terms()) == set()


@pytest.mark.parametrize("script", SCRIPTS, ids=lambda p: p.name)
def test_control_a_dropped_term_is_named(script: Path) -> None:
    source = script.read_text()
    assert "+ INST_DIRECTORY_SHARDS_MAX" in source
    planted = source.replace("+ INST_DIRECTORY_SHARDS_MAX", "", 1)
    assert missing_terms(planted, projection_terms()) == {"INST_DIRECTORY_SHARDS_MAX"}
