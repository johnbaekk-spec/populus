#!/usr/bin/env python3
"""R27 — the data-wired acceptance command for RUN ALPHA-SURFACES-V2.

    uv run python scripts/accept_alpha_surfaces_v2.py \
      --build-dir <build> --congress-db <populus.db> --inst-db <inst_agg.db> \
      --inst-serving-db <inst_serving.db> --ticker-map <ticker_map.json>

WHY THIS EXISTS. The institutional module is DORMANT-BY-DATA in a default local
build: `make check` goes green having rendered honest-absence for every
institutional surface, which means it tested none of them. This command is the
only thing that proves the new surfaces were actually exercised.

WHY EVERY PATH IS AN EXPLICIT ARGUMENT. Nothing is inferred. In particular
`POPULUS_INST_DB` is REQUIRED and is exported to the gate run: the dashboard
falls back to `<build-dir>/inst_agg.db` when it is unset, so an aggregate
living outside the build directory would silently render honest-absence and
produce a GREEN acceptance that never touched the institutional module. That is
precisely the failure this script exists to make impossible.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "src"))

from populus.manager_registry import (  # noqa: E402
    join_manager_registry,
    load_manager_registry,
)

FILING_DEADLINE_DAYS = 45
# The selector offers exactly this many closed periods (R20), and the
# dashboard's `ADDS_PERIOD_COUNT` is the same number. Acceptance asserts
# against the newest of them.
ADDS_PERIOD_COUNT = 3


def fail(msg: str) -> int:
    print(f"FAIL: {msg}", file=sys.stderr)
    return 1


def _readable_dir(p: Path) -> str | None:
    """Why this directory cannot be used, or None when it can be."""
    if not p.exists():
        return "does not exist"
    if not p.is_dir():
        return "is not a directory"
    # A directory needs BOTH R_OK (to list it) and X_OK (to open anything
    # inside it). A directory that is readable but not traversable lists its
    # names and then fails on every open, which is exactly the late, unnamed
    # failure this preflight exists to prevent.
    if not os.access(p, os.R_OK | os.X_OK):
        return "is not readable and traversable"
    return None


def _readable_file(p: Path) -> str | None:
    """Why this file cannot be used, or None when it can be."""
    if not p.exists():
        return "does not exist"
    if p.is_dir():
        return "is a directory, not a file"
    if not p.is_file():
        return "is not a regular file"
    if not os.access(p, os.R_OK):
        return "is not readable"
    return None


def preflight(checks: dict[str, tuple[Path, str]]) -> list[str]:
    """Validate every declared artifact and return EVERY failure, named.

    F8: existence is not readability, and the previous implementation checked
    only `Path.exists()` before printing that everything "exists and is
    readable". An unreadable database or a non-traversable build directory
    passed preflight and failed later, deep inside a gate run, with a
    diagnostic that named neither the flag nor the path.

    It also returned on the FIRST missing path. An operator with three wrong
    arguments then had to re-run three times to learn all three. Every failing
    flag is collected and reported together, and nothing is opened until they
    all pass.
    """
    problems: list[str] = []
    for flag, (path, kind) in checks.items():
        why = _readable_dir(path) if kind == "dir" else _readable_file(path)
        if why is not None:
            problems.append(f"{flag}={path} {why}")
    return problems


def build_generated_date(build_dir: Path) -> tuple[str | None, str | None]:
    """The BUILD's generated-at date, exactly as the dashboard reads it.

    F9: closure was decided from `date.today()` — the reviewer's wall clock —
    while the rendered selector decides it from this value. A build replayed a
    month later would certify a set of closed quarters the page it built does
    not offer. `dashboard/src/lib/data.ts` reads `congress/stats.json` and takes
    the first ten characters of `generated_at`; so does this.

    Returns `(date, None)` or `(None, reason)`.
    """
    stats_path = build_dir / "congress" / "stats.json"
    try:
        stats = json.loads(stats_path.read_text())
    except FileNotFoundError:
        return None, f"{stats_path} does not exist"
    except (OSError, ValueError) as exc:
        return None, f"{stats_path} is unreadable or not JSON: {exc}"
    raw = str(stats.get("generated_at") or "")
    if len(raw) < 10:
        return None, f"{stats_path} carries no usable `generated_at` (got {raw!r})"
    return raw[:10], None


def _distinct_periods(conn: sqlite3.Connection, table: str) -> list[str]:
    """Distinct `period_of_report` values, or [] when the relation is absent.

    Mirrors `corpusPeriods` in `dashboard/src/lib/inst.ts`, which tolerates a
    missing relation because a build may legitimately predate it.
    """
    try:
        return [str(p) for (p,) in conn.execute(
            f"SELECT DISTINCT period_of_report FROM {table}"
        )]
    except sqlite3.OperationalError:
        return []


def selector_periods(conn: sqlite3.Connection, build_date: str) -> list[str]:
    """The exact periods the rendered selector offers, newest first.

    F9: derived from the same authority the dashboard uses — every period on
    record in `agg_filer_concentration`, unioned with the leaderboard's own
    periods and its exclusion rows — never from "periods that happen to have
    non-empty adds rows". A genuinely quiet closed quarter is still a
    selectable quarter, and acceptance must exercise the one the page would
    actually lead with rather than skipping back to an older busy one.
    """
    universe: set[str] = set()
    for table in ("agg_filer_concentration", "agg_issuer_adds", "agg_issuer_adds_exclusions"):
        universe.update(_distinct_periods(conn, table))
    closed = [
        p
        for p in universe
        if date.fromisoformat(build_date)
        > date.fromisoformat(p) + timedelta(days=FILING_DEADLINE_DAYS)
    ]
    return sorted(closed, reverse=True)[:ADDS_PERIOD_COUNT]


def tree_digest(root: Path) -> str:
    """Identify the exact WORKING TREE the gates ran against.

    F17: this must not use `git write-tree`. That hashes the INDEX, so unstaged
    edits to tracked files are invisible, and it required an `git add -N` first —
    mutating the very thing being measured. Untracked files were represented by
    a bare count, so two different untracked files digested identically.

    Instead: hash every tracked file's WORKING-TREE bytes plus every untracked,
    non-ignored file's path and bytes. Nothing is written, and two materially
    different acceptance inputs cannot collide.
    """
    def _git(*args: str) -> str:
        return subprocess.run(
            ["git", *args], cwd=root, check=True, capture_output=True, text=True
        ).stdout

    paths: list[str] = []
    paths += [p for p in _git("ls-files", "-z").split("\0") if p]
    paths += [
        p
        for p in _git(
            "ls-files", "-z", "--others", "--exclude-standard"
        ).split("\0")
        if p
    ]

    h = hashlib.sha256()
    for rel in sorted(set(paths)):
        full = root / rel
        h.update(rel.encode("utf-8"))
        h.update(b"\0")
        try:
            h.update(full.read_bytes())
        except (FileNotFoundError, IsADirectoryError, PermissionError):
            # A tracked path that is absent or unreadable is itself part of the
            # tree's identity — record the fact rather than skipping it.
            h.update(b"<unreadable>")
        h.update(b"\0")
    return h.hexdigest()[:16]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--build-dir", type=Path, required=True)
    ap.add_argument("--congress-db", type=Path, required=True)
    ap.add_argument("--inst-db", type=Path, required=True)
    ap.add_argument("--inst-serving-db", type=Path, required=True)
    ap.add_argument(
        "--ticker-map",
        type=Path,
        default=None,
        help="ticker_map.json; omit ONLY with --no-ticker-map, which states the policy",
    )
    ap.add_argument(
        "--no-ticker-map",
        action="store_true",
        help="assert the ticker map is INTENTIONALLY absent rather than forgotten",
    )
    args = ap.parse_args()

    # --- preflight: every declared artifact is USABLE, each named -----------
    # F8: each argument is checked against the contract that argument actually
    # has — a build directory must be readable AND traversable, a database or a
    # map must be a readable regular file — and NOTHING below is opened until
    # every one of them passes.
    checks: dict[str, tuple[Path, str]] = {
        "--build-dir": (args.build_dir, "dir"),
        "--congress-db": (args.congress_db, "file"),
        "--inst-db": (args.inst_db, "file"),
        "--inst-serving-db": (args.inst_serving_db, "file"),
    }
    if args.ticker_map is not None:
        checks["--ticker-map"] = (args.ticker_map, "file")
    elif not args.no_ticker_map:
        return fail(
            "no --ticker-map given. If the map is intentionally absent, pass"
            " --no-ticker-map so the policy is STATED rather than inferred from"
            " a missing flag."
        )
    else:
        print(
            "POLICY: the ticker map is intentionally absent from this acceptance run."
            " Ticker-to-issuer resolution is therefore NOT exercised."
        )

    problems = preflight(checks)
    if problems:
        return fail(
            "preflight: unusable artifact(s) — " + "; ".join(problems)
        )
    print(f"preflight: all {len(checks)} declared artifacts are present and readable")

    # The build's own generated-at date decides period closure below (F9). It is
    # part of preflight because a build directory that cannot answer this
    # question cannot be certified at all.
    build_date, why = build_generated_date(args.build_dir)
    if build_date is None:
        return fail(f"preflight: --build-dir={args.build_dir} {why}")
    print(f"preflight: build generated-at date {build_date} (from congress/stats.json)")

    # --- coverage assertions ------------------------------------------------
    conn = sqlite3.connect(f"file:{args.inst_db}?mode=ro", uri=True)
    try:
        (filers,) = conn.execute("SELECT COUNT(*) FROM agg_filer_registry").fetchone()
        if filers == 0:
            return fail("agg_filer_registry is EMPTY — the institutional module is not wired")
        print(f"institutional coverage: {filers} filers in agg_filer_registry")

        registry = load_manager_registry()
        report = join_manager_registry(conn, registry)
        if report.unmatched_active:
            named = ", ".join(f"{r.cik} ({r.display_name})" for r in report.unmatched_active)
            return fail(f"active registry row(s) do not join: {named}")
        print(
            f"registry coverage: {len(report.matched)}/{report.registry_size} rows join"
            f" ({report.match_rate:.0%}); every active row matched"
        )

        # The period the RENDERED SELECTOR would lead with must return
        # leaderboard rows in BOTH modes (R20/R27).
        #
        # F9: the selector's period universe is the corpus, not the adds rows.
        # Deriving it from non-empty adds rows let a quiet newest quarter be
        # skipped silently in favour of an older busy one — certifying a
        # quarter the page does not lead with, under closure semantics
        # (`date.today()`) the page does not use.
        if not _distinct_periods(conn, "agg_issuer_adds"):
            return fail(
                "this aggregate has no `agg_issuer_adds` rows (or no such table), so it"
                " was produced by a build BEFORE the leaderboard existed. Acceptance"
                " cannot pass against it: rebuild the aggregate with this tree's producer"
                " and re-run."
            )
        offered = selector_periods(conn, build_date)
        if not offered:
            return fail(
                f"no period on record has passed its {FILING_DEADLINE_DAYS}-day filing"
                f" deadline as of the build date {build_date}, so the selector offers no"
                " quarter at all"
            )
        print(
            f"selector: {len(offered)} closed period(s) offered as of {build_date}"
            f" — {', '.join(offered)}"
        )
        newest = offered[0]
        for mode in ("all", "new"):
            (n,) = conn.execute(
                "SELECT COUNT(*) FROM agg_issuer_adds WHERE period_of_report = ? AND mode = ?",
                (newest, mode),
            ).fetchone()
            if n == 0:
                # Distinguish "the producer described this quarter and it was
                # genuinely quiet" from "the producer never described it".
                # Both refuse to certify, but they are different repairs.
                described = conn.execute(
                    "SELECT COUNT(*) FROM agg_issuer_adds_exclusions"
                    " WHERE period_of_report = ? AND mode = ?",
                    (newest, mode),
                ).fetchone()[0]
                detail = (
                    "the producer wrote an exclusion row for it, so the quarter is"
                    " described and genuinely empty"
                    if described
                    else "the producer never described this quarter at all"
                )
                return fail(
                    f"the selector's newest closed period {newest} returns NO leaderboard"
                    f" rows in mode={mode} — {detail}. The rendered page would lead with"
                    " this quarter, so acceptance cannot certify the surfaces against it."
                )
            print(f"leaderboard coverage: {newest} mode={mode} -> {n} issuers")
    finally:
        conn.close()

    # --- the wired gate run -------------------------------------------------
    env = dict(os.environ)
    env.update(
        {
            "POPULUS_BUILD_DIR": str(args.build_dir.resolve()),
            "POPULUS_DB": str(args.congress_db.resolve()),
            # REQUIRED. Omitting it makes the dashboard fall back to
            # <build-dir>/inst_agg.db and render honest-absence, producing a
            # green run that exercised nothing.
            "POPULUS_INST_DB": str(args.inst_db.resolve()),
            "POPULUS_INST_SERVING_DB": str(args.inst_serving_db.resolve()),
        }
    )
    if args.ticker_map is not None:
        env["POPULUS_TICKER_MAP"] = str(args.ticker_map.resolve())

    digest = tree_digest(REPO_ROOT)
    print(f"\nrunning `make check` against tree digest {digest}")
    proc = subprocess.run(["make", "check"], cwd=REPO_ROOT, env=env)

    print(f"\nACCEPTANCE: exit={proc.returncode} tree={digest} build={args.build_dir}")
    return proc.returncode


if __name__ == "__main__":
    raise SystemExit(main())
