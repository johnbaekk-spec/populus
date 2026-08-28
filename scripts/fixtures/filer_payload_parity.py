"""Regenerate tests/fixtures/filer_payload_parity.v1.json from the T0 reference.

RUN M2-12 added `deltaTotalsByPeriod` to FilerPayloadV1, which changes the
canonical serialization, its digest, and every fragment's byte length. Those
values are DERIVED, so they are recomputed here from
`measure_inst_derive.build_filer_payload` — the fixture's own stated T0
reference — never hand-edited. The dashboard suite then has to reproduce the
result byte-for-byte independently; that cross-runtime agreement is the check,
and it is worthless if either side's numbers were typed in by hand.

Inputs (`args`, `rawRows`/`generateRows`, `filings`, `agg`, `columns`) are
carried through untouched: this rewrites only what the code computes.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "scripts"))
sys.path.insert(0, str(REPO / "tests"))

import measure_inst_derive  # noqa: E402
from test_inst_snapshot_script import _expand_parity_rows  # noqa: E402

FIXTURE = REPO / "tests" / "fixtures" / "filer_payload_parity.v1.json"


def main() -> int:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for case in fixture["cases"]:
        cik = case["args"]["cik"]
        rows = _expand_parity_rows(case, fixture["columns"])
        agg = {
            "topn": case["agg"]["topn"],
            "conc_by_filer": {cik: case["agg"]["concByPeriod"]},
            "deltas_by_filer": {cik: case["agg"]["deltasByPeriod"]},
        }
        payload = measure_inst_derive.build_filer_payload(
            cik,
            filer_name=case["args"]["filerName"],
            latest_period=case["args"]["latestPeriod"],
            rows=rows,
            filings_by_key=case["filings"],
            agg=agg,
            latest_filed=case["agg"]["latestFiled"],
            window=case["agg"]["window"],
        )
        serialized = measure_inst_derive._dumps(payload)
        encoded = serialized.encode("utf-8")
        fragments = measure_inst_derive.fragment_filer_payload(payload)

        # Reassembly must still round-trip before anything is written: a fixture
        # regenerated from a payload that cannot be reassembled would pin a bug.
        assert measure_inst_derive.reassemble_filer_fragments(fragments) == payload, (
            f"{case['name']}: fragments do not reassemble to the payload"
        )

        case["fragment_summary_v2"] = {
            "parts": len(fragments),
            "fragments": [
                {
                    "part": f["part"],
                    "section": f["section"],
                    "period": f["period"],
                    "start": f["start"],
                    "records": len(f["data"]) if isinstance(f["data"], list) else None,
                    "entry_utf8_bytes": len(
                        measure_inst_derive._fragment_entry_json(f).encode("utf-8")
                    ),
                }
                for f in fragments
            ],
        }
        # The >100KB cases carry only sha256+length by design (see the fixture
        # note); regenerating must not start inlining them.
        if "expected" in case:
            case["expected"] = serialized
        case["expected_utf8_bytes"] = len(encoded)
        case["expected_sha256"] = hashlib.sha256(encoded).hexdigest()
        print(
            f"{case['name']}: {len(encoded)} B  sha256 {case['expected_sha256'][:12]}…  "
            f"{len(fragments)} fragments"
        )

    FIXTURE.write_text(json.dumps(fixture, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {FIXTURE.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
