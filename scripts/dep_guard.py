#!/usr/bin/env python3
"""G1 dependency guard (ARCHITECTURE.md §19): no paid/vendor SDKs, ever.

Stdlib-only, CI-able. Scans three sources against the denylist:
  1. ``pyproject.toml`` dependency names (PEP 503 canonicalization);
  2. ``uv.lock`` ``[[package]]`` names (PEP 503 canonicalization);
  3. import roots across all owned first-party Python — ``src/``, ``tests/``,
     ``scripts/`` — enumerated with ``ast`` (absolute imports only), so
     denylist string literals (including this file's own) are never mis-read
     as imports.

Exit 0 when clean; exit 1 listing every offending name and its source.
"""

from __future__ import annotations

import ast
import re
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path

# Distribution stems, PEP 503 canonical. Unusual Whales needs both aliases:
# unusual-whales/unusual_whales/Unusual.Whales canonicalize to "unusual-whales"
# while the concatenated "unusualwhales" canonicalizes only to itself.
VENDOR_DIST = {"polygon", "massive", "quiverquant", "unusual-whales", "unusualwhales"}
# Import roots: hyphen/dot are invalid in Python module roots, so only the
# concatenated Unusual Whales form is reachable ("unusual_whales" canonicalizes
# to it via underscore stripping).
VENDOR_IMPORT = {"polygon", "massive", "quiverquant", "unusualwhales"}

OWNED_ROOTS = ("src", "tests", "scripts")


@dataclass(frozen=True)
class Violation:
    name: str  # the offending distribution or import as written
    source: str  # "pyproject.toml", "uv.lock", or a file path
    stem: str  # the denylist stem it matched


def canon_dist(name: str) -> str:
    """PEP 503 canonicalization: lowercase, collapse [-_.]+ to '-'."""
    return re.sub(r"[-_.]+", "-", name).lower()


def canon_import(root: str) -> str:
    """Canonical import root: top-level module, strip '_', lowercase."""
    return root.split(".")[0].replace("_", "").lower()


def _dist_stem(name: str) -> str | None:
    """The VENDOR_DIST stem *name* matches at a token boundary, if any."""
    canon = canon_dist(name)
    for stem in VENDOR_DIST:
        if canon == stem or canon.startswith(stem + "-"):
            return stem
    return None


_REQUIREMENT_NAME = re.compile(r"^\s*([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)")


def _pyproject_dependency_names(data: dict) -> list[str]:
    requirements: list[str] = []
    # Build dependencies count too — a denylisted build-time requirement enters
    # the manifest just as surely as a runtime one.
    requirements += data.get("build-system", {}).get("requires", [])
    project = data.get("project", {})
    requirements += project.get("dependencies", [])
    for extra in project.get("optional-dependencies", {}).values():
        requirements += extra
    for group in data.get("dependency-groups", {}).values():
        requirements += [entry for entry in group if isinstance(entry, str)]
    names = []
    for requirement in requirements:
        match = _REQUIREMENT_NAME.match(requirement)
        if match:
            names.append(match.group(1))
    return names


def _import_roots(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    roots = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots += [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            roots.append(node.module)
    return roots


def check(root: Path) -> list[Violation]:
    """Scan the tree at *root*; return every denylist violation found."""
    violations: list[Violation] = []

    pyproject = root / "pyproject.toml"
    if pyproject.is_file():
        data = tomllib.loads(pyproject.read_text(encoding="utf-8"))
        for name in _pyproject_dependency_names(data):
            stem = _dist_stem(name)
            if stem is not None:
                violations.append(Violation(name, "pyproject.toml", stem))

    lock = root / "uv.lock"
    if lock.is_file():
        data = tomllib.loads(lock.read_text(encoding="utf-8"))
        for package in data.get("package", []):
            name = package.get("name", "")
            stem = _dist_stem(name)
            if stem is not None:
                violations.append(Violation(name, "uv.lock", stem))

    for owned in OWNED_ROOTS:
        base = root / owned
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*.py")):
            for module in _import_roots(path):
                stem = canon_import(module)
                if stem in VENDOR_IMPORT:
                    violations.append(
                        Violation(module, str(path.relative_to(root)), stem)
                    )

    return violations


def main() -> int:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
    violations = check(root)
    if violations:
        for violation in violations:
            print(
                f"DENY: {violation.name!r} in {violation.source} "
                f"matches denylisted vendor {violation.stem!r}"
            )
        return 1
    print("dep_guard: OK — no denylisted vendor dependencies or imports")
    return 0


if __name__ == "__main__":
    sys.exit(main())
