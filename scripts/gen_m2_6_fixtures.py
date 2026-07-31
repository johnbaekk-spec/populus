#!/usr/bin/env python3
"""Regenerate the committed RUN M2-6 static fixtures from the corpus spec.

The bulk filer bodies are built in memory by ``tests/bulk_corpus.py`` (served
through a fake transport); the only committed static fixture is the quarterly
``form.idx`` the R1 parser test reads. This script writes it from the SAME spec,
so the static fixture and the discovery-driving text can never drift.

    uv run python scripts/gen_m2_6_fixtures.py
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "tests"))

from bulk_corpus import build_form_index_text  # noqa: E402

TARGET = (
    REPO_ROOT / "tests" / "fixtures" / "inst" / "bulk"
    / "full-index" / "2026" / "QTR3" / "form.idx"
)


def main() -> int:
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(build_form_index_text(), encoding="utf-8")
    print(f"wrote {TARGET}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
