"""G1 dependency guard (R2) and the no-network enforcement checks (R10).

Loads scripts/dep_guard.py by path (it is a standalone script, not a package
module) and proves it flags every vendor, in every source-appropriate
spelling, in every scanned source — each injected in isolation.
"""

from __future__ import annotations

import importlib.util
import re
import socket
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_dep_guard():
    spec = importlib.util.spec_from_file_location(
        "dep_guard", REPO_ROOT / "scripts" / "dep_guard.py"
    )
    module = importlib.util.module_from_spec(spec)
    # dataclasses resolves string annotations via sys.modules[cls.__module__].
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


dep_guard = _load_dep_guard()


def _make_tree(tmp_path, *, dependencies=(), lock_packages=(), build_requires=(), files=None):
    """A minimal synthetic project tree with benign baseline content."""
    root = tmp_path / "proj"
    for owned in ("src", "tests", "scripts"):
        (root / owned).mkdir(parents=True)
    deps = ", ".join(f'"{dep}"' for dep in ("httpx",) + tuple(dependencies))
    build = ", ".join(f'"{req}"' for req in ("hatchling",) + tuple(build_requires))
    (root / "pyproject.toml").write_text(
        f'[build-system]\nrequires = [{build}]\nbuild-backend = "hatchling.build"\n\n'
        f'[project]\nname = "clean-project"\nversion = "0"\ndependencies = [{deps}]\n',
        encoding="utf-8",
    )
    lock_lines = ""
    for name in ("httpx",) + tuple(lock_packages):
        lock_lines += f'[[package]]\nname = "{name}"\nversion = "1.0.0"\n\n'
    (root / "uv.lock").write_text(lock_lines, encoding="utf-8")
    (root / "src" / "app.py").write_text(
        "import json\nfrom pathlib import Path\n", encoding="utf-8"
    )
    for rel, content in (files or {}).items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    return root


def _found(violations):
    return [(v.name, v.source, v.stem) for v in violations]


def test_clean_tree_passes(tmp_path):
    root = _make_tree(tmp_path, dependencies=("click", "rfc8785"))
    assert dep_guard.check(root) == []


# Distribution spellings (hyphen/underscore/dot/mixed case), per vendor.
DIST_SPELLINGS = [
    ("polygon", "polygon"),
    ("Polygon", "polygon"),
    ("POLYGON", "polygon"),
    ("polygon-api-client", "polygon"),
    ("polygon_api_client", "polygon"),
    ("massive", "massive"),
    ("MASSIVE", "massive"),
    ("Massive", "massive"),
    ("quiverquant", "quiverquant"),
    ("QuiverQuant", "quiverquant"),
    ("QUIVERQUANT", "quiverquant"),
    ("unusual-whales", "unusual-whales"),
    ("unusual_whales", "unusual-whales"),
    ("Unusual.Whales", "unusual-whales"),
    ("unusualwhales", "unusualwhales"),
]


@pytest.mark.parametrize("name,stem", DIST_SPELLINGS)
def test_pyproject_dependency_flagged(tmp_path, name, stem):
    root = _make_tree(tmp_path, dependencies=(name,))
    assert _found(dep_guard.check(root)) == [(name, "pyproject.toml", stem)]


@pytest.mark.parametrize("name,stem", DIST_SPELLINGS)
def test_uv_lock_package_flagged(tmp_path, name, stem):
    root = _make_tree(tmp_path, lock_packages=(name,))
    assert _found(dep_guard.check(root)) == [(name, "uv.lock", stem)]


@pytest.mark.parametrize("name,stem", DIST_SPELLINGS)
def test_build_system_requires_flagged(tmp_path, name, stem):
    # A denylisted build-time requirement enters the manifest just as a runtime
    # one does; the guard must scan [build-system].requires (source label
    # stays "pyproject.toml").
    root = _make_tree(tmp_path, build_requires=(name,))
    assert _found(dep_guard.check(root)) == [(name, "pyproject.toml", stem)]


def test_build_requirement_fails_cli(tmp_path, capsys, monkeypatch):
    root = _make_tree(tmp_path, build_requires=("polygon",))
    monkeypatch.setattr(dep_guard.sys, "argv", ["dep_guard.py", str(root)])
    exit_code = dep_guard.main()
    captured = capsys.readouterr().out
    assert exit_code == 1
    assert "polygon" in captured
    assert "pyproject.toml" in captured


