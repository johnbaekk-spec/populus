#!/usr/bin/env python3
"""Regenerate DATA-LICENSE.md and NOTICE from the conditions register.

Stdlib-only (the dependency guard scans scripts/ too). The two committed
documents are pure functions of ``src/populus/licenses.json``; a CI
drift-guard test regenerates them and asserts byte equality.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "src"))

from populus.licenses import (  # noqa: E402 — path bootstrap above
    load_register,
    render_data_license,
    render_notice,
    validate_register,
)


def main() -> int:
    register = load_register()
    errors = validate_register(register)
    if errors:
        for error in errors:
            print(f"INVALID REGISTER: {error}")
        return 1
    (REPO_ROOT / "DATA-LICENSE.md").write_text(
        render_data_license(register), encoding="utf-8"
    )
    (REPO_ROOT / "NOTICE").write_text(render_notice(register), encoding="utf-8")
    print("wrote DATA-LICENSE.md and NOTICE from src/populus/licenses.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
