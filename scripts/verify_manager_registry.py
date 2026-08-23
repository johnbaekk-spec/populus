#!/usr/bin/env python3
"""R24 — re-verify the curated manager registry against a published build.

    uv run python scripts/verify_manager_registry.py --inst-db <inst_agg.db>

CADENCE AND OWNER. Run QUARTERLY, after each 13F filing deadline (period end
plus 45 days), by the repository owner. `verified_date` on each row is the
expiry clock; this command reports which rows have aged past it.

WHY A COMMAND AND NOT A BUILD STEP. The build already fails on an `active` row
that stops joining — that is R24's gate and it is automatic. This command
answers the different question a gate cannot: which rows are still CORRECT.
A manager that renamed itself, or was acquired, still joins by CIK and still
passes the gate while its display name silently goes stale. Only a human with a
primary source can settle that, so this command reports and never edits.

It exits non-zero when the build gate would fail, so it can be chained.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from populus.manager_registry import (  # noqa: E402
    VERIFICATION_MAX_AGE_DAYS,
    ManagerRegistryError,
    enforce_manager_registry_join,
    join_manager_registry,
    load_manager_registry,
    stale_rows,
)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--inst-db",
        type=Path,
        required=True,
        help="published inst_agg.db carrying agg_filer_registry",
    )
    ap.add_argument(
        "--today",
        default=None,
        help="ISO date to age verifications against (default: today, UTC)",
    )
    args = ap.parse_args()

    if not args.inst_db.exists():
        print(f"FAIL: no such aggregate: {args.inst_db}", file=sys.stderr)
        return 2

    today = (
        date.fromisoformat(args.today)
        if args.today
        else datetime.now(timezone.utc).date()
    )

    registry = load_manager_registry()
    conn = sqlite3.connect(f"file:{args.inst_db}?mode=ro", uri=True)
    try:
        report = join_manager_registry(conn, registry)
    finally:
        conn.close()

    print(f"registry version {registry.version} — {report.registry_size} rows")
    print(f"  active   {len(registry.active)}")
    print(f"  retired  {len(registry.retired)}")
    print(f"  matched  {len(report.matched)} ({report.match_rate:.1%})")

    if report.unmatched_active:
        print("\nACTIVE ROWS THAT NO LONGER JOIN — each needs a primary-source decision:")
        for r in sorted(report.unmatched_active, key=lambda r: r.cik):
            print(f"  {r.cik:>10}  {r.display_name}  (filed as {r.sec_name!r})")
    if report.unmatched_retired:
        print("\nRetired rows, excluded from typed views as intended:")
        for r in sorted(report.unmatched_retired, key=lambda r: r.cik):
            print(f"  {r.cik:>10}  {r.display_name}")

    aged = stale_rows(registry, today)
    if aged:
        print(
            f"\nVERIFICATION AGED PAST {VERIFICATION_MAX_AGE_DAYS} DAYS"
            f" — re-confirm against a primary SEC source and bump verified_date:"
        )
        for r in sorted(aged, key=lambda r: r.verified_date):
            age = (today - date.fromisoformat(r.verified_date)).days
            print(f"  {r.cik:>10}  {r.display_name}  last verified {r.verified_date} ({age}d ago)")
    else:
        print(f"\nEvery row re-verified within {VERIFICATION_MAX_AGE_DAYS} days.")

    try:
        enforce_manager_registry_join(report)
    except ManagerRegistryError as exc:
        print(f"\nFAIL: {exc}", file=sys.stderr)
        return 1
    print("\nOK: the build gate would pass against this aggregate.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