def test_clean_tree_passes_cli(tmp_path, capsys, monkeypatch):
    root = _make_tree(tmp_path, dependencies=("click", "rfc8785"))
    monkeypatch.setattr(dep_guard.sys, "argv", ["dep_guard.py", str(root)])
    assert dep_guard.main() == 0
    assert "OK" in capsys.readouterr().out


def test_token_boundary_no_false_positive(tmp_path):
    root = _make_tree(tmp_path, dependencies=("polygonal", "massively-parallel"))
    assert dep_guard.check(root) == []


# Import spellings: only Python-valid roots are reachable as imports.
IMPORT_SPELLINGS = [
    ("import polygon", "polygon", "polygon"),
    ("import polygon.rest", "polygon.rest", "polygon"),
    ("from polygon import RESTClient", "polygon", "polygon"),
    ("import json, polygon", "polygon", "polygon"),
    ("import massive", "massive", "massive"),
    ("import quiverquant", "quiverquant", "quiverquant"),
    ("import unusualwhales", "unusualwhales", "unusualwhales"),
    ("import unusual_whales", "unusual_whales", "unusualwhales"),
    ("import UnusualWhales", "UnusualWhales", "unusualwhales"),
]


@pytest.mark.parametrize("owned_root", ["src", "tests", "scripts"])
@pytest.mark.parametrize("stmt,name,stem", IMPORT_SPELLINGS)
def test_owned_import_flagged(tmp_path, owned_root, stmt, name, stem):
    rel = f"{owned_root}/vendor_probe.py"
    root = _make_tree(tmp_path, files={rel: stmt + "\n"})
    assert _found(dep_guard.check(root)) == [(name, rel, stem)]


def test_scripts_root_import_rejected_in_isolation(tmp_path):
    # F3: scripts/ is owned first-party code and is scanned like src/ and tests/.
    root = _make_tree(tmp_path, files={"scripts/fetch_helper.py": "import quiverquant\n"})
    assert _found(dep_guard.check(root)) == [
        ("quiverquant", "scripts/fetch_helper.py", "quiverquant")
    ]


def test_relative_imports_not_flagged(tmp_path):
    root = _make_tree(
        tmp_path,
        files={
            "src/pkg/__init__.py": "",
            "src/pkg/mod.py": "from . import sibling\nfrom .polygon import helper\n",
        },
    )
    assert dep_guard.check(root) == []


def test_denylist_string_literals_not_flagged(tmp_path):
    # The ast scan reads imports, not text — a guard-like file full of vendor
    # string literals must not self-flag.
    root = _make_tree(
        tmp_path,
        files={
            "scripts/guard_copy.py": (
                'VENDOR = {"polygon", "massive", "quiverquant", "unusualwhales"}\n'
                'MESSAGE = "import polygon"  # a literal, not an import\n'
            )
        },
    )
    assert dep_guard.check(root) == []


def test_real_repo_tree_passes():
    # Also proves dep_guard.py's own denylist literals do not self-flag.
    assert dep_guard.check(REPO_ROOT) == []


# --- no-network enforcement (R10) -------------------------------------------

