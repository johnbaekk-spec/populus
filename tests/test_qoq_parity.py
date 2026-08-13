"""M2-12 cross-runtime QoQ parity — the PYTHON half.

Codex closeout F2/F4: the equal-key comparator repair and the lone-surrogate
serialization repair both existed in the Python reference with **no committed
test invoking it**, so reverting either would have left the whole suite green
while the two runtimes silently diverged at a cap boundary.

`tests/fixtures/qoq_parity.v1.json` is read by BOTH halves — this file and
`dashboard/test/inst-changes-bound.test.ts` — so neither runtime can drift
without the other's assertions moving too. The fixture's expected JSON and byte
counts were generated from real `JSON.stringify` output, not written by hand.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import measure_inst_derive  # noqa: E402

FIXTURE = json.loads(
    (REPO_ROOT / "tests" / "fixtures" / "qoq_parity.v1.json").read_text(encoding="utf-8")
)


def _sign(n: int) -> int:
    return (n > 0) - (n < 0)


def test_comparator_cases_match_the_shared_fixture():
    for case in FIXTURE["comparator"]:
        a, b = case["a"], case["b"]
        if case["sign"] == 0:
            # Reflexivity/equality cannot be observed from a sorted pair (a stable
            # sort keeps the input order either way), so assert the comparator
            # directly: this is exactly the hole Codex found in the TS test.
            assert _sign(measure_inst_derive._compare_qoq_deltas(a, b)) == 0, case["name"]
            assert _sign(measure_inst_derive._compare_qoq_deltas(b, a)) == 0, case["name"]
        else:
            got = _sign(measure_inst_derive._compare_qoq_deltas(a, b))
            assert got == case["sign"], f"{case['name']}: {case['why']}"
            # Antisymmetry: swapping the arguments must flip the sign.
            assert _sign(measure_inst_derive._compare_qoq_deltas(b, a)) == -case["sign"], (
                f"{case['name']}: comparator must be antisymmetric"
            )


def test_reflexive_against_itself():
    """cmp(x, x) == 0 for every row in the fixture — the property whose absence
    made the order non-total and diverged from the TypeScript mirror."""
    rows = [c["a"] for c in FIXTURE["comparator"]] + [c["b"] for c in FIXTURE["comparator"]]
    for row in rows:
        assert measure_inst_derive._compare_qoq_deltas(row, row) == 0, row["position_key"]


def test_sort_order_matches_the_shared_expected_sequence():
    spec = FIXTURE["sort_order"]
    got = [r["position_key"] for r in measure_inst_derive._sort_qoq_deltas(list(spec["rows"]))]
    assert got == spec["expected_keys"]


def test_empty_and_single_inputs_are_total_orders_too():
    assert measure_inst_derive._sort_qoq_deltas([]) == []
    one = [{"position_key": "A", "curr_value_usd": 1, "prev_value_usd": None}]
    assert measure_inst_derive._sort_qoq_deltas(one) == one
    rows, total = measure_inst_derive._bound_qoq_deltas([])
    assert (rows, total) == ([], 0)


def test_serialization_matches_javascript_byte_for_byte():
    for case in FIXTURE["serialization"]:
        got = measure_inst_derive._dumps(case["value"])
        assert got == case["json"], case["name"]
        assert measure_inst_derive._utf8_len(got) == case["utf8_bytes"], case["name"]


def test_lone_surrogates_are_escaped_exactly_as_javascript_does():
    """Python emits lone surrogates raw and then cannot encode them at all;
    JS escapes them as \\udXXX. Unreachable from SQLite TEXT, but a reference
    implementation that RAISES where production produces bytes is a defect."""
    for case in FIXTURE["lone_surrogates"]:
        value = "".join(chr(cp) for cp in case["code_points"])
        got = measure_inst_derive._dumps(value)
        assert got == case["json"], case["name"]
        assert measure_inst_derive._utf8_len(got) == case["utf8_bytes"], case["name"]


def test_astral_pairs_are_NOT_escaped():
    """The escaping must apply only to LONE surrogates. Python stores an astral
    character as ONE code point, so escaping by code-point range would corrupt
    emoji into two escapes and break byte parity in the other direction."""
    got = measure_inst_derive._dumps("😀")
    assert "\\ud" not in got.lower(), f"astral pair must survive unescaped, got {got!r}"
    assert measure_inst_derive._utf8_len(got) == 6


def test_the_cap_fill_measures_utf8_bytes_not_code_units():
    """`_cap_rows` mirrors `holdings.ts::capRows`, whose budget is declared in
    BYTES. A CJK-heavy row set must be bound by its byte size."""
    rows = [
        {
            "position_key": f"POS{i:08d}",
            "curr_value_usd": 1_000_000 - i,
            "prev_value_usd": 1,
            "issuer_name": "日" * 300,
        }
        for i in range(4_000)
    ]
    kept, total = measure_inst_derive._bound_qoq_deltas(rows)
    assert total == len(rows), "the pre-cap true total survives the cap"
    assert len(kept) < len(rows), "a CJK-heavy set must be bound by bytes"
    assert (
        measure_inst_derive._utf8_len(measure_inst_derive._dumps(kept))
        <= measure_inst_derive.HOLDINGS_EMBED_BYTE_CAP
    )