NETWORK_PRIMITIVES = re.compile(
    r"\b(httpx|requests|urllib|socket|http\.client|ftplib|smtplib"
    r"|subprocess|os\.system|aiohttp|asyncio\.open_connection)\b"
)
# The sanctioned HTTP client, permitted in exactly four modules — the House
# and Senate ingest orchestrators (RUNs 2–3), the authenticated
# GitHubRepoFetcher (RUN 5, R27; hermetic in tests via MockTransport) and the
# §11.4 SEC federated client (RUN M2-1; hermetic in tests via an injected
# transport). Every other network primitive stays banned everywhere, including
# there — notably `urllib`, which is why the SEC client's host guard is plain
# string work.
NETWORK_PRIMITIVES_SANS_HTTPX = re.compile(
    r"\b(requests|urllib|socket|http\.client|ftplib|smtplib"
    r"|subprocess|os\.system|aiohttp|asyncio\.open_connection)\b"
)
HTTPX_ALLOWED = {
    "ingest/house.py",
    "ingest/senate.py",
    "client/snapshot.py",
    "net/sec_client.py",
    # RUN P3-3b: the deploy-side modules talk to the Cloudflare Pages API and to
    # the served site. Every one takes an INJECTED transport and opens nothing at
    # import time, so the suite stays hermetic under `tests/conftest.py` — the
    # same posture as `client/snapshot.py` above. Listed individually rather than
    # as a `deploy/` prefix: a new module in that package should have to justify
    # itself here, which is the entire point of an allowlist.
    "deploy/cloudflare.py",
    # `deploy/orchestrator.py` EARNED this the same way `deploy/record.py` did,
    # and only once it grew an entry point: `publish.yml` runs the deploy as its
    # own process (`python -m populus.deploy.orchestrator`), so something in that
    # module has to build the served-tree client the verifier is handed — the CLI
    # does not own this entry point and no other module hands one out. It is one
    # function, `_default_http_client`, reached only from `main()`; the ordered
    # sequence and every helper it calls take an INJECTED client and name no
    # transport at all, which is what keeps the suite hermetic and what lets the
    # ordering tests drive the REAL verifier. `tests/test_deploy_orchestrator.py`
    # pins that split per-function rather than trusting this comment.
    "deploy/orchestrator.py",
    # `deploy/record.py` EARNED this in T10, and the reason is narrow enough to
    # state exactly: `record-sign.yml` runs the signer as its own process
    # (`python -m populus.deploy.record`), so something in that module has to
    # build the served-tree client — the CLI does not own this entry point and
    # no other module hands one out. It is one function, `_default_http_client`,
    # reached only from `main()`; every verification path takes an INJECTED
    # client, which is what keeps the suite hermetic and what makes R27's
    # verb-asserting transport fixture possible at all.
    "deploy/record.py",
    # `deploy/verify.py` is deliberately NOT here: it names no transport library
    # at all and takes an injected client, so it needs no permission. An
    # allowlist entry for a module that has not earned one is a small standing
    # grant of exactly the authority this guard exists to withhold — it was
    # added speculatively for all three deploy modules and pulled back once
    # verify.py turned out not to need it.
}
# RUN 5: publish/build.py invokes the gh CLI (argv-list subprocess, never a
# shell) as the GhReleaseBackend command transport — injectable in tests, so
# no real network runs under the suite. subprocess stays banned elsewhere.
NETWORK_PRIMITIVES_SANS_SUBPROCESS = re.compile(
    r"\b(httpx|requests|urllib|socket|http\.client|ftplib|smtplib"
    r"|os\.system|aiohttp|asyncio\.open_connection)\b"
)
SUBPROCESS_ALLOWED = {
    "publish/build.py",
    # RUN P3-3b: `deploy/upload.py` invokes a PINNED `wrangler pages deploy` as
    # the Cloudflare Pages Direct Upload transport — argv list, never a shell,
    # exactly the GhReleaseBackend shape above, and the command runner is
    # INJECTED so the suite drives the real uploader without spawning anything.
    # It is here rather than using the HTTP API because Direct Upload is not a
    # PUT of a directory: the protocol hashes each asset with blake3 over
    # `base64(content) + extension` and negotiates check-missing/upload/manifest,
    # and blake3 is neither in the standard library nor worth a new dependency
    # to re-implement a client Cloudflare already ships. Note the consequence,
    # which is deliberate: this module gets `subprocess` and NOT httpx, so it
    # cannot grow an HTTP call — every fact it reports is read back through
    # `deploy/cloudflare.py`.
    "deploy/upload.py",
}


def test_owned_source_has_no_network_primitives():
    offending = []
    src_root = REPO_ROOT / "src" / "populus"
    for path in sorted(src_root.rglob("*.py")):
        rel = path.relative_to(src_root).as_posix()
        if rel in HTTPX_ALLOWED:
            pattern = NETWORK_PRIMITIVES_SANS_HTTPX
        elif rel in SUBPROCESS_ALLOWED:
            pattern = NETWORK_PRIMITIVES_SANS_SUBPROCESS
        else:
            pattern = NETWORK_PRIMITIVES
        for line_no, line in enumerate(
            path.read_text(encoding="utf-8").splitlines(), start=1
        ):
            if pattern.search(line):
                offending.append(f"{rel}:{line_no}: {line.strip()}")
    assert offending == []


def test_no_network_fixture_blocks_sockets():
    with pytest.raises(AssertionError):
        socket.getaddrinfo("example.com", 443)
    with pytest.raises(AssertionError):
        socket.create_connection(("127.0.0.1", 9))
