"""Maintenance tooling gates: check_links.sh, check_abs_paths.sh, cross_run_overlap.py.

These three tools were previously inlined into a markdown plan and hand-verified.
That produced four defects markdown review cannot catch: a literal 0x08 byte
where ``\\b`` belonged, a ``grep -v`` wrapper that inverted a gate's exit code,
reliance on an externally exported ``TMPFAIL`` that died under ``set -u``, and a
harness that injected that variable and thus masked the defect.

Three of those four were gates that silently *could not fail*. Every tool here
therefore gets at least one fixture proving it fails on a planted violation --
a green result from an untested gate is worth nothing.

Each fixture builds a real throwaway git repository under ``tmp_path``: all
three tools consult git for their file lists, so a plain directory would exercise
a different code path from the one that runs in CI.
"""

from __future__ import annotations

import importlib.util
import os
import re
import shutil
import subprocess
import sys
import urllib.parse
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
MAINT = REPO_ROOT / "scripts" / "maintenance"
CHECK_LINKS = MAINT / "check_links.sh"
CHECK_ABS = MAINT / "check_abs_paths.sh"
CROSS_RUN = MAINT / "cross_run_overlap.py"


def _git(cwd, *args):
    return subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, check=True
    )


def _init_repo(root: Path) -> Path:
    """A throwaway repo with a deterministic identity and an initial commit."""
    root.mkdir(parents=True, exist_ok=True)
    _git(root, "init", "-q", "-b", "main")
    _git(root, "config", "user.email", "t@example.invalid")
    _git(root, "config", "user.name", "test")
    (root / ".gitkeep").write_text("")
    _git(root, "add", ".gitkeep")
    _git(root, "commit", "-q", "-m", "init")
    return root


def _write(root: Path, rel: str, text: str) -> Path:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)
    return p


def _run_sh(script: Path, cwd: Path, *args, env=None):
    # Explicit `bash`, not the script's shebang: the fixture must exercise the
    # interpreter the gate declares, independent of the file's exec bit surviving
    # a checkout.
    return subprocess.run(
        ["bash", str(script), *args], cwd=cwd, capture_output=True, text=True, env=env
    )


# An unusable TMPDIR: the directory does not exist, so every `mktemp` under it
# must fail. This is the setup-failure probe for BOTH shell gates.
UNUSABLE_TMPDIR = "/definitely/no/such/dir"


def _env_with_bad_tmpdir():
    env = dict(os.environ)
    env["TMPDIR"] = UNUSABLE_TMPDIR
    return env


# --------------------------------------------------------------------------
# Scanner-failure injection
#
# The mktemp fail-open was fixed at the SETUP layer, but the same class lived
# one level down at the SCANNER layer: `pipefail` is set without `errexit`, and
# the scanning pipelines' exit statuses were discarded (piped into `while read`,
# wrapped in `$(...)`, read through `< <(...)`, or collapsed by `|| continue`).
# A dead awk/grep therefore produced zero findings and a confident exit 0 over a
# tree that was never evaluated.
#
# These helpers shadow a scanner on PATH so the failure is real rather than
# simulated by a flag. `git grep` is a git builtin and is NOT affected by a PATH
# `grep`, so the outer file-listing still succeeds and the probe lands squarely
# on the inner scanner under test.
# --------------------------------------------------------------------------

_REAL = {name: shutil.which(name) for name in ("grep", "awk", "sed")}


def _stub_bin(tmp_path, name: str, body: str) -> str:
    """Write an executable ``name`` into a fresh dir; return that dir."""
    d = tmp_path / ("stub_" + name + "_" + str(abs(hash(body)) % 10**8))
    d.mkdir(parents=True, exist_ok=True)
    p = d / name
    p.write_text(body)
    p.chmod(0o755)
    return str(d)


def _env_with_stub(stub_dir: str):
    env = dict(os.environ)
    env["PATH"] = stub_dir + os.pathsep + env.get("PATH", "")
    return env


def _always_fails(name: str) -> str:
    return f'#!/bin/sh\necho "stub {name}: simulated scanner failure" >&2\nexit 2\n'


def _mktemp_fails_for(template_marker: str) -> str:
    """A ``mktemp`` that fails for ONE template and is otherwise the real thing.

    The blanket probe -- an unusable ``TMPDIR`` -- makes EVERY ``mktemp`` fail,
    so the very first guard fires and the later ones are never reached. That is
    how mutation testing found a guard nothing was actually exercising: delete
    the FILELIST check alone and the suite stayed green, while a single failed
    ``mktemp`` produced an empty file list, a ``git grep`` redirect that looks
    exactly like "no match", a loop body that never runs, and **exit 0** over a
    tree that was never opened.
    """
    real = shutil.which("mktemp")
    return (
        "#!/bin/sh\n"
        f'for a in "$@"; do case "$a" in *{template_marker}*)'
        f' echo "stub mktemp: refusing {template_marker}" >&2; exit 1;; esac; done\n'
        f'exec {real} "$@"\n'
    )


def _fails_only_for_flag(name: str, flag: str) -> str:
    """Fail when the first argument carries ``flag``; otherwise be the real tool.

    Needed because check_abs_paths.sh runs three DIFFERENT inner grep stages
    (``-nE``, ``-oE``, ``-qE``). A blanket stub would always trip the first one,
    so the other two guards would never be exercised.
    """
    real = _REAL[name]
    return (
        "#!/bin/sh\n"
        f'case "$1" in *{flag}*) echo "stub {name} -{flag}: simulated failure" >&2; exit 2;; esac\n'
        f'exec {real} "$@"\n'
    )


# --------------------------------------------------------------------------
# check_links.sh
# --------------------------------------------------------------------------


def test_links_real_repo_is_clean():
    """Case: real-repo. The gate must be green on the repository itself."""
    r = _run_sh(CHECK_LINKS, REPO_ROOT)
    assert r.returncode == 0, r.stdout + r.stderr


def test_links_nested_relative_link_fails(tmp_path):
    """Case: nested.

    ``docs/nested/a.md`` links to ``README.md``, which exists only at the repo
    root. Resolving relative links against the *document's* directory is the
    only correct rule; a silent fallback to the repo root let exactly this
    broken link pass.
    """
    root = _init_repo(tmp_path / "nested")
    _write(root, "README.md", "# root\n")
    _write(root, "docs/nested/a.md", "See [readme](README.md).\n")
    _git(root, "add", "-A")
    r = _run_sh(CHECK_LINKS, root)
    assert r.returncode == 1, r.stdout + r.stderr
    assert "docs/nested/a.md -> docs/nested/README.md" in r.stdout


def test_links_tracked_broken_link_and_missing_script_fail(tmp_path):
    """Case: tracked. Committed README with one broken and one good link, plus a
    Makefile naming a script that does not exist."""
    root = _init_repo(tmp_path / "tracked")
    _write(root, "docs/ok.md", "ok\n")
    _write(root, "README.md", "[good](docs/ok.md) and [bad](docs/gone.md)\n")
    _write(root, "Makefile", "run:\n\tpython scripts/missing_tool.py\n")
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "docs")
    r = _run_sh(CHECK_LINKS, root)
    assert r.returncode == 1, r.stdout + r.stderr
    assert "BROKEN LINK: README.md -> ./docs/gone.md" in r.stdout
    assert "BROKEN REF: Makefile -> scripts/missing_tool.py" in r.stdout
    assert "docs/ok.md" not in r.stdout.replace("BROKEN REF: ", "")


def test_links_untracked_file_is_scanned(tmp_path):
    """Case: untracked.

    ``docs/roadmap.md`` is created and NEVER staged. The documentation slice
    creates new files, so a plain ``git grep`` -- which cannot see them until
    they are staged -- would report a clean tree over a broken link.
    """
    root = _init_repo(tmp_path / "untracked")
    _write(root, "docs/roadmap.md", "[missing](../nope.md)\n")
    # deliberately no `git add`
    out = _git(root, "status", "--porcelain", "--untracked-files=all").stdout
    assert "?? docs/roadmap.md" in out
    r = _run_sh(CHECK_LINKS, root)
    assert r.returncode == 1, r.stdout + r.stderr
    assert "BROKEN LINK: docs/roadmap.md" in r.stdout


def test_links_fenced_and_inline_code_are_skipped(tmp_path):
    """Case: fenced.

    A fenced block containing a ``sed`` whose own text holds ``](``, plus an
    inline code span discussing ``](``. Both are Markdown *about* Markdown and
    must not be parsed as links -- the gate once failed on its own fixture table.
    """
    root = _init_repo(tmp_path / "fenced")
    _write(
        root,
        "docs/talk.md",
        "Prose mentioning `](` inline.\n\n"
        "```sh\n"
        "sed -E 's|\\]\\(([^)]*)\\)|//; s/|g' file\n"
        "```\n\n"
        "Trailing prose with an inline `[x](y.md)` span.\n",
    )
    _git(root, "add", "-A")
    r = _run_sh(CHECK_LINKS, root)
    assert r.returncode == 0, r.stdout + r.stderr


def test_links_script_only_violation_fails(tmp_path):
    """Case: script-only -- the case that was never tested.

    A Makefile references ``scripts/definitely_missing.py`` and there is NO
    broken markdown anywhere. This is what exposed that the path matcher was
    inert (it held a literal 0x08 byte where ``\\b`` belonged), because every
    other case was also failing for a link reason.
    """
    root = _init_repo(tmp_path / "script-only")
    _write(root, "README.md", "no links here\n")
    _write(root, "Makefile", "qa:\n\tpython scripts/definitely_missing.py\n")
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "mk")
    r = _run_sh(CHECK_LINKS, root)
    assert r.returncode == 1, r.stdout + r.stderr
    assert "BROKEN REF: Makefile -> scripts/definitely_missing.py" in r.stdout
    assert "BROKEN LINK" not in r.stdout


def test_links_reference_style_broken_definition_fails(tmp_path):
    """Case: reference-style, broken.

    ``[guide]: missing.md`` is a standard Markdown link destination. Only the
    inline ``](...)`` form was parsed, so this whole link form could be broken
    while the gate reported success.
    """
    root = _init_repo(tmp_path / "refbroken")
    _write(root, "docs/a.md", "Read the [guide].\n\n[guide]: missing.md\n")
    _git(root, "add", "-A")
    r = _run_sh(CHECK_LINKS, root)
    assert r.returncode == 1, r.stdout + r.stderr
    assert "BROKEN LINK: docs/a.md -> docs/missing.md" in r.stdout


def test_links_reference_style_valid_definition_passes(tmp_path):
    """Case: reference-style, valid.

    The same form pointing at a file that exists must stay green -- including a
    title-bearing definition, an angle-bracketed one, an http destination and a
    definition indented up to three spaces.
    """
    root = _init_repo(tmp_path / "refok")
    _write(root, "docs/there.md", "ok\n")
    _write(
        root,
        "docs/a.md",
        "[a]: there.md\n"
        '[b]: there.md "Title"\n'
        "[c]: <there.md>\n"
        "[d]: https://example.invalid/x\n"
        "   [e]: there.md\n"
        "[f]: there.md#anchor\n",
    )
    _git(root, "add", "-A")
    r = _run_sh(CHECK_LINKS, root)
    assert r.returncode == 0, r.stdout + r.stderr


def test_links_reference_style_inside_a_fence_is_skipped(tmp_path):
    """A reference definition shown *as an example* inside a fence is not a link."""
    root = _init_repo(tmp_path / "reffence")
    _write(root, "docs/a.md", "```md\n[guide]: missing.md\n```\n")
    _git(root, "add", "-A")
    r = _run_sh(CHECK_LINKS, root)
    assert r.returncode == 0, r.stdout + r.stderr


def test_links_cannot_scan_exits_two(tmp_path):
    """The fail-OPEN regression, and the most serious defect of the set.

    With an unusable ``TMPDIR`` the previous version printed an mktemp error and
    exited **0** -- certifying a tree it had never scanned. Setup failure must be
    a third outcome (2), distinct from both "clean" (0) and "violations" (1).

    Note the script now passes an explicit template to ``mktemp``. Without one,
    BSD ``mktemp`` on this host resolves the darwin per-user temp dir via
    confstr() and ignores ``TMPDIR`` entirely, so this probe could not even
    reach the failure path.
    """
    root = _init_repo(tmp_path / "links_notmp")
    _write(root, "README.md", "clean\n")
    _git(root, "add", "-A")
    r = _run_sh(CHECK_LINKS, root, env=_env_with_bad_tmpdir())
    assert r.returncode == 2, r.stdout + r.stderr
    assert "check_links:" in r.stderr


def test_links_failing_markdown_scanner_exits_two(tmp_path):
    """Defect 2, pipeline 1: a dead ``awk`` must be status 2, never "clean".

    The repository contains exactly one violation and it is a broken MARKDOWN
    link, so the markdown pipeline is the only thing that could report it.
    Measured before the fix: with ``awk`` shadowed by a stub exiting 2, the gate
    exited **0** -- it certified a tree whose every markdown file went unparsed.
    ``pipefail`` was set, but `awk ... | while read` had its status discarded and
    the verdict was taken solely from an empty TMPFAIL.
    """
    root = _init_repo(tmp_path / "links_awk_dead")
    _write(root, "README.md", "See [bad](docs/gone.md)\n")
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "c")
    # Control: the violation really is detected when the scanner works.
    assert _run_sh(CHECK_LINKS, root).returncode == 1

    env = _env_with_stub(_stub_bin(tmp_path, "awk", _always_fails("awk")))
    r = _run_sh(CHECK_LINKS, root, env=env)
    assert r.returncode == 2, r.stdout + r.stderr
    assert "check_links:" in r.stderr
    assert "awk" in r.stderr


def test_links_failing_reference_scanner_exits_two(tmp_path):
    """Defect 2, pipeline 2: a dead ``grep`` must be status 2, never "clean".

    The only violation is a Makefile naming a missing script, so the
    ``grep | sed | sort`` pipeline is the only thing that could report it.
    Measured before the fix: with ``grep`` shadowed, the gate exited **0**. The
    pipeline's status was discarded AND its ``2>/dev/null`` hid the diagnostic.
    """
    root = _init_repo(tmp_path / "links_grep_dead")
    _write(root, "README.md", "no links here\n")
    _write(root, "Makefile", "qa:\n\tpython scripts/definitely_missing.py\n")
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "c")
    assert _run_sh(CHECK_LINKS, root).returncode == 1

    env = _env_with_stub(_stub_bin(tmp_path, "grep", _always_fails("grep")))
    r = _run_sh(CHECK_LINKS, root, env=env)
    assert r.returncode == 2, r.stdout + r.stderr
    assert "check_links:" in r.stderr


def test_links_no_match_is_not_a_scanner_error(tmp_path):
    """The other half of the guard: ``grep`` status 1 is NORMAL.

    A Makefile that names no script makes ``grep -oE`` exit 1. Treating every
    non-zero status as a failure would turn a clean tree into a hard 2 and the
    gate would be switched off within a day.
    """
    root = _init_repo(tmp_path / "links_nomatch")
    _write(root, "README.md", "clean\n")
    _write(root, "Makefile", "qa:\n\techo nothing to see\n")
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "c")
    r = _run_sh(CHECK_LINKS, root)
    assert r.returncode == 0, r.stdout + r.stderr


def test_links_not_a_git_repo_exits_two(tmp_path):
    """A missing git work tree is "could not scan", never "clean"."""
    plain = tmp_path / "plain"
    plain.mkdir()
    (plain / "README.md").write_text("[x](nope.md)\n")
    r = _run_sh(CHECK_LINKS, plain)
    assert r.returncode == 2, r.stdout + r.stderr


def test_links_documents_its_three_exit_codes():
    """The three outcomes must be written down where the next reader will look."""
    header = CHECK_LINKS.read_text().split("set -uo pipefail", 1)[0]
    assert "EXIT STATUS" in header
    for code in ("0", "1", "2"):
        assert re.search(rf"^#\s+{code}\s+\S", header, re.MULTILINE), header


@pytest.mark.parametrize(
    "dest",
    [
        "https://example.invalid/x", "http://example.invalid/x",
        "mailto:someone@example.invalid",
        "tel:+15550000000",              # every one of these below was resolved
        "ftp://example.invalid/x",       # as a RELATIVE FILE and reported broken
        "data:text/plain;base64,eA==",
        "vscode://file/x",
        "//cdn.example.invalid/x.js",    # protocol-relative
        "#a-heading-in-this-file",
    ],
)
def test_links_uri_schemes_are_not_paths(tmp_path, dest):
    """N2: an off-tree destination is skipped, not reported as a broken file.

    The skip list used to be ``https?:``, ``mailto:`` and ``#`` alone, so every
    other scheme and every protocol-relative destination was resolved against
    the document's directory and reported as a BROKEN LINK. That is a false
    POSITIVE, and a gate that cries wolf is switched off exactly as fast as one
    that never fires.
    """
    root = _init_repo(tmp_path / ("scheme_" + re.sub(r"\W", "_", dest))[:60])
    _write(root, "docs/a.md", f"See [x]({dest}) and\n\n[y]: {dest}\n")
    _git(root, "add", "-A")
    r = _run_sh(CHECK_LINKS, root)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "BROKEN" not in r.stdout, r.stdout


def test_links_a_relative_destination_is_still_checked(tmp_path):
    """The other half of the scheme guard: it must not swallow real paths.

    Widening a skip rule until nothing is checked is the same shape as widening
    an allowlist until nothing fails. A plain relative destination still resolves
    against the document's directory and is still reported when it is missing.
    """
    root = _init_repo(tmp_path / "scheme_control")
    _write(root, "docs/a.md", "See [x](gone.md).\n")
    _git(root, "add", "-A")
    r = _run_sh(CHECK_LINKS, root)
    assert r.returncode == 1, r.stdout + r.stderr
    assert "BROKEN LINK: docs/a.md -> docs/gone.md" in r.stdout


def test_links_rejects_an_unexpected_argument(tmp_path):
    """Silently ignoring arguments is a silent drop with a plausible cover story.

    ``check_links.sh --worktree`` -- the spelling the sibling gate REQUIRES --
    used to scan and report success while the operator believed a mode had been
    selected. An unrecognised argument is now a usage error (2).
    """
    root = _init_repo(tmp_path / "links_badarg")
    _write(root, "README.md", "clean\n")
    _git(root, "add", "-A")
    r = _run_sh(CHECK_LINKS, root, "--worktree")
    assert r.returncode == 2, r.stdout + r.stderr
    assert "unexpected argument" in r.stderr


@pytest.mark.parametrize("gate", [CHECK_LINKS, CHECK_ABS],
                         ids=["check_links", "check_abs_paths"])
def test_shell_gates_help_prints_the_contract(tmp_path, gate):
    """``-h`` must print the header, and exit 0, on both gates alike.

    It used to be ``sed -n '2,30p' "$0"`` -- a hardcoded line range that silently
    prints the WRONG text as soon as the header grows (it already had), with
    ``sed``'s status discarded so ``-h`` exited 0 even when it printed nothing.
    """
    root = _init_repo(tmp_path / ("help_" + gate.stem))
    r = _run_sh(gate, root, "-h")
    assert r.returncode == 0, r.stdout + r.stderr
    assert "EXIT STATUS" in r.stdout, r.stdout
    assert "WHAT THIS GUARANTEES" in r.stdout, r.stdout
    assert "WHAT THIS DELIBERATELY DOES NOT COVER" in r.stdout, r.stdout
    # The whole header, not an arbitrary slice of it.
    assert r.stdout.count("\n") > 40, r.stdout


def test_abs_paths_rejects_a_second_ref(tmp_path):
    """Two positional arguments used to make the first vanish in silence."""
    root = _abs_repo(tmp_path, "abs_two_refs", "clean\n")
    r = _run_sh(CHECK_ABS, root, "main", "main")
    assert r.returncode == 2, r.stdout + r.stderr
    assert "at most one REF" in r.stderr


def test_abs_paths_rejects_worktree_plus_ref(tmp_path):
    """`--worktree main` names two different trees; it must not silently pick one."""
    root = _abs_repo(tmp_path, "abs_wt_plus_ref", "clean\n")
    r = _run_sh(CHECK_ABS, root, "--worktree", "main")
    assert r.returncode == 2, r.stdout + r.stderr
    assert "mutually exclusive" in r.stderr


def test_links_runs_verbatim_under_set_u(tmp_path):
    """The TMPFAIL regression: the script must initialise its own temp state.

    An earlier version relied on an exported ``TMPFAIL`` and died with
    ``unbound variable``; the harness that "verified" it exported the variable
    and so could never observe the failure. Run with the environment scrubbed.
    """
    root = _init_repo(tmp_path / "setu")
    _write(root, "README.md", "clean\n")
    _git(root, "add", "-A")
    env = {k: v for k, v in os.environ.items() if k != "TMPFAIL"}
    r = subprocess.run(
        ["bash", "-u", str(CHECK_LINKS)],
        cwd=root, capture_output=True, text=True, env=env,
    )
    assert r.returncode == 0, r.stdout + r.stderr
    assert "unbound variable" not in r.stderr


# --------------------------------------------------------------------------
# check_abs_paths.sh
# --------------------------------------------------------------------------


# The absolute-path gate's own failure fixtures must contain the very strings
# the gate detects, so scanning this file would make `check_abs_paths.sh
# --worktree` permanently red on any branch carrying these tests -- and a gate
# that can never be green gets switched off.
#
# --- OWNER DECISION K8: LITERALS PLUS A DOCUMENTED EXCLUSION -----------------
#
# These three used to be two-fragment concatenations -- `"/Users" + "/"` -- so
# that the literal never appeared in this file's text. The owner has REJECTED
# that: the trick is invisible at the point of use, and a contributor adding a
# test case here cannot be expected to know that writing the path plainly will
# redden an unrelated gate. It is a booby trap, not a convention.
#
# The gate now excludes exactly two files by name -- itself and this file -- so
# these are plain literals. The blind spot that accepts (a real owner path in
# either file is not caught) is documented as N6 in the gate's header and
# pinned by test_abs_paths_self_exclusion_is_exactly_two_named_files.
_USERS = "/Users/"
_HOME = "/home/"
_TMP = "/private/tmp/"
# A path under the runner service account, and a fabricated owner path to pair
# it with. ALLOWED is exempt only on its EXACT recorded line -- see
# SERVICE_ACCOUNT_ALLOW_PAIRS below -- never on its own.
ALLOWED = _USERS + "populusrunner/Library/LaunchAgents/"
OWNER = _USERS + "someone/projects/Populus-ops"


def _abs_repo(tmp_path, name, content, rel="src/note.txt"):
    root = _init_repo(tmp_path / name)
    _write(root, rel, content)
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "c")
    return root


def test_abs_paths_clean_tree_passes(tmp_path):
    root = _abs_repo(tmp_path, "clean", "relative/paths/only.py\nand " + _HOME + " alone\n")
    r = _run_sh(CHECK_ABS, root, "--worktree")
    assert r.returncode == 0, r.stdout + r.stderr


@pytest.mark.parametrize(
    "path",
    [
        _USERS + "JohnDoe/",       # the `[a-z]+` version missed the capital
        _USERS + "john-doe/",      # ... and the hyphen
        _USERS + "john2/",         # ... and the digit
        _USERS + "john_doe/",      # ... and the underscore
        _HOME + "john-doe/",
        _TMP,
    ],
)
def test_abs_paths_detects_every_home_spelling(tmp_path, path):
    """The segment is any non-slash run, not ``[a-z]+``."""
    name = "spell" + path.replace("/", "_")
    root = _abs_repo(tmp_path, name, f'ROOT = "{path}projects/thing"\n')
    r = _run_sh(CHECK_ABS, root, "--worktree")
    assert r.returncode != 0, r.stdout + r.stderr
    assert "ABS PATH" in r.stdout


# Defect F24 fixtures. The home segment the gate's own contract calls "any
# non-slash run" -- spelled three ways. `SPACEY` and `NON_ASCII` both ESCAPED the
# gate entirely before the fix; `PLAIN` is the control that always worked, and it
# is what proves a failing parametrisation is about the segment spelling rather
# than about the fixture harness.
SPACEY = "John Doe"
NON_ASCII = "José"
PLAIN = "johndoe"


def _write_utf8(root: Path, rel: str, text: str) -> Path:
    """Like ``_write``, but pinned to UTF-8.

    ``Path.write_text`` uses the locale encoding, so the non-ASCII fixture below
    would raise ``UnicodeEncodeError`` under an ASCII locale rather than testing
    anything. The gate itself is locale-independent -- verified by running the
    non-ASCII fixture under ``LC_ALL`` of C, POSIX and en_US.UTF-8 -- so pinning
    the fixture's encoding is the only thing needed here.
    """
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    return p


@pytest.mark.parametrize("mode", ["--worktree", "main"])
@pytest.mark.parametrize("segment", [SPACEY, NON_ASCII, PLAIN],
                         ids=["space", "non_ascii", "plain_control"])
def test_abs_paths_home_segment_may_contain_spaces_and_non_ascii(
    tmp_path, mode, segment
):
    """Defect F24: the ASCII-whitelist token extractor let two real spellings escape.

    ``DETECT_RE`` used ``[^/]+`` and matched the line, but ``TOKEN_RE`` extracted
    segments from ``[A-Za-z0-9._~%+@-]`` only, so ``<R>/John Doe/projects/x.db``
    truncated to ``<R>/John`` -- no second slash -- which ``KEEP_RE`` rejected.
    The occurrence was detected at file level and then discarded at occurrence
    level. Measured in a throwaway repository BEFORE the fix, ``--worktree``
    mode. ``<R>`` stands in for the ``_USERS`` root: this file is itself scanned
    by the gate, so a root is never spelled out literally in its prose::

        <R>/John Doe/projects/Populus/data.db      exit 0   ESCAPED
        <R>/Jose-with-an-acute/projects/x.db       exit 0   ESCAPED
        <R>/johndoe/projects/Populus/data.db       exit 1   caught

    Both spellings are ordinary macOS home directory names, so this was a
    real-world escape. Parametrised over BOTH scan modes: the token extractor is
    shared, but only an end-to-end fixture proves the ref-mode path reaches it.
    """
    root = _init_repo(tmp_path / ("f24_" + re.sub(r"\W", "_", segment) + mode.strip("-")))
    _write_utf8(root, "src/note.txt",
                f'DB = "{_USERS}{segment}/projects/Populus/data.db"\n')
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "c")
    r = _run_sh(CHECK_ABS, root, mode)
    assert r.returncode == 1, r.stdout + r.stderr
    # The WHOLE path is reported, not a prefix truncated at the space.
    assert f"{_USERS}{segment}/projects/Populus/data.db" in r.stdout, r.stdout


def test_abs_paths_space_in_a_later_segment_still_fails_closed(tmp_path):
    """The deliberate asymmetry: only the HOME segment absorbs interior spaces.

    A later segment still ends at a space, so ``<R>/johndoe/My Projects/db``
    truncates to ``<R>/johndoe/My``. That token still MATCHES ``KEEP_RE`` --
    its home segment is terminated -- so the occurrence is reported. Truncated in
    the report, but never dropped: fail-closed, which is the property the home
    segment did not have and this test pins for everything after it.
    """
    root = _abs_repo(tmp_path, "f24_later_seg",
                     f'DB = "{_USERS}johndoe/My Projects/db"\n')
    r = _run_sh(CHECK_ABS, root, "--worktree")
    assert r.returncode == 1, r.stdout + r.stderr
    assert f"{_USERS}johndoe/My" in r.stdout, r.stdout


def test_abs_paths_two_paths_separated_by_prose_are_not_merged(tmp_path):
    """The over-capture guard on the relaxed home segment.

    Allowing interior spaces raises the risk that a line reading
    ``<HOME>/ci/build to <USERS>/jane/out`` is swallowed into ONE token, which
    would both mangle the
    report and, worse, let an occurrence-level allowlist comparison miss. It
    cannot happen: a home segment never crosses a ``/`` and a later segment never
    crosses a space, so a second root -- always preceded by whitespace -- starts a
    fresh token. BOTH paths must be reported, separately.
    """
    root = _abs_repo(tmp_path, "f24_no_merge",
                     f"Copy {_HOME}ci/build to {_USERS}jane/out now\n")
    r = _run_sh(CHECK_ABS, root, "--worktree")
    assert r.returncode == 1, r.stdout + r.stderr
    assert f"ABS PATH: src/note.txt:1: {_HOME}ci/build\n" in r.stdout, r.stdout
    assert f"ABS PATH: src/note.txt:1: {_USERS}jane/out\n" in r.stdout, r.stdout


def test_abs_paths_allowlisted_service_account_alone_passes(tmp_path):
    root = _abs_repo(
        tmp_path, "allow",
        f"sudo ls -la {ALLOWED} 2>/dev/null\n",
        rel="docs/runbooks/runner.md",
    )
    r = _run_sh(CHECK_ABS, root, "--worktree")
    assert r.returncode == 0, r.stdout + r.stderr


def test_abs_paths_allowlist_does_not_suppress_the_whole_line(tmp_path):
    """G2, the line-level-suppression regression.

    A line-wide ``grep -v`` filter deleted the entire line, hiding a real owner
    path that shared the line with the allowlisted service-account path.
    Allowlisting must be OCCURRENCE-level.

    Since F26 the exemption is an exact (occurrence, line) PAIR, so the fixture
    has to INJECT a pair whose line carries both paths -- otherwise there is no
    mixed line on which anything is exempt, and the test would pass for the
    trivial reason that nothing was allowlisted at all. Injecting it is what
    makes the assertion real: on that line the service-account occurrence IS
    classified, and the owner path beside it is STILL reported.
    """
    line = f"cp {OWNER}/x.plist {ALLOWED}"
    root = _abs_repo(tmp_path, "mixedline", line + "\n",
                     rel="docs/runbooks/runner.md")
    gate = _abs_with_service_allow(tmp_path, [(ALLOWED, line)])
    r = _run_sh(gate, root, "--worktree")
    assert r.returncode != 0, r.stdout + r.stderr
    assert f"{OWNER}/x.plist" in r.stdout
    assert ALLOWED + "\n" not in r.stdout


# --- F24, THIRD round: detected-but-unparsed is an ANOMALY -------------------
#
# The first two rounds each improved TOKEN_RE's segment class -- `[a-z]+` to an
# ASCII whitelist, then the whitelist to an exclusion list -- and review found
# another real spelling outside the new class each time. These four are the
# spellings that escaped the SECOND round; measured in a throwaway repository
# against the previous revision, `--worktree` mode, ALL exit 0:
#
#     <R>/O(apostrophe)Neil/projects/Populus/db     exit 0   ESCAPED
#     <R>/John(two spaces)Doe/projects/Populus/db   exit 0   ESCAPED
#     <R>/John(Doe)/projects/Populus/db             exit 0   ESCAPED
#
# `'`, `(` and `)` are all excluded from SEGCH deliberately -- they delimit
# string literals and shell groupings -- and a doubled space breaks HOMESEG's
# single-space rule. Every one of them truncated the token to a bare
# `<R>/John`, which KEEP_RE rejects for having no terminated home segment, and
# the line was then treated as CLEAN.
#
# The fix does NOT add these characters to SEGCH, because the next spelling
# would be outside that class too. It makes the FAILURE TO PARSE reportable: a
# line DETECT_RE matched, whose residual still shows a home root followed by a
# segment character after every classified occurrence is deleted, is an
# ANOMALY and exits 1. So these fixtures assert a non-zero exit and an
# `ABS PATH` line of EITHER kind -- pinning which one would re-couple the test
# to parser quality, which is precisely what stopped being load-bearing.
UNPARSEABLE_SEGMENTS = [
    ("apostrophe", "O" + "'" + "Neil"),
    ("double_space", "John  Doe"),
    ("parens", "John(Doe)"),
    ("non_ascii", NON_ASCII),
    ("plain_control", PLAIN),
]


@pytest.mark.parametrize("mode", ["--worktree", "main"])
@pytest.mark.parametrize(("label", "segment"), UNPARSEABLE_SEGMENTS,
                         ids=[lbl for lbl, _ in UNPARSEABLE_SEGMENTS])
def test_abs_paths_unparseable_home_segment_still_fails(tmp_path, mode, label, segment):
    """A home spelling the tokeniser cannot handle is REPORTED, never passed."""
    root = _init_repo(tmp_path / f"f24r3_{label}_{mode.strip('-')}")
    _write_utf8(root, "src/note.txt",
                f'DB = "{_USERS}{segment}/projects/Populus/db"\n')
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "c")
    r = _run_sh(CHECK_ABS, root, mode)
    assert r.returncode == 1, r.stdout + r.stderr
    assert "ABS PATH" in r.stdout, r.stdout
    assert "src/note.txt:1:" in r.stdout, r.stdout


@pytest.mark.parametrize("mode", ["--worktree", "main"])
def test_abs_paths_anomaly_names_the_file_and_line(tmp_path, mode):
    """An anomaly is only useful if the operator can find it. file:line, always."""
    root = _init_repo(tmp_path / f"f24r3_loc_{mode.strip('-')}")
    _write_utf8(root, "src/note.txt",
                "clean first line\n"
                "second line also clean\n"
                f"DB = \"{_USERS}O'Neil/projects/Populus/db\"\n")
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "c")
    r = _run_sh(CHECK_ABS, root, mode)
    assert r.returncode == 1, r.stdout + r.stderr
    assert "ABS PATH ANOMALY: src/note.txt:3: " in r.stdout, r.stdout


# --- the three benign live cases. If any of these goes red, the anomaly rule
# --- is too broad and must be narrowed, NOT allowlisted around.
def test_abs_paths_senate_url_home_is_not_an_anomaly(tmp_path):
    """`/search/home/` -- the Senate eFD URL in tracked source, src/populus/ingest/senate.py.

    The root `/home/` is followed by `"`, which terminates a token and is
    therefore not a segment character. No anomaly, exit 0.
    """
    root = _abs_repo(tmp_path, "benign_senate",
                     f'HOME_URL = f"{{EFD_BASE}}/search{_HOME}"\n',
                     rel="src/populus/ingest/senate.py")
    r = _run_sh(CHECK_ABS, root, "--worktree")
    assert r.returncode == 0, r.stdout + r.stderr


# The EXACT text of dashboard/test/post/http-status.test.ts:188, assembled from
# fragments so this file is not itself reported. It is the single entry in the
# gate's content-keyed ANOMALY_ALLOW, and the three tests below pin all three
# halves of that arrangement: the entry matches the live line, the exemption
# works, and a NEAR-MISS spelling is NOT exempted.
BARE_ROOTS_LINE = (
    '      !text.includes("' + _USERS + '") && !text.includes("' + _HOME + '"),'
)


def test_abs_paths_bare_roots_in_a_string_are_not_an_anomaly(tmp_path):
    """The bare `"<USERS>"` / `"<HOME>"` literals in dashboard/test/post/http-status.test.ts.

    This is the ONE benign live case the structural anomaly rule cannot acquit
    on its own, and the gate says so out loud rather than bending the rule.

    DETECT_RE matches the line -- not because either literal names a machine,
    but because its ``[^/]+`` BRIDGES from the first root across
    ``") && !text.includes("`` to the leading ``/`` of the second. TOKEN_RE then
    extracts two bare-root occurrences, KEEP_RE accepts neither, so zero of two
    classify. Under the count rule that is an anomaly, correctly: the parser
    genuinely could not account for what the detector found.

    It cannot be acquitted structurally, and the reason is worth writing down.
    After ``<USERS>/`` this line reads ``"``. So does
    ``<USERS>/"John Doe"/projects/x``, an escape spelling that MUST be reported.
    The two are byte-identical for as far as any local test can see, so any
    character class that rejects one rejects the other, and classifying a bare
    root as benign would re-open all six escapes at once. Hence an exemption
    keyed by exact CONTENT -- see the next two tests.
    """
    root = _abs_repo(
        tmp_path, "benign_bare_roots",
        BARE_ROOTS_LINE + "\n",
        rel="dashboard/test/post/http-status.test.ts",
    )
    r = _run_sh(CHECK_ABS, root, "--worktree")
    assert r.returncode == 0, r.stdout + r.stderr


def test_abs_paths_anomaly_allowlist_entry_matches_the_live_line():
    """Ground truth: the exemption must describe a line that actually exists.

    A content key that matches nothing is a dead entry nobody notices, and the
    line it was meant to cover goes red on the next scan. Assert BOTH ends --
    the gate holds this exact string, and the repository holds it too.
    """
    entries = _anomaly_allow_entries()
    assert BARE_ROOTS_LINE in entries, entries
    live = (REPO_ROOT / "dashboard" / "test" / "post" / "http-status.test.ts")
    if not live.is_file():
        pytest.skip("dashboard/test/post/http-status.test.ts is not in this tree")
    assert BARE_ROOTS_LINE in live.read_text(encoding="utf-8").splitlines(), (
        "the exemption no longer matches any line of the file it names -- "
        "re-pin it or delete it"
    )


def test_abs_paths_anomaly_allowlist_is_content_keyed(tmp_path):
    """A NEAR-MISS spelling is not exempted, and no line NUMBER is involved.

    The previous revision keyed this table by ``file:line``, which silently
    transfers to whatever text drifts into that position. A content key cannot:
    change the line at all -- here, two leading spaces instead of six -- and the
    exemption stops matching and the anomaly is reported again. Fail-CLOSED.
    """
    near_miss = BARE_ROOTS_LINE.lstrip(" ")
    assert near_miss != BARE_ROOTS_LINE
    root = _abs_repo(
        tmp_path, "bare_roots_near_miss", near_miss + "\n",
        rel="dashboard/test/post/http-status.test.ts",
    )
    r = _run_sh(CHECK_ABS, root, "--worktree")
    assert r.returncode == 1, r.stdout + r.stderr
    assert "ABS PATH ANOMALY: dashboard/test/post/http-status.test.ts:1:" in r.stdout
    # And the table itself holds no `path:digits` key.
    for entry in _anomaly_allow_entries():
        assert not re.search(r"^[^\s]+:\d+$", entry), (
            f"{entry!r} is keyed by file:line, which is the fail-open this "
            f"table was re-keyed to avoid"
        )


def test_abs_paths_allowlisted_occurrence_is_deleted_before_the_anomaly_test(tmp_path):
    """The allowlisted service-account path must not become an anomaly.

    It tokenises and matches ALLOW, so it is a CLASSIFIED occurrence and is
    deleted from the residual before ANOM_RE runs. Written as a line-level
    "this line was handled" flag instead, the deletion would also mask a second,
    unparseable path on the same line -- which the next test pins.
    """
    root = _abs_repo(
        tmp_path, "benign_allow_anom",
        f"sudo ls -la {ALLOWED} 2>/dev/null\n",
        rel="docs/runbooks/runner.md",
    )
    r = _run_sh(CHECK_ABS, root, "--worktree")
    assert r.returncode == 0, r.stdout + r.stderr


def test_abs_paths_allowlisted_path_does_not_mask_an_unparseable_one(tmp_path):
    """Occurrence-level deletion, not a line-level handled flag.

    The 2026 regression this mirrors: a line-wide filter let an allowlisted
    path suppress a real one sharing its line. The anomaly rule must not
    reintroduce it -- classifying ONE occurrence on a line cannot certify the
    rest of the line.
    """
    line = f"cp {_USERS}O'Neil/x.plist {ALLOWED}"
    root = _abs_repo(tmp_path, "allow_plus_unparseable", line + "\n",
                     rel="docs/runbooks/runner.md")
    # The pair is INJECTED for the same reason as in the mixed-line test above:
    # without it nothing on this line is exempt and the assertion would hold
    # vacuously. With it, 1 of 2 occurrences classify -- and 1 < 2 is what
    # reports the line.
    gate = _abs_with_service_allow(tmp_path, [(ALLOWED, line)])
    r = _run_sh(gate, root, "--worktree")
    assert r.returncode == 1, r.stdout + r.stderr
    assert "ABS PATH ANOMALY: docs/runbooks/runner.md:1: " in r.stdout, r.stdout


# --- F24, THIRD round: the anomaly rule consults NO character class ----------
#
# The SECOND round had the right idea -- make failure to classify impossible to
# hide -- and then implemented it as `ANOM_RE`, a second character-class check
# reusing `SEGCH`. That put the parser's quality straight back on the critical
# path, and six more real spellings walked through. Measured against that
# revision in a throwaway repository, ALL exit 0 in BOTH modes:
#
#     <R>/"John Doe"/projects/x        exit 0  ESCAPED
#     <R>/'John Doe'/projects/x        exit 0  ESCAPED
#     <R>/(John)/projects/x            exit 0  ESCAPED
#     <R>/[John]/projects/x            exit 0  ESCAPED
#     <R>/$USER/projects/x             exit 0  ESCAPED
#     <H>/{ci}/build/x                 exit 0  ESCAPED
#
# Each matched DETECT_RE, produced ONE rejected bare-root token, and then failed
# `ANOM_RE` because the character after the root -- `"`, `'`, `(`, `[`, `$`, `{`
# -- is deliberately EXCLUDED from SEGCH. Every one of those characters is
# simultaneously a legitimate token terminator AND a real first character of a
# home directory as written in shell or in source, so no membership test can be
# right about both.
ESCAPE_SPELLINGS = [
    ("double_quoted", _USERS + '"John Doe"/projects/x'),
    ("single_quoted", _USERS + "'John Doe'/projects/x"),
    ("parens", _USERS + "(John)/projects/x"),
    ("brackets", _USERS + "[John]/projects/x"),
    ("shell_var", _USERS + "$USER/projects/x"),
    ("brace_home", _HOME + "{ci}/build/x"),
]


@pytest.mark.parametrize("mode", ["--worktree", "main"])
@pytest.mark.parametrize(("label", "path"), ESCAPE_SPELLINGS,
                         ids=[lbl for lbl, _ in ESCAPE_SPELLINGS])
def test_abs_paths_every_escape_spelling_is_reported(tmp_path, mode, label, path):
    """All six measured escapes, in BOTH scan modes. This is guarantee G1.

    The assertion is deliberately on the EXIT CODE and on `file:line`, not on
    which KIND of report is produced. Pinning "this must be an ANOMALY rather
    than a violation" would re-couple the test to parser quality -- precisely
    what stopped being load-bearing.
    """
    root = _init_repo(tmp_path / f"escape_{label}_{mode.strip('-')}")
    _write_utf8(root, "src/note.txt", f"P = {path}\n")
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "c")
    r = _run_sh(CHECK_ABS, root, mode)
    assert r.returncode == 1, r.stdout + r.stderr
    assert "ABS PATH" in r.stdout, r.stdout
    assert "src/note.txt:1:" in r.stdout, r.stdout


def _anomaly_decision_source() -> str:
    """The CODE of the anomaly decision, comments stripped.

    Comments are removed deliberately: the block explains at length why it does
    not consult DETECT_RE or SEGCH, and a naive substring scan would flag its
    own rationale. What is being pinned is the executable shape.
    """
    src = CHECK_ABS.read_text(encoding="utf-8")
    start = src.index("# STAGE E: the ANOMALY test.")
    end = src.index('echo "ABS PATH ANOMALY:', start)
    lines = [ln for ln in src[start:end].splitlines()
             if not ln.lstrip().startswith("#")]
    body = "\n".join(lines).strip()
    assert body, "the anomaly decision has no executable code left -- check the markers"
    return body


def test_abs_paths_anomaly_rule_consults_no_character_class():
    """Guarantee G1, read off the source rather than sampled from inputs.

    Behavioural tests can only try the spellings someone thought of, and this
    defect has now survived two rounds of exactly that. So this reads the
    decision itself and forbids the SHAPE: the anomaly test may name no pattern
    variable, run no matcher, and contain no bracket expression. It is a
    comparison of two integers or it is wrong.
    """
    decision = _anomaly_decision_source()
    for banned in ("SEGCH", "BOUNDCH", "NOTSEG", "DETECT_RE", "KEEP_RE",
                   "TOKEN_RE", "ANOM_RE",
                   "grep", "awk", "sed", "[^", "[a-", "[A-"):
        assert banned not in decision, (
            f"the anomaly decision names {banned!r}; it must consult nothing "
            f"but the two counters:\n{decision}"
        )
    # And no ANOM-prefixed regex variable may exist anywhere in the file: the
    # previous revision's escape hatch was exactly such a variable.
    src = CHECK_ABS.read_text(encoding="utf-8")
    assert not re.search(r"^\s*ANOM[A-Z_]*_RE=", src, re.MULTILINE), src


def _mutant_with_character_class_qualifier(tmp_path) -> Path:
    """The gate with the PREVIOUS revision's `ANOM_RE` qualifier put back.

    A faithful reconstruction: a line is an anomaly only if, in addition to the
    count comparison, a root is followed by a SEGCH character. That is the
    revision six spellings escaped.
    """
    src = CHECK_ABS.read_text(encoding="utf-8")
    guard = (
        '    if [ "$extracted" -gt 0 ] && [ "$classified" -ge "$extracted" ]; then\n'
        "      continue\n"
        "    fi\n"
    )
    assert guard in src, "the anomaly decision moved -- update this mutation"
    mutated = guard + (
        '    printf \'%s\\n\' "$text" '
        '| grep -qE "($USERS_ROOT|$HOME_ROOT|$TMP_ROOT)$SEGCH" || continue\n'
    )
    dst = tmp_path / "check_abs_paths_mutant.sh"
    dst.write_text(src.replace(guard, mutated, 1), encoding="utf-8")
    dst.chmod(0o755)
    return dst


@pytest.mark.parametrize(("label", "path"), ESCAPE_SPELLINGS,
                         ids=[lbl for lbl, _ in ESCAPE_SPELLINGS])
def test_abs_paths_character_class_qualifier_mutant_is_caught(tmp_path, label, path):
    """MUTATION TEST. Re-introducing a character-class qualifier must be caught.

    The mutant is the previous revision's rule, reconstructed. If it exits 0 on
    a spelling the real gate reports, the escape is back -- and the assertion
    below is what turns that into a red test rather than a green release. Both
    halves are asserted, because a mutant that also fails would prove nothing
    about which of the two rules is doing the work.
    """
    root = _init_repo(tmp_path / f"mutant_{label}")
    _write_utf8(root, "src/note.txt", f"P = {path}\n")
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "c")

    assert _run_sh(CHECK_ABS, root, "--worktree").returncode == 1, \
        "control: the real gate must report this spelling"

    mutant = _mutant_with_character_class_qualifier(tmp_path)
    r = _run_sh(mutant, root, "--worktree")
    assert r.returncode == 0, (
        "the character-class mutant unexpectedly still reports this spelling, "
        "so this fixture proves nothing about the mutation\n" + r.stdout + r.stderr
    )


# --- a root is only a root when it is not the tail of a longer path ----------
@pytest.mark.parametrize(
    ("label", "content"),
    [
        # The Senate eFD URL, with a LATER slash on the same line -- which is
        # what made `[^/]+` bridge and what made five real prose lines red.
        ("senate_url_with_later_slash",
         'URL = f"{EFD_BASE}/search' + _HOME + '" and POST /search/report/data/\n'),
        # A `Users` directory nested inside something else.
        ("nested_users_dir", "cp /var" + _USERS + "shared/x /tmp/y\n"),
    ],
)
def test_abs_paths_root_inside_a_longer_path_is_not_detected(tmp_path, label, content):
    """`/search/home/` is a URL segment, not a home directory.

    Before the NOTSEG rule these lines bridged from the false root across prose
    to an unrelated later `/`, and once the anomaly rule stopped consulting a
    character class they went RED -- five of them in files this run cannot even
    edit (ARCHITECTURE.md, HANDOFF-REVIEW.md). The rule is structural: a home
    root is preceded by nothing, or by a character that cannot continue the
    preceding path segment.
    """
    root = _abs_repo(tmp_path, "notseg_" + label, content)
    r = _run_sh(CHECK_ABS, root, "--worktree")
    assert r.returncode == 0, r.stdout + r.stderr


# --- F27: the boundary rule is not an ASCII character class -----------------
#
# `NOTWORD="(^|[^A-Za-z0-9_])"` was the same ASCII-class mistake the anomaly
# rule had just been rewritten to remove, relocated one layer down. An ASCII
# not-word class describes English identifiers, not paths, and it was wrong in
# BOTH directions. These two are legitimate RELATIVE strings that were measured
# at exit 1 on the previous revision, in both modes -- a false positive is the
# worst failure a gate can have, because the way out is to switch it off.
LEGITIMATE_RELATIVE_BEFORE_A_ROOT = [
    # A directory name ending in a non-ASCII letter. The trailing byte of the
    # UTF-8 sequence is not in [A-Za-z0-9_], so the old rule saw a boundary.
    ("non_ascii_tail", "café" + _USERS + "john/projects/x"),
    # A directory name ending in a hyphen. `-` is not a word character either.
    ("hyphen_tail", "cache-" + _USERS + "john/projects/x"),
]


@pytest.mark.parametrize("mode", ["--worktree", "main"])
@pytest.mark.parametrize(("label", "content"), LEGITIMATE_RELATIVE_BEFORE_A_ROOT,
                         ids=[lbl for lbl, _ in LEGITIMATE_RELATIVE_BEFORE_A_ROOT])
def test_abs_paths_legitimate_relative_segment_before_a_root_is_clean(
    tmp_path, mode, label, content
):
    """A root preceded by a SEGMENT character continues a relative path."""
    root = _init_repo(tmp_path / f"f27_{label}_{mode.strip('-')}")
    _write_utf8(root, "src/note.txt", f"P = {content}\n")
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "c")
    r = _run_sh(CHECK_ABS, root, mode)
    assert r.returncode == 0, (
        "a legitimate relative string made the gate UNPASSABLE\n"
        + r.stdout + r.stderr
    )


def test_abs_paths_boundary_is_the_complement_of_the_segment_class():
    """SEGCH and BOUNDCH are one decision written twice; they must agree.

    Read off the source, because the whole point of F27 is that there must be
    exactly ONE definition of "could this byte have continued a path segment".
    Two definitions that drift apart is how the ASCII class survived a review
    that had already banned it one layer up.
    """
    src = CHECK_ABS.read_text(encoding="utf-8")
    seg = re.search(r'^SEGCH="(.*)"$', src, re.M)
    bound = re.search(r'^BOUNDCH="(.*)"$', src, re.M)
    assert seg and bound, src
    assert seg.group(1).startswith("[^"), seg.group(1)
    assert bound.group(1) == "[" + seg.group(1)[2:], (
        "BOUNDCH must be SEGCH without its negating caret, character for "
        f"character: {seg.group(1)!r} vs {bound.group(1)!r}"
    )
    # And NOTSEG must be built from BOUNDCH, not from a third spelling.
    assert 'NOTSEG="(^|$BOUNDCH)"' in src, src


def test_abs_paths_file_url_triple_slash_is_a_violation_not_an_anomaly(tmp_path):
    """A `file:` URL's third slash opens a path; the token must normalise.

    `/` is a boundary character, so the raw token carries a borrowed leading
    slash and reads `//Users/...`. The old `strip_notword` kept any token
    beginning with `/` verbatim, KEEP_RE rejects a doubled slash, and a real
    machine path was demoted from a VIOLATION to an anomaly. `strip_boundary`
    anchors on the roots instead, which is decidable.
    """
    root = _abs_repo(tmp_path, "file_url",
                     f'U = "file://{_USERS}john/projects/x"\n')
    r = _run_sh(CHECK_ABS, root, "--worktree")
    assert r.returncode == 1, r.stdout + r.stderr
    assert f"ABS PATH: src/note.txt:1: {_USERS}john/projects/x" in r.stdout, r.stdout


# The representations R3 explicitly does NOT cover (header N4). They are listed
# here so that "we know about these" is a fact in the test suite rather than a
# claim in a comment: if someone later closes one, this test goes red and they
# have to update N4 and the plan's Tech Debt section in the same change.
#
# The last three are family FOUR, added by F32: a LITERAL single-line path whose
# root abuts a character that could itself end a relative path segment. They are
# here rather than fixed because the fix is a character-class widening, and that
# widening was measured to break the legitimate relative strings pinned by
# test_abs_paths_abutting_segment_character_false_positives_stay_clean below.
# See the "WHY THE FOURTH IS A BOUNDARY" block in the gate header.
UNSUPPORTED_REPRESENTATIONS = [
    ("variable_root", "P=$PREFIX" + _USERS + "john/projects/x"),
    ("string_concat", 'P="' + _USERS.rstrip("/") + '" + "/john/projects/x"'),
    ("hex_escape", 'P="\\x2fUsers\\x2fjohn\\x2fprojects"'),
    ("abut_em_dash", "Owner path—" + _USERS + "john/projects/x"),
    ("abut_arrow", "Owner path→" + _USERS + "john/projects/x"),
    ("abut_bang", "Owner path!" + _USERS + "john/projects/x"),
]

# The other side of the SAME rule, and the reason family four is not closed by
# widening BOUNDCH. Every one of these is an ordinary RELATIVE string whose
# first segment merely ends in a character that is legal in a filename -- POSIX
# forbids only `/` and NUL -- so a class wide enough to catch the three
# `abut_*` cases above reports all of these as machine paths. `cafe` and
# `cache-` are the two F27 regressions that made this gate unpassable; the other
# three are the F32 characters, verified as real directory names on disk.
#
# This test and the `abut_*` parameters above are a MATCHED PAIR: they must be
# read together, because either one alone reads as a bug.
ABUTTING_FALSE_POSITIVE_CONTROLS = [
    ("cafe_acute", "café" + _USERS + "john/x"),
    ("trailing_hyphen", "cache-" + _USERS + "john/x"),
    ("trailing_em_dash", "notes—" + _USERS + "john/x"),
    ("trailing_arrow", "step→" + _USERS + "john/x"),
    ("trailing_bang", "build!" + _USERS + "john/x"),
]


@pytest.mark.parametrize("mode", ["--worktree", "main"])
@pytest.mark.parametrize(
    ("label", "content"), ABUTTING_FALSE_POSITIVE_CONTROLS,
    ids=[lbl for lbl, _ in ABUTTING_FALSE_POSITIVE_CONTROLS],
)
def test_abs_paths_abutting_segment_character_false_positives_stay_clean(
    tmp_path, mode, label, content
):
    """F27 and F32, held open from both sides at once.

    A relative directory name may end in any byte a filesystem permits. If one
    of these goes RED, someone widened BOUNDCH to chase the `abut_*` family and
    reintroduced the false-positive class that made this gate unpassable -- the
    outcome a gate can least afford, because the way out of it is to switch the
    gate off.
    """
    root = _abs_repo(tmp_path, f"fp_{label}_{mode.strip('-')}", content + "\n")
    r = _run_sh(CHECK_ABS, root, mode)
    assert r.returncode == 0, (
        "a LEGITIMATE relative path is being reported as a machine path -- "
        "BOUNDCH was widened to chase N4 family four; revert it and reread the "
        "'WHY THE FOURTH IS A BOUNDARY' block in the gate header\n"
        + r.stdout + r.stderr
    )


@pytest.mark.parametrize("mode", ["--worktree", "main"])
@pytest.mark.parametrize(("label", "content"), UNSUPPORTED_REPRESENTATIONS,
                         ids=[lbl for lbl, _ in UNSUPPORTED_REPRESENTATIONS])
def test_abs_paths_declared_unsupported_representations_are_really_unsupported(
    tmp_path, mode, label, content
):
    """N4, asserted rather than asserted-about.

    Each of these requires EVALUATING the source -- knowing whether $PREFIX is
    empty, performing a concatenation, decoding an escape -- which a line-
    oriented text scanner cannot do. Chasing them would mean interpreting the
    host language. They are named limitations, and this test is what stops the
    naming from quietly going stale in either direction.
    """
    root = _abs_repo(tmp_path, f"n4_{label}_{mode.strip('-')}", content + "\n")
    r = _run_sh(CHECK_ABS, root, mode)
    assert r.returncode == 0, (
        "this representation is now DETECTED -- update N4 in the gate header "
        "and the plan's Tech Debt section, then delete this fixture\n"
        + r.stdout + r.stderr
    )


def test_abs_paths_header_names_every_unsupported_representation():
    """N4 must actually enumerate them, not gesture at them."""
    src = CHECK_ABS.read_text(encoding="utf-8")
    n4 = src[src.index("#   N4  "):src.index("#   N5  ")]
    for phrase in ("VARIABLE-ROOTED", "STRING-LITERAL", "ESCAPED",
                   "ABUTTING-SEGMENT-CHARACTER"):
        assert phrase in n4, (phrase, n4)
    # The COUNT is asserted too. Three rounds of this gate ended with a family
    # discovered after the header had already declared the list closed, so the
    # header's own number must move in the same edit as the list.
    assert "FOUR families" in n4, n4
    assert len(UNSUPPORTED_REPRESENTATIONS) == 6, UNSUPPORTED_REPRESENTATIONS


def test_abs_paths_n4_states_the_boundary_r3_actually_delivers():
    """R3's scope sentence must say BOUNDARY, not merely LITERAL.

    F32's finding was not that the gate misbehaved -- it was that the header
    claimed a detection boundary the gate does not deliver. `Owner path<em>/...`
    is literal, single-line, and undetected. A scope sentence that says only
    "written LITERALLY in a single source line" is therefore false, and this
    test is what stops it from being written that way again.
    """
    src = CHECK_ABS.read_text(encoding="utf-8")
    n4 = src[src.index("#   N4  "):src.index("#   N5  ")]
    scope = n4[n4.index("R3's stated scope"):]
    assert "STARTING AT A BOUNDARY" in scope, scope
    for anchor in ("start of line", "BOUNDCH"):
        assert anchor in scope, (anchor, scope)


# --- K8: the self-reference exclusion ---------------------------------------
def test_abs_paths_self_exclusion_is_exactly_two_named_files():
    """The owner's decision, read off the source.

    Two files, by exact name. NOT a directory, NOT a glob: a directory-shaped
    exclusion would silently swallow the next file added beside them, which is
    the blind spot the decision was careful to bound.
    """
    entries = _bash_array_entries("SELF_EXCLUDES")
    assert entries == [
        ":(exclude)scripts/maintenance/check_abs_paths.sh",
        ":(exclude)tests/test_maintenance_tooling.py",
    ], entries
    for e in entries:
        assert "*" not in e, f"a glob is not a named file: {e}"


def test_abs_paths_fragment_concatenation_is_gone():
    """K8: the roots are LITERALS in both files now.

    The owner rejected the two-fragment trick as an implicit booby trap. A
    regression would be invisible in behaviour -- the gate stays green either
    way -- so it is pinned structurally.
    """
    for src_path in (CHECK_ABS, Path(__file__)):
        # COMMENT lines are excluded: N4 in the gate header QUOTES a string
        # concatenation as an example of what the scanner cannot read, and a
        # ban that cannot tell an example from an occurrence is the same
        # substring-matching mistake this suite keeps finding elsewhere.
        src = "\n".join(ln for ln in src_path.read_text(encoding="utf-8").splitlines()
                        if not ln.lstrip().startswith("#"))
        for root in ("/Users", "/home", "/private", "/private/tmp"):
            # Assembled at RUN TIME. Writing the banned fragments literally
            # would make this test match its own source -- the self-reference
            # trap K8 is about, reappearing inside the test that pins K8.
            for frag in (root + '""', root + '" + "'):
                assert frag not in src, (src_path.name, frag)
    assert 'USERS_ROOT="/Users/"' in CHECK_ABS.read_text(encoding="utf-8")


@pytest.mark.parametrize("mode", ["--worktree", "main"])
def test_abs_paths_excluded_files_are_not_scanned_but_neighbours_are(tmp_path, mode):
    """The blind spot, measured -- and its exact edge.

    An owner path planted in either excluded file is NOT reported (that is N6,
    and it is the price of the decision). The SAME content in a sibling file in
    the SAME directory IS reported, which is what proves the exclusion is two
    named files rather than a directory.
    """
    root = _init_repo(tmp_path / f"k8_{mode.strip('-')}")
    leak = f'DB = "{OWNER}/snapshots/x.db"\n'
    for rel in ("scripts/maintenance/check_abs_paths.sh",
                "tests/test_maintenance_tooling.py"):
        _write(root, rel, leak)
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "c")
    r = _run_sh(CHECK_ABS, root, mode)
    assert r.returncode == 0, (
        "the two self-referencing files must not be scanned\n" + r.stdout + r.stderr
    )

    # A neighbour in the same directory is in scope.
    _write(root, "scripts/maintenance/check_links.sh", leak)
    _write(root, "tests/test_other.py", leak)
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "neighbours")
    r = _run_sh(CHECK_ABS, root, mode)
    assert r.returncode == 1, r.stdout + r.stderr
    assert "scripts/maintenance/check_links.sh:1:" in r.stdout, r.stdout
    assert "tests/test_other.py:1:" in r.stdout, r.stdout


def test_abs_paths_false_root_beside_a_real_one_is_not_an_anomaly(tmp_path):
    """DETECT_RE and TOKEN_RE must agree about what a root is.

    Give TOKEN_RE the NOTSEG rule and DETECT_RE not, or the reverse, and a line
    carrying BOTH a real machine path and a `/search/home/` URL prefilters in on
    the real one, the URL's false root extracts as an unclassifiable bare-root
    occurrence, and the line is reported as an anomaly on top of a perfectly
    good violation. One rule, applied at both layers.
    """
    root = _abs_repo(
        tmp_path, "notword_mixed",
        f'FETCH("{{BASE}}/search{_HOME}") ; DB = "{OWNER}/x.db"\n',
    )
    r = _run_sh(CHECK_ABS, root, "--worktree")
    assert r.returncode == 1, r.stdout + r.stderr
    assert f"ABS PATH: src/note.txt:1: {OWNER}/x.db" in r.stdout, r.stdout
    assert "ANOMALY" not in r.stdout, r.stdout


@pytest.mark.parametrize("flag", ["n", "o", "q"])
def test_abs_paths_anomaly_stage_fails_closed(tmp_path, flag):
    """The anomaly test is a grep stage, so it obeys the same status discipline.

    A tree whose ONLY finding is an anomaly (correct verdict 1) must exit 2, not
    0, when a scanner is broken. Written as `|| continue` -- the shape stage B
    once had -- a broken grep would look exactly like a clean residual and the
    escape would be silently back.
    """
    root = _abs_repo(tmp_path, f"anom_deadgrep_{flag}",
                     f'DB = "{_USERS}O\'Neil/projects/Populus/db"\n')
    stub = _stub_bin(tmp_path, "grep", _fails_only_for_flag("grep", flag))
    r = _run_sh(CHECK_ABS, root, "--worktree", env=_env_with_stub(stub))
    assert r.returncode == 2, r.stdout + r.stderr


def _bash_squote(s: str) -> str:
    """``s`` as a bash single-quoted literal, safe for any byte but newline."""
    return "'" + s.replace("'", "'\\''") + "'"


def _bash_array_entries(name: str) -> list[str]:
    """A bash array declared in the gate, as bash itself expands it.

    Read by EVALUATING the declaration rather than by re-implementing bash
    quoting in Python. A Python-side re-implementation is exactly the kind of
    second, subtly-different parser this tooling keeps being bitten by -- and
    these arrays carry ``"``, ``$``, ``'`` and a trailing backslash.
    """
    src = CHECK_ABS.read_text(encoding="utf-8")
    m = re.search(rf"^{name}=\(\n(.*?)^\)$", src, re.S | re.M)
    assert m, f"{name} array not found -- update this helper"
    prog = (
        f"{name}=(\n" + m.group(1) + ")\n"
        f'for e in ${{{name}+"${{{name}[@]}}"}}; do printf "%s\\n" "$e"; done\n'
    )
    r = subprocess.run(["bash", "-c", prog], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return r.stdout.splitlines()


def _anomaly_allow_entries() -> list[str]:
    return _bash_array_entries("ANOMALY_ALLOW")


def _abs_with_service_allow(tmp_path, pairs) -> Path:
    """A copy of the gate with extra ``(occurrence, line)`` exemption pairs.

    The two arrays are parallel and the gate refuses to run if their lengths
    disagree, so both halves are spliced in the same order in one call -- a
    helper that could add to only one of them would be a way to write a test
    that never runs the code it claims to test.
    """
    src = CHECK_ABS.read_text(encoding="utf-8")
    for marker, idx in (("SERVICE_ALLOW_OCC=(\n", 0), ("SERVICE_ALLOW_LINE=(\n", 1)):
        assert marker in src, f"{marker!r} not found -- update this helper"
        body = "".join("  " + _bash_squote(p[idx]) + "\n" for p in pairs)
        src = src.replace(marker, marker + body, 1)
    dst = tmp_path / "check_abs_paths_svc.sh"
    dst.write_text(src, encoding="utf-8")
    dst.chmod(0o755)
    return dst


def _abs_with_anomaly_allow(tmp_path, entries: list[str]) -> Path:
    """A copy of the gate whose ``ANOMALY_ALLOW`` array holds ``entries``.

    Entries are single-quoted, so a key containing ``"``, ``$`` or a backslash
    -- all of which real source lines carry -- lands in the array verbatim
    instead of being mangled by bash expansion inside a double-quoted string.
    """
    src = CHECK_ABS.read_text(encoding="utf-8")
    marker = "ANOMALY_ALLOW=(\n"
    assert marker in src, "ANOMALY_ALLOW array not found -- update this helper"
    body = "".join("  " + _bash_squote(e) + "\n" for e in entries)
    dst = tmp_path / "check_abs_paths_allow.sh"
    dst.write_text(src.replace(marker, marker + body, 1), encoding="utf-8")
    dst.chmod(0o755)
    return dst


def test_abs_paths_anomaly_allowlist_actually_works(tmp_path):
    """The escape hatch must be exercised, not merely documented.

    ``ANOMALY_ALLOW`` is EMPTY in the committed script -- deliberately, see the
    reasoning there. An empty, never-executed array is code nobody has run, and
    the first person to need it would be the one to discover it was wrong. bash
    3.2 in particular has no empty-array expansion that is safe under ``set -u``,
    so the loop uses the ``${x+"${x[@]}"}`` guard; this test is what proves that
    guard works BOTH ways.
    """
    line = f'DB = "{_USERS}O\'Neil/projects/Populus/db"'
    root = _abs_repo(tmp_path, "anom_allow", line + "\n")
    # Without an entry: reported, exit 1.
    r = _run_sh(CHECK_ABS, root, "--worktree")
    assert r.returncode == 1, r.stdout + r.stderr
    assert "ABS PATH ANOMALY: src/note.txt:1: " in r.stdout, r.stdout

    # With the exact LINE CONTENT as the key: suppressed, exit 0.
    gate = _abs_with_anomaly_allow(tmp_path, [line])
    r = _run_sh(gate, root, "--worktree")
    assert r.returncode == 0, r.stdout + r.stderr
    assert "ANOMALY" not in r.stdout, r.stdout

    # A NEAR-MISS key must not suppress it: the exemption is keyed by EXACT
    # content, so almost-right text is inert rather than approximately right.
    gate = _abs_with_anomaly_allow(tmp_path, [line + " ", "unrelated content"])
    r = _run_sh(gate, root, "--worktree")
    assert r.returncode == 1, r.stdout + r.stderr
    assert "ABS PATH ANOMALY: src/note.txt:1: " in r.stdout, r.stdout

    # And the OLD key shape -- `file:line` -- must now be completely inert.
    # This is the regression that matters: if the loop still compared against
    # `$f:$lineno`, this entry would suppress the anomaly and the fail-open
    # would be back with no test noticing.
    gate = _abs_with_anomaly_allow(tmp_path, ["src/note.txt:1"])
    r = _run_sh(gate, root, "--worktree")
    assert r.returncode == 1, r.stdout + r.stderr
    assert "ABS PATH ANOMALY: src/note.txt:1: " in r.stdout, r.stdout


def test_abs_paths_anomaly_allowlist_does_not_suppress_a_real_occurrence(tmp_path):
    """The hatch covers ANOMALIES only -- it can never hide a parsed violation.

    Otherwise it would be a general-purpose "make this line green" switch, which
    is how the original line-wide ``grep -v`` allowlist hid a real owner path.
    """
    root = _abs_repo(tmp_path, "anom_allow_scope",
                     f'DB = "{OWNER}/x"\n')
    gate = _abs_with_anomaly_allow(tmp_path, ["src/note.txt:1"])
    r = _run_sh(gate, root, "--worktree")
    assert r.returncode == 1, r.stdout + r.stderr
    assert f"ABS PATH: src/note.txt:1: {OWNER}/x" in r.stdout, r.stdout


def test_abs_paths_excluded_doc_trees_are_not_scanned(tmp_path):
    for tree in ("docs/build", "docs/design", "docs/maintenance"):
        root = _abs_repo(
            tmp_path, "excl_" + tree.replace("/", "_"),
            f"worktree {OWNER}/checkout\n",
            rel=f"{tree}/plan.md",
        )
        r = _run_sh(CHECK_ABS, root, "--worktree")
        assert r.returncode == 0, tree + "\n" + r.stdout + r.stderr


def test_abs_paths_scans_untracked_files_in_worktree_mode(tmp_path):
    """A candidate branch's brand-new file must be scanned before it is staged."""
    root = _init_repo(tmp_path / "untracked_abs")
    _write(root, "scripts/new_tool.py", f'P = "{OWNER}/x"\n')
    r = _run_sh(CHECK_ABS, root, "--worktree")
    assert r.returncode != 0, r.stdout + r.stderr


def test_abs_paths_ref_mode_reads_the_ref_not_the_worktree(tmp_path):
    """Ref mode must report the ref's content, and ignore a dirty working tree."""
    root = _abs_repo(tmp_path, "refmode", f'P = "{OWNER}/x"\n')
    (root / "src" / "note.txt").write_text("clean now\n")
    r = _run_sh(CHECK_ABS, root, "main")
    assert r.returncode != 0, "ref mode must still see the committed violation"
    r2 = _run_sh(CHECK_ABS, root, "--worktree")
    assert r2.returncode == 0, r2.stdout + r2.stderr


# The baseline commit this program was planned against. Pinned as an IMMUTABLE
# SHA, never as `origin/main`: the security prerequisite deletes three of the
# five files below before Slice 0 starts and R3 removes the rest, so an
# assertion against the moving ref goes red the moment the prerequisite lands
# and can never pass on the finished tree. A ground-truth test must name the
# tree it is ground truth for.
BASELINE_SHA = "76cb11928e7ffed450eb37df8de5826636640b9a"
BASELINE_ABS_PATH_FILES = {
    ".claude/launch.json",
    "REVIEW.md",
    "docs/runbooks/self-hosted-runner.md",
    "scripts/build_m2_11_qa_bundle.py",
    "tests/test_m2_11_qa_bundle.py",
}


# The ANOMALY set on the pinned baseline is EMPTY, and that is the whole point
# of the Task-2 fix.
#
# The previous revision reported three: `docs/runbooks/self-hosted-runner.md`
# lines 88, 467 and 472 -- a `dscl . -read`, a `sudo find` and a `sudo launchctl
# print gui/$(dscl ...)`, all naming the runner SERVICE ACCOUNT. That made the
# program's Definition of Done unsatisfiable: T3.10 edits only line 403 and then
# MOVES the file, so those three commands survive, the gate keeps exiting 1, and
# R3 can never pass. A gate whose target state is unreachable gets switched off.
#
# Closed by widening the occurrence allowlist from ONE path beneath the service
# account's home to the account home itself -- content-keyed, no line numbers,
# and it covers all ten references in that file rather than the three that
# happen to trip the detector on today's text. What is still caught there is
# pinned by test_abs_paths_service_account_home_passes_but_an_owner_path_still_fails.
BASELINE_ABS_PATH_ANOMALIES: dict[str, str] = {}


def _violating_files(result) -> set[str]:
    return {line.removeprefix("ABS PATH: ").split(":", 1)[0]
            for line in result.stdout.splitlines() if line.startswith("ABS PATH: ")}


def _anomalies(result) -> dict[str, str]:
    """``file:line`` -> the residual text, for every ``ABS PATH ANOMALY`` line."""
    out = {}
    for line in result.stdout.splitlines():
        if not line.startswith("ABS PATH ANOMALY: "):
            continue
        body = line.removeprefix("ABS PATH ANOMALY: ")
        path, lineno, text = body.split(":", 2)
        out[f"{path}:{lineno}"] = text
    return out


def _anomaly_files(result) -> set[str]:
    return {k.rsplit(":", 1)[0] for k in _anomalies(result)}


def test_abs_paths_ground_truth_on_the_pinned_baseline():
    """Exactly five files on the PINNED baseline carry a machine-specific path."""
    r = _run_sh(CHECK_ABS, REPO_ROOT, BASELINE_SHA)
    assert r.returncode == 1, r.stdout + r.stderr
    assert _violating_files(r) == BASELINE_ABS_PATH_FILES, r.stdout
    # The F24 anomaly rule must not have CHANGED the file set -- only, at most,
    # added occurrences inside files the baseline already flagged.
    assert _anomaly_files(r) <= BASELINE_ABS_PATH_FILES, r.stdout


def test_abs_paths_baseline_anomalies_are_exactly_the_known_set():
    """The anomaly rule's live blast radius on the pinned baseline, pinned.

    This is the test that stops the rule from being quietly widened OR quietly
    narrowed. It is currently EMPTY, which is a much stronger statement than the
    three-line version it replaces: on the pinned tree every line the detector
    finds is fully accounted for, so the finished program can actually reach
    exit 0. Any change to SEGCH, to DETECT_RE's NOTSEG rule, to the
    service-account allowlist or to the count comparison shows up here and a
    human has to say why.
    """
    r = _run_sh(CHECK_ABS, REPO_ROOT, BASELINE_SHA)
    got = _anomalies(r)
    assert set(got) == set(BASELINE_ABS_PATH_ANOMALIES), r.stdout
    for key, expected in BASELINE_ABS_PATH_ANOMALIES.items():
        assert expected in got[key], f"{key}: {got[key]!r}"


# The runner service-account commands, quoted BYTE FOR BYTE from the pinned
# baseline, each with the occurrence the gate extracts from it.
#
# Under F26 the exemption is an exact (occurrence, line) pair, so a PARAPHRASE
# is no longer good enough -- and the previous revision of this fixture was one
# (`echo "step 1 NOT done"` for `... (no runner account)"`, `x.tar.gz` for
# `runner-image.tar.gz`, a dropped `| head -50`). Paraphrases were adequate
# against a prefix classifier, which is precisely the looseness F26 was about.
#
# Three separate tests keep these honest: they must equal the gate's table
# (test_abs_paths_service_allow_table_matches_the_fixtures), they must appear
# verbatim in the tracked runbook (test_abs_paths_service_allow_lines_are_live),
# and a tree containing only them must be green (the next test).
SERVICE_ACCOUNT_ALLOW_PAIRS = [
    ("/Users/populusrunner UniqueID 2",
     'dscl . -read /Users/populusrunner UniqueID 2>/dev/null'
     ' || echo "step 1 NOT done (no runner account)"'),
    ("/Users/populusrunner/Library/LaunchAgents/",
     "sudo ls -la /Users/populusrunner/Library/LaunchAgents/ 2>/dev/null"),
    ("/Users/populusrunner -newer",
     "sudo find /Users/populusrunner -newer"
     " /usr/local/populus-runner/controller/runner-image.tar.gz \\"),
    ("/Users/populusrunner UniqueID",
     "sudo launchctl print gui/$(dscl . -read /Users/populusrunner UniqueID"
     " | awk '{print $2}') 2>/dev/null | head -50"),
]

RUNNER_SERVICE_ACCOUNT_COMMANDS = [line for _, line in SERVICE_ACCOUNT_ALLOW_PAIRS] + [
    # A fifth reference that DETECT_RE never matches -- no terminated segment
    # after the account name -- and therefore needs no exemption at all. It is
    # here so the fixture is not silently narrower than the real file.
    "  -home /Users/populusrunner \\",
]


def test_abs_paths_service_allow_table_matches_the_fixtures():
    """The gate's table and this file's fixtures are the same four pairs.

    Written out on both sides rather than derived from one: a fixture generated
    from the code under test cannot disagree with it, and disagreement is the
    only thing worth detecting here.
    """
    assert _bash_array_entries("SERVICE_ALLOW_OCC") == [
        occ for occ, _ in SERVICE_ACCOUNT_ALLOW_PAIRS]
    assert _bash_array_entries("SERVICE_ALLOW_LINE") == [
        line for _, line in SERVICE_ACCOUNT_ALLOW_PAIRS]


def test_abs_paths_service_allow_lines_are_live():
    """Every exempted line still exists, verbatim, in the tracked runbook.

    An exact-content exemption whose content no longer occurs anywhere is dead
    weight that a future reader will mistake for coverage. The runbook is read
    from the PINNED baseline, so this pins the table against the tree the gate
    certifies rather than against whatever is on disk.
    """
    r = subprocess.run(
        ["git", "show", f"{BASELINE_SHA}:docs/runbooks/self-hosted-runner.md"],
        cwd=REPO_ROOT, capture_output=True, text=True, check=True,
    )
    body = r.stdout.splitlines()
    for _occ, line in SERVICE_ACCOUNT_ALLOW_PAIRS:
        assert line in body, f"exemption line no longer in the runbook: {line!r}"


def test_abs_paths_service_allow_occurrence_alone_is_not_enough(tmp_path):
    """The LINE half of the pair is load-bearing, not decoration.

    Mutation testing is why this exists: dropping the line comparison left the
    whole suite green, because none of the other fixtures puts a TABLE
    occurrence on a line the table does not also carry. Here the occurrence is
    exactly a table entry and the line is not, so only the line comparison can
    report it.
    """
    occ = "/Users/populusrunner/Library/LaunchAgents/"
    assert occ in _bash_array_entries("SERVICE_ALLOW_OCC"), "fixture is stale"
    root = _abs_repo(tmp_path, "svc_occ_wrong_line",
                     f"cp {occ} /tmp/exfil\n",
                     rel="docs/runbooks/self-hosted-runner.md")
    r = _run_sh(CHECK_ABS, root, "--worktree")
    assert r.returncode == 1, r.stdout + r.stderr
    assert occ in r.stdout, r.stdout


def test_abs_paths_malformed_service_allow_table_exits_two(tmp_path):
    """A half-finished edit to the parallel arrays is a hard 2, never a shift.

    Two arrays that must line up are a data structure with an invariant, and an
    unchecked invariant is how an exemption silently lands on the wrong line.
    """
    root = _abs_repo(tmp_path, "svc_malformed", "relative/only.py\n")
    # One extra OCCURRENCE and no matching LINE.
    src = CHECK_ABS.read_text(encoding="utf-8")
    marker = "SERVICE_ALLOW_OCC=(\n"
    gate = tmp_path / "check_abs_paths_malformed.sh"
    gate.write_text(src.replace(marker, marker + "  '/Users/extra'\n", 1),
                    encoding="utf-8")
    gate.chmod(0o755)
    r = _run_sh(gate, root, "--worktree")
    assert r.returncode == 2, r.stdout + r.stderr
    assert "malformed" in r.stderr, r.stderr


@pytest.mark.parametrize("mode", ["--worktree", "main"])
@pytest.mark.parametrize(
    ("label", "escape"),
    [
        # F26. Both truncate to exactly the OLD allowed prefix, and both were
        # measured ALLOWED (extracted=classified=1, exit 0) on the previous
        # revision. They are other machines' home directories.
        ("interior_space", "/Users/populusrunner backup/secret"),
        ("apostrophe", "/Users/populusrunner'Y/secret"),
        # The control the previous revision already got right.
        ("no_separator", "/Users/populusrunnerbackup/secret"),
    ],
)
def test_abs_paths_service_account_prefix_escapes_are_reported(
    tmp_path, mode, label, escape
):
    """G2: an exemption may never be reachable by TRUNCATION.

    A prefix test asks only what a value starts with, and the tokeniser stops
    early at any byte it cannot read. Composed, they let an attacker -- or an
    accident -- pick ANY home directory whose name begins with the service
    account's and have the gate's own allowlist certify it.

    The exemption is now an exact (occurrence, line) pair, so a truncated token
    is simply a different string and none of these three is exempt. Note the
    second one is reported as an ANOMALY rather than a violation: the `'` stops
    the tokeniser, KEEP_RE rejects what is left, and nothing classified it. Both
    kinds exit 1, which is the property that matters.
    """
    root = _abs_repo(tmp_path, f"f26_{label}_{mode.strip('-')}",
                     f"cp {escape} /tmp/x\n",
                     rel="docs/runbooks/self-hosted-runner.md")
    r = _run_sh(CHECK_ABS, root, mode)
    assert r.returncode == 1, r.stdout + r.stderr
    assert "ABS PATH" in r.stdout, r.stdout


@pytest.mark.parametrize(
    "rel",
    ["docs/runbooks/self-hosted-runner.md", "docs/operations/self-hosted-runner.md"],
    ids=["current_location", "planned_final_location"],
)
@pytest.mark.parametrize("mode", ["--worktree", "main"])
def test_abs_paths_service_account_home_passes_but_an_owner_path_still_fails(
    tmp_path, rel, mode
):
    """Task 2, both halves, at BOTH the current and the planned location.

    The runbook's service-account commands are legitimate operational content --
    the account name is fixed by a tracked launchd plist and the commands cannot
    be written correctly without it. A tree whose ONLY remaining machine paths
    are those commands must exit **0**, or the program's Definition of Done is
    unsatisfiable.

    The exemption is keyed on CONTENT -- the exact occurrence and the exact line
    -- and names no file and no line NUMBER, which is why the planned
    ``docs/operations/`` location behaves identically: the file can move without
    anyone re-approving anything.

    And the gate must not have been blunted: a real OWNER path added to that
    same file, in that same location, is still reported.
    """
    body = "".join(c + "\n" for c in RUNNER_SERVICE_ACCOUNT_COMMANDS)
    name = "svc_" + rel.replace("/", "_") + "_" + mode.strip("-")
    root = _abs_repo(tmp_path, name, body, rel=rel)
    r = _run_sh(CHECK_ABS, root, mode)
    assert r.returncode == 0, (
        "a tree whose only machine paths are the runner service-account "
        "commands must be GREEN\n" + r.stdout + r.stderr
    )

    # Now plant a real owner path in the same file and re-scan.
    _write(root, rel, body + f'DB = "{OWNER}/snapshots/x.db"\n')
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "owner path")
    r = _run_sh(CHECK_ABS, root, mode)
    assert r.returncode == 1, r.stdout + r.stderr
    assert f"{OWNER}/snapshots/x.db" in r.stdout, r.stdout


def test_abs_paths_service_account_allowlist_is_not_a_bare_substring(tmp_path):
    """A DIFFERENT home that merely starts with the service-account name.

    Kept from the prefix-classifier era, where it was the one boundary case
    that revision got right. Under the exact-pair table it is no longer a
    special case at all -- nothing is exempt except by byte equality -- but it
    stays as the control for
    test_abs_paths_service_account_prefix_escapes_are_reported, whose whole
    point is that its two siblings behave the same way now.
    """
    root = _abs_repo(
        tmp_path, "svc_prefix_not_substring",
        f"cp {_USERS}populusrunnerbackup/secret /tmp/x\n",
        rel="docs/runbooks/self-hosted-runner.md",
    )
    r = _run_sh(CHECK_ABS, root, "--worktree")
    assert r.returncode == 1, r.stdout + r.stderr
    assert f"{_USERS}populusrunnerbackup/secret" in r.stdout, r.stdout


def test_abs_paths_candidate_worktree_reaches_a_clean_scan():
    """The state the finished program must reach: the worktree scans clean.

    Staged deliberately, because the two halves converge on their own:

    * this branch must introduce NO violating file the baseline did not already
      have -- that half is enforceable today and is what stops a regression;
    * once the last baseline file is cleaned up, the scan must exit **0** -- the
      assertion flips to the target automatically, with no test edit needed.

    Written this way rather than as a bare ``assert rc == 0`` because the
    prerequisite that removes those five files has not landed yet; a test that
    is red until unrelated work happens gets muted, and a muted test protects
    nothing.
    """
    r = _run_sh(CHECK_ABS, REPO_ROOT, "--worktree")
    assert r.returncode in (0, 1), r.stdout + r.stderr
    files = _violating_files(r)
    anom = _anomaly_files(r)
    assert not (files - BASELINE_ABS_PATH_FILES), (
        "this branch introduced a machine-specific path: "
        f"{sorted(files - BASELINE_ABS_PATH_FILES)}\n{r.stdout}"
    )
    # An ANOMALY is a branch regression too: a line this branch added that the
    # gate detects but cannot parse must not be waved through just because it
    # produced no parsable occurrence. Same containment rule as above.
    assert not (anom - BASELINE_ABS_PATH_FILES), (
        "this branch introduced a detected-but-unparsed line: "
        f"{sorted(anom - BASELINE_ABS_PATH_FILES)}\n{r.stdout}"
    )
    # `files or anom`, not `files`: once the five baseline files are cleaned of
    # parsable occurrences the anomaly lines may outlive them, and the exit code
    # must keep tracking what was actually REPORTED. Written as `files` alone,
    # this assertion would go red on a tree that is behaving exactly as designed.
    assert r.returncode == (1 if (files or anom) else 0), r.stdout + r.stderr


def test_abs_paths_unknown_ref_is_a_usage_error(tmp_path):
    root = _init_repo(tmp_path / "badref")
    r = _run_sh(CHECK_ABS, root, "no/such/ref")
    assert r.returncode == 2, r.stdout + r.stderr


def test_abs_paths_cannot_scan_exits_two(tmp_path):
    """The fail-OPEN regression on the absolute-path gate.

    With an unusable ``TMPDIR`` the previous version left ``FILELIST`` and
    ``COUNTS`` empty, scanned nothing, and decided its verdict with an unguarded
    integer comparison on an empty variable -- observed exiting both 0 and 1,
    which is itself proof the path was unhandled rather than deliberate.
    """
    root = _abs_repo(tmp_path, "abs_notmp", f'P = "{OWNER}/x"\n')
    r = _run_sh(CHECK_ABS, root, "--worktree", env=_env_with_bad_tmpdir())
    assert r.returncode == 2, r.stdout + r.stderr
    assert "check_abs_paths:" in r.stderr
    # It must not silently report the violation it never finished counting.
    assert "occurrence(s)" not in r.stderr


@pytest.mark.parametrize(
    "marker",
    ["check_abs.files", "check_abs.counts", "check_abs.lines",
     "check_abs.toks", "check_abs.badf", "check_abs.anom", "check_abs.buf",
     "check_abs.err", "check_abs.raw"],
)
def test_abs_paths_a_single_failing_mktemp_still_exits_two(tmp_path, marker):
    """Each temp file's guard, exercised ON ITS OWN.

    Found by mutation testing, and it is the one survivor of that pass worth
    dwelling on: with the blanket unusable-``TMPDIR`` probe, the FIRST guard
    always fires, so every later guard was untested and deleting any one of them
    left the suite green. A per-template stub reaches each in isolation.

    The fixture repository holds a real machine path, so the correct verdict is
    1. Anything other than 2 here means the gate proceeded on missing state.
    """
    root = _abs_repo(tmp_path, "abs_mktemp_" + marker.replace(".", "_"),
                     f'P = "{OWNER}/x"\n')
    assert _run_sh(CHECK_ABS, root, "--worktree").returncode == 1, "control"

    env = _env_with_stub(_stub_bin(tmp_path, "mktemp", _mktemp_fails_for(marker)))
    r = _run_sh(CHECK_ABS, root, "--worktree", env=env)
    assert r.returncode == 2, marker + "\n" + r.stdout + r.stderr
    assert "check_abs_paths:" in r.stderr, marker
    assert "occurrence(s)" not in r.stderr, marker


@pytest.mark.parametrize(
    "marker",
    ["check_links.fail", "check_links.files", "check_links.scan",
     "check_links.refs"],
)
def test_links_a_single_failing_mktemp_still_exits_two(tmp_path, marker):
    """The same per-template probe on the link gate."""
    root = _init_repo(tmp_path / ("links_mktemp_" + marker.replace(".", "_")))
    _write(root, "README.md", "See [bad](docs/gone.md)\n")
    _git(root, "add", "-A")
    assert _run_sh(CHECK_LINKS, root).returncode == 1, "control"

    env = _env_with_stub(_stub_bin(tmp_path, "mktemp", _mktemp_fails_for(marker)))
    r = _run_sh(CHECK_LINKS, root, env=env)
    assert r.returncode == 2, marker + "\n" + r.stdout + r.stderr
    assert "check_links:" in r.stderr, marker


@pytest.mark.parametrize(
    ("flag", "stage"),
    [
        ("n", "line prefilter, was `< <(grep -nE ...)` -- process substitution"),
        ("o", "token extraction, was `$(... | grep -oE ...)` -- command substitution"),
        ("q", "keep filter, was `grep -qE ... || continue` -- status 1 and >1 merged"),
    ],
)
def test_abs_paths_failing_inner_scanner_exits_two(tmp_path, flag, stage):
    """Defect 3: each of the three inner grep stages must fail CLOSED.

    The fixture repository contains a real machine-specific path, so the correct
    verdict is 1. Measured before the fix, with a grep that fails only for the
    stage under test, ALL THREE stages produced exit **0** -- zero tokens, a
    zero count, and a clean bill of health for content that was never evaluated.
    None of the three could surface status 2 to the parent shell.

    The stub is flag-selective on purpose: a blanket failing grep always trips
    stage `-n` first, so the `-o` and `-q` guards would never be exercised.
    """
    root = _abs_repo(tmp_path, "abs_grep_" + flag, f'P = "{OWNER}/x"\n')
    # Control: the violation really is detected when the scanner works.
    assert _run_sh(CHECK_ABS, root, "--worktree").returncode == 1, stage

    env = _env_with_stub(
        _stub_bin(tmp_path, "grep", _fails_only_for_flag("grep", flag))
    )
    r = _run_sh(CHECK_ABS, root, "--worktree", env=env)
    assert r.returncode == 2, stage + "\n" + r.stdout + r.stderr
    assert "check_abs_paths:" in r.stderr, stage
    # It must not report a count it never finished computing.
    assert "occurrence(s)" not in r.stderr, stage


def test_abs_paths_no_match_inner_scanner_is_not_an_error(tmp_path):
    """The other half of the guard: a line with no extractable token is normal.

    ``/search/home/`` prefilters IN (it contains ``/home/``) but yields no
    KEEP_RE-qualifying occurrence, so the inner stages legitimately return
    status 1. That must stay a clean 0, not a hard 2.
    """
    root = _abs_repo(
        tmp_path, "abs_prefilter_only",
        'URL = "https://efdsearch.senate.gov/search/home/"\n',
    )
    r = _run_sh(CHECK_ABS, root, "--worktree")
    assert r.returncode == 0, r.stdout + r.stderr


def test_abs_paths_ref_mode_failing_sed_exits_two(tmp_path):
    """Defect F16: ref mode's ``sed`` normaliser must fail CLOSED.

    The ref-mode file finder was one pipeline::

        git grep ... 2>"$GREPERR" | sed "s|^$REF:||" > "$FILELIST"
        g=${PIPESTATUS[0]}

    Only ``PIPESTATUS[0]`` -- ``git grep``'s status -- was ever read. ``sed``'s
    was discarded, so a failing or absent ``sed`` produced an EMPTY ``FILELIST``,
    a scan loop that read nothing, a violation count of zero, and **exit 0**: a
    clean bill of health for a ref whose content was never opened. That is the
    same fail-open class as stages A/B/C, and it was the last one left.

    ``sed`` is shadowed on PATH by a stub that always exits 2. ``git grep`` is a
    git builtin and is unaffected, so the finder still succeeds and the probe
    lands squarely on the normaliser.
    """
    root = _abs_repo(tmp_path, "abs_ref_sed", f'P = "{OWNER}/x"\n')
    # Control: in ref mode the violation really is detected when sed works.
    assert _run_sh(CHECK_ABS, root, "main").returncode == 1

    env = _env_with_stub(_stub_bin(tmp_path, "sed", _always_fails("sed")))
    r = _run_sh(CHECK_ABS, root, "main", env=env)
    assert r.returncode == 2, r.stdout + r.stderr
    assert "check_abs_paths:" in r.stderr
    assert "sed" in r.stderr
    # It must not report a count it never finished computing.
    assert "occurrence(s)" not in r.stderr


def test_abs_paths_ref_mode_no_match_still_exits_zero(tmp_path):
    """The other half of the F16 guard: an empty ref list is NORMAL.

    ``git grep -l`` exits 1 when nothing matched, ``sed`` over the resulting
    empty file exits 0, and the correct verdict is a clean 0. Over-tightening
    the new guard into "any non-zero anywhere is a hard 2" would turn every
    clean ref into "could not scan", and a gate that can never be green gets
    switched off.
    """
    root = _abs_repo(tmp_path, "abs_ref_clean", "relative/paths/only.py\n")
    r = _run_sh(CHECK_ABS, root, "main")
    assert r.returncode == 0, r.stdout + r.stderr
    assert "ABS PATH" not in r.stdout


def test_abs_paths_not_a_git_repo_exits_two(tmp_path):
    plain = tmp_path / "plain_abs"
    plain.mkdir()
    (plain / "note.txt").write_text(f'P = "{OWNER}/x"\n')
    r = _run_sh(CHECK_ABS, plain, "--worktree")
    assert r.returncode == 2, r.stdout + r.stderr


def test_abs_paths_documents_its_three_exit_codes():
    header = CHECK_ABS.read_text().split("set -uo pipefail", 1)[0]
    assert "EXIT STATUS" in header
    for code in ("0", "1", "2"):
        assert re.search(rf"^#\s+{code}\s+\S", header, re.MULTILINE), header


# --------------------------------------------------------------------------
# cross_run_overlap.py
# --------------------------------------------------------------------------


def _load_cross_run():
    spec = importlib.util.spec_from_file_location("cross_run_overlap", CROSS_RUN)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


cross_run = _load_cross_run()


def _plan_paths():
    """Locate the runs' plan documents.

    They are UNTRACKED owner-owned working files, so a worktree cut from the
    baseline ref does not contain them. Look in this checkout first, then in the
    repository's main checkout (read-only), and skip only if neither has them.
    """
    common = subprocess.run(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
        cwd=REPO_ROOT, capture_output=True, text=True, check=True,
    ).stdout.strip()
    roots = [REPO_ROOT, Path(common).parent]
    for root in roots:
        found = {k: root / rel for k, rel in cross_run.RUNS.items()}
        if all(p.is_file() for p in found.values()):
            return found
    pytest.skip("run plan documents (untracked, owner-owned) are not present")


def test_cross_run_exits_zero_on_the_current_tree(capsys):
    """Integration: every token in the REAL plans is classified.

    This is the one test allowed to skip -- it reads the owner-local, untracked
    plan documents, which genuinely do not exist in a fresh clone.
    """
    plans = _plan_paths()
    argv = ["--plan", f"sec={plans['sec']}", "--plan", f"i2={plans['i2']}"]
    rc = cross_run.main(argv)
    out = capsys.readouterr().out
    assert rc == 0, out
    assert "UNRESOLVED" not in out


def test_cross_run_unclassifiable_token_fails(tmp_path, capsys):
    """The gate must still be able to fail -- and this test must RUN in CI.

    It used to load the owner-local plan documents for its ``i2`` input before
    planting the synthetic bad token, so it skipped in every fresh clone and in
    CI. That left CI unable to detect a regression making the overlap gate
    structurally incapable of failing -- exactly the defect class the gate
    exists to catch. BOTH plan inputs are now synthetic, so it always runs.
    """
    sec = tmp_path / "synthetic-sec.md"
    sec.write_text("The slice edits `src/populus/not_a_real_module_xyz.py` today.\n")
    i2 = tmp_path / "synthetic-i2.md"
    i2.write_text("This run touches `README.md` only.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 1, out
    assert "UNRESOLVED in sec" in out
    assert "src/populus/not_a_real_module_xyz.py" in out
    # The clean synthetic plan must NOT be reported -- otherwise the failure
    # above would prove nothing about which input was bad.
    assert "UNRESOLVED in i2" not in out


def test_cross_run_fully_synthetic_clean_plans_pass(tmp_path, capsys):
    """The positive half of the synthetic pair: no skip, no owner-local input."""
    sec = tmp_path / "clean-sec.md"
    sec.write_text("Edits `README.md` and `src/populus/cli.py`.\n")
    i2 = tmp_path / "clean-i2.md"
    i2.write_text("Edits `Makefile`.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 0, out
    assert "UNRESOLVED" not in out


@pytest.mark.parametrize(
    "token",
    [
        "dashboard/public/_headers",   # tracked, no extension, has a directory
        "NOTICE",                      # tracked, no extension, repo root
        "LICENSE",                     # ditto
    ],
)
def test_cross_run_extensionless_tracked_paths_resolve(tmp_path, capsys, token):
    """The silent-drop regression.

    Extraction used to tokenise a FIXED extension list plus three special cases,
    so an extensionless path was never turned into a token at all: it was
    reported neither as found nor as unresolved, it simply vanished. Both of
    these are tracked on the baseline and referenced by the real plans.
    """
    sec = tmp_path / "sec.md"
    sec.write_text(f"The slice rewrites `{token}` in place.\n")
    i2 = tmp_path / "i2.md"
    i2.write_text("Edits `Makefile`.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 0, out

    tracked = cross_run.load_tracked("origin/main")
    assert token in tracked, "fixture is meaningless unless the path is tracked"
    found, unresolved, dropped = _extract(sec, tracked, set())
    assert token in found, f"{token} resolved to nothing: {out}"
    assert token not in unresolved and token not in dropped


def test_cross_run_unresolvable_extensionless_token_is_reported(tmp_path, capsys):
    """Unresolvable is REPORTED, never dropped -- fail-closed is preserved."""
    sec = tmp_path / "sec.md"
    sec.write_text("The slice adds `docs/runbooks/no_such_thing_at_all` today.\n")
    i2 = tmp_path / "i2.md"
    i2.write_text("Edits `Makefile`.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 1, out
    assert "docs/runbooks/no_such_thing_at_all" in out


def _extract(plan_path, tracked, new):
    """Call ``cross_run.extract`` with the indexes ``main`` would have built."""
    by_base: dict[str, list[str]] = {}
    by_suffix: dict[str, list[str]] = {}
    for q in tracked:
        by_base.setdefault(q.rsplit("/", 1)[-1], []).append(q)
        parts = q.split("/")
        for i in range(1, len(parts)):
            by_suffix.setdefault("/".join(parts[i:]), []).append(q)
    top_dirs = frozenset(q.split("/", 1)[0] for q in tracked)
    tracked_dirs = frozenset(
        "/".join(q.split("/")[:i]) for q in tracked for i in range(1, len(q.split("/")))
    )
    return cross_run.extract(
        str(plan_path), tracked, by_base, by_suffix, new, top_dirs, tracked_dirs
    )


@pytest.mark.parametrize(
    ("citation", "path"),
    [
        # form 1: a line, or a line range
        ("README.md:7", "README.md"),
        ("ARCHITECTURE.md:797", "ARCHITECTURE.md"),
        ("src/populus/cli.py:513-520", "src/populus/cli.py"),
        ("Makefile:55-59", "Makefile"),                     # extensionless
        ("dashboard/public/_headers:1", "dashboard/public/_headers"),
        ("deploy/verify.py:536-562", "src/populus/deploy/verify.py"),  # suffix shorthand
        # form 2: a comma-separated list of lines and ranges
        ("ARCHITECTURE.md:797-799,923", "ARCHITECTURE.md"),
        ("src/populus/deploy/upload.py:84-89,266-287", "src/populus/deploy/upload.py"),
        # form 3: a ::symbol qualifier, with and without a signature
        ("src/populus/canonical.py::canonical_json", "src/populus/canonical.py"),
        ("src/populus/publish/__init__.py::publish_no_replace(temp, destination)",
         "src/populus/publish/__init__.py"),
    ],
)
def test_cross_run_line_qualified_citation_resolves(tmp_path, capsys, citation, path):
    """Defect 1: a ``path:line`` citation must resolve to its file.

    ``CAND_RE`` has no ``:`` in its character class, so every qualified citation
    failed the candidate test and was skipped BEFORE resolution and before the
    ``path_shaped()`` drop filter. It appeared in found, unresolved AND dropped:
    nowhere. Measured on the real plans: 28 distinct such citations in the
    security plan and 43 in the I-2 plan vanished without a mention -- which
    meant the tool's headline "counts are byte-identical" result was resting on
    a silent filter, the exact defect class this gate exists to prevent.

    All three qualifier forms the plans actually use are covered. Fixing only
    the first would have left 13 security-plan and 5 I-2 spans still vanishing.
    """
    sec = tmp_path / "sec.md"
    sec.write_text(f"The slice rewrites `{citation}` in place.\n")
    i2 = tmp_path / "i2.md"
    i2.write_text("Edits `Makefile`.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 0, out

    tracked = cross_run.load_tracked("origin/main")
    found, unresolved, dropped = _extract(sec, tracked, set())
    # It resolves to the FILE itself, with the qualifier gone -- not to a token
    # that merely looks path-like.
    assert found == {path}, (found, path, out)
    assert path in tracked, "fixture is meaningless unless the path is tracked"
    assert not unresolved and not dropped, (unresolved, dropped)


def test_cross_run_unresolvable_line_qualified_citation_is_reported(tmp_path, capsys):
    """Fail-closed is preserved: normalising the suffix must not create a hole.

    A citation whose path does not exist has to be REPORTED, not quietly
    resolved away. Without this, the defect-1 fix would trade one silent filter
    for another.
    """
    sec = tmp_path / "sec.md"
    sec.write_text("The slice edits `src/populus/no_such_module_xyz.py:41-52`.\n")
    i2 = tmp_path / "i2.md"
    i2.write_text("Edits `Makefile`.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 1, out
    assert "UNRESOLVED in sec" in out
    assert "src/populus/no_such_module_xyz.py" in out
    assert "UNRESOLVED in i2" not in out


def test_cross_run_non_citation_colon_pairs_are_reported_not_resolved(tmp_path, capsys):
    """``cik:0001045810`` is prose, not a path -- but it must still be COUNTED.

    Normalising the ``:digits`` suffix also catches prose key/value pairs the
    plans use (``cik:0001045810``, ``attempt:1``, ``holders_status:200``). They
    correctly resolve to nothing, and the requirement is that they land in the
    reported ``dropped`` count rather than disappearing the way the qualified
    citations used to.
    """
    sec = tmp_path / "sec.md"
    sec.write_text("Looked up `cik:0001045810` on `attempt:1`.\n")
    i2 = tmp_path / "i2.md"
    i2.write_text("Edits `Makefile`.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 0, out
    assert "note: sec: 2 backticked span(s) resolved to nothing" in out

    tracked = cross_run.load_tracked("origin/main")
    found, unresolved, dropped = _extract(sec, tracked, set())
    assert dropped == {"cik", "attempt"}, dropped
    assert not found and not unresolved


def test_cross_run_strip_line_suffix_never_rewrites_a_valid_candidate():
    """The normaliser must be inert on anything CAND_RE already accepts.

    It runs only after the candidate test fails, and CAND_RE never admits a
    colon -- so no token that used to resolve can change meaning. Pinned as a
    property because a later widening of CAND_RE would silently break it.
    """
    for token in (
        "README.md", "src/populus/cli.py", "Makefile",
        "dashboard/src/pages/institutional/tickers/[t]/holders.astro",
        "docs/runbooks/", ".github/workflows/checks.yml",
    ):
        assert cross_run.CAND_RE.match(token), token
        assert cross_run.strip_line_suffix(token) == token, token
    # A version number is not a citation: `1.2` has no path-shaped stem.
    assert cross_run.strip_line_suffix("not a path:12") == "not a path:12"


def test_cross_run_every_span_is_routed_to_exactly_one_bucket(capsys):
    """THE INVARIANT. No backticked span in the REAL plans may vanish.

    This replaces an earlier version of this test, and the replacement is the
    whole point of the fix. The old test walked the same documents but SKIPPED
    every span the normaliser could not turn into a candidate, dismissing it as
    "genuine prose, never was a reference". That skip is precisely what let the
    fifth recurrence of the vanish class survive review: ``publish.yml:publish``,
    ``record-sign.yml:record`` and
    ``scripts/inst_snapshot.py --prepare-working-copy`` are all real references
    the old test waved through, and all three were reported nowhere.

    The invariant here admits no skip. It sweeps the document with
    ``BACKTICK_RE`` -- the same extractor the tool uses -- and requires the
    classifier to have a routing decision on record for EVERY span, with zero
    unaccounted. It does NOT require resolution: routes, prose, MIME types and
    shell fragments legitimately route to ``dropped``. It requires only that
    nothing exits silently.

    Measured against the previous revision, this assertion fails with 128
    distinct unaccounted spans in the security plan and 339 in the I-2 plan
    (180 and 464 occurrences).
    """
    plans = _plan_paths()
    tracked = cross_run.load_tracked("origin/main")
    for key, plan in plans.items():
        spans = _extract(plan, tracked, cross_run.NEW.get(key, set()))
        seen = set(cross_run.BACKTICK_RE.findall(plan.read_text(encoding="utf-8")))
        assert seen, f"{key}: fixture is meaningless with no backticked spans"
        unaccounted = seen - set(spans.routes)
        assert not unaccounted, (
            f"{key}: {len(unaccounted)} span(s) vanished -- reported in neither "
            f"found, nor unresolved, nor dropped: {sorted(unaccounted)[:20]}"
        )
        # Each routing decision names a real bucket, and the buckets partition
        # the spans: a value can only have been added through Spans.record.
        assert set(spans.routes.values()) <= set(cross_run.BUCKETS)


def test_cross_run_classify_span_is_total():
    """Structural half of the invariant: the router cannot return "nothing".

    The four earlier recurrences were each closed by widening a regex, and the
    class survived every time because the class is not a missing pattern -- it
    is the existence of an exit with no record. ``classify_span`` is now total:
    every input, including deliberate garbage, yields a named bucket. Pinned
    here so a future rejection rule cannot reintroduce a bare ``continue``.
    """
    tracked = cross_run.load_tracked("origin/main")
    by_base: dict[str, list[str]] = {}
    by_suffix: dict[str, list[str]] = {}
    for q in tracked:
        by_base.setdefault(q.rsplit("/", 1)[-1], []).append(q)
        parts = q.split("/")
        for i in range(1, len(parts)):
            by_suffix.setdefault("/".join(parts[i:]), []).append(q)
    top_dirs = frozenset(q.split("/", 1)[0] for q in tracked)
    for span in (
        "", " ", "README.md", "publish.yml:publish", "application/json",
        "npm ci", "${{ secrets.* }}", "</script><script>", "entity:cik:00010",
        "self-hosted, macOS, ARM64", "1.2.3", "-> 6e/6e", "`", "\\u003c",
    ):
        bucket, value, _ = cross_run.classify_span(
            span, None, tracked, by_base, by_suffix, set(), {}, top_dirs, frozenset()
        )
        assert bucket in cross_run.BUCKETS, (span, bucket)
        assert value is not None, span

    # And the sink itself refuses an unnamed bucket, so a typo cannot invent one.
    s = cross_run.Spans()
    with pytest.raises(ValueError):
        s.record("x", "not_a_bucket", "x")


def test_cross_run_classifier_contains_no_silent_exit():
    """Mechanical pin: ``classify_span`` may contain no ``continue`` and no bare
    ``return``.

    Every earlier recurrence entered through exactly one of those two
    statements. Behavioural tests can only sample inputs; this reads the source
    and forbids the SHAPE, so a new rejection rule written as ``continue`` fails
    here regardless of whether anyone thought to add a fixture for it.
    """
    import ast

    tree = ast.parse(CROSS_RUN.read_text(encoding="utf-8"))
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.FunctionDef) and n.name == "classify_span")
    assert not [n for n in ast.walk(fn) if isinstance(n, ast.Continue)], \
        "classify_span must not `continue` -- that is the vanish class"
    bare = [n for n in ast.walk(fn) if isinstance(n, ast.Return) and n.value is None]
    assert not bare, "classify_span must not `return` without a bucket"
    # And it must END in a return, so nothing can fall off the bottom into None.
    assert isinstance(fn.body[-1], ast.Return), \
        "classify_span must end in a catch-all return"


@pytest.mark.parametrize(
    ("span", "path"),
    [
        # Workflow JOB qualifiers -- a third `:` form QUALIFIED_RE never covered
        # (it handles `:<digits>` and `::<symbol>` only). Both occur in the real
        # security plan; `publish.yml:publish` twice.
        ("publish.yml:publish", ".github/workflows/publish.yml"),
        ("record-sign.yml:record", ".github/workflows/record-sign.yml"),
        # COMMAND form -- a path followed by its arguments. From the real I-2
        # plan. CAND_RE rejects the whitespace, so the whole span vanished.
        ("scripts/inst_snapshot.py --prepare-working-copy", "scripts/inst_snapshot.py"),
    ],
)
def test_cross_run_live_vanished_spans_now_resolve(tmp_path, capsys, span, path):
    """The three VERIFIED live examples of the fifth recurrence.

    Each is present in the real plans and, before this fix, ``--show-dropped``
    returned zero matches for all three: they were in found, unresolved and
    dropped alike -- nowhere.
    """
    sec = tmp_path / "sec.md"
    sec.write_text(f"The run runs `{span}` during the cutover.\n")
    i2 = tmp_path / "i2.md"
    i2.write_text("Edits `Makefile`.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 0, out

    tracked = cross_run.load_tracked("origin/main")
    assert path in tracked, "fixture is meaningless unless the path is tracked"
    spans = _extract(sec, tracked, set())
    assert spans.routes[span] == "found", (spans.routes, out)
    assert spans.found == {path}, (spans.found, path)
    assert not spans.unresolved and not spans.dropped


@pytest.mark.parametrize(
    "span",
    [
        "git diff --name-status HEAD",          # first token is not path-bearing
        "make check",                           # ditto
        "application/json",                     # a MIME type, not a path
        "npm ci",                               # a shell command
        "origin/main",                          # a git ref: slash, but no repo top dir
        "actions/checkout",                     # an action ref, same shape
        "POPULUS_DATA_DIR=/tmp/x",              # env-var assignment prose
        "1.2.3",                                # a version string
    ],
)
def test_cross_run_non_path_normalisations_are_dropped_not_forced(tmp_path, span):
    """Resolution is never FORCED, and prose must not become a gate failure.

    The contract is "nothing vanishes", not "everything resolves". A span whose
    normalised stem is not repository-SHAPED is REPORTED as dropped rather than
    pinned onto an arbitrary path (which would silently inflate a slice's blocked
    count with a file the plan never named) and rather than failing the gate
    (which would make it unpassable). This is the half of F23 that must NOT
    change: ``path_shaped()`` is the whole separation between prose and a path.
    """
    sec = tmp_path / "sec.md"
    sec.write_text(f"Prose about `{span}` here.\n")
    tracked = cross_run.load_tracked("origin/main")
    spans = _extract(sec, tracked, set())
    assert spans.routes[span] == "dropped", spans.routes
    assert not spans.found and not spans.unresolved


@pytest.mark.parametrize(
    ("span", "stem"),
    [
        # Zero tracked hits, via the COMMAND form. This is the measured F23
        # reproduction: before the fix this plan yielded
        # `found=0 unresolved=0 dropped=1` and process exit 0.
        ("scripts/no_such_future_tool.py --flag", "scripts/no_such_future_tool.py"),
        ("no_such_workflow_xyz.yml:somejob", "no_such_workflow_xyz.yml"),
        # AMBIGUOUS: `__init__.py` is the basename of many tracked files, so
        # `resolve_uniquely` refuses it. Ambiguity is a failure to classify, not
        # a licence to drop -- the operator has to say which one the plan meant.
        ("__init__.py:somejob", "__init__.py"),
    ],
)
def test_cross_run_repo_shaped_unresolvable_stem_is_a_gate_failure(
    tmp_path, capsys, span, stem
):
    """Defect F23: a repository-shaped stem that resolves to nothing must EXIT 1.

    Measured before the fix, with a synthetic plan containing
    ``scripts/no_such_future_tool.py --flag``: ``found=0 unresolved=0 dropped=1``
    and process exit **0**. That is a fail-OPEN in the OWNERSHIP gate -- a sibling
    run can introduce or rename a file through a command-form reference and T0.4
    would declare the affected slice conflict-free.

    Routing these to ``unresolved`` keeps every other property intact: the span
    still lands in exactly one of the six buckets, and ``classify_span`` is still
    total (pinned by the two structural tests above).
    """
    sec = tmp_path / "sec.md"
    sec.write_text(f"The run runs `{span}` during the cutover.\n")
    i2 = tmp_path / "i2.md"
    i2.write_text("Edits `Makefile`.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 1, out
    assert "UNRESOLVED in sec" in out
    assert stem in out

    tracked = cross_run.load_tracked("origin/main")
    spans = _extract(sec, tracked, set())
    assert spans.routes[span] == "unresolved", spans.routes
    assert stem in spans.unresolved
    assert not spans.found


# --- F23, THIRD round: EVERY word is inspected, not just the first ----------
#
# The previous revision routed a repository-shaped FIRST word to `unresolved`.
# It still read `token.split()[0]` alone, so a path sitting after an interpreter
# or behind an option had no candidate at all and fell to `dropped`, exit 0.
# Measured against that revision:
#
#     `python scripts/no_such.py`   -> dropped   (should be unresolved)
#     `--workflow no_such.yml`      -> dropped   (should be unresolved)
#     `--workflow publish.yml`      -> dropped   LIVE, 26 occurrences in the
#                                                I-2 plan, resolves uniquely
#
# Fixed by inversion, not by a better "which word is the path" heuristic:
# inspect all words with the SAME `path_shaped()` predicate, and let the count
# decide -- 0 candidates is prose, 1 resolves or fails, 2+ is ambiguous and
# fails closed.
@pytest.mark.parametrize(
    ("span", "stem"),
    [
        # After an INTERPRETER. The first word `python` is not path-shaped.
        ("python scripts/no_such_future_tool_xyz.py", "scripts/no_such_future_tool_xyz.py"),
        ("uv run scripts/no_such_future_tool_xyz.py", "scripts/no_such_future_tool_xyz.py"),
        # Behind an OPTION. `--workflow` is not even a CAND_RE candidate:
        # CAND_RE forbids a leading `-`.
        ("--workflow no_such_workflow_xyz.yml", "no_such_workflow_xyz.yml"),
        ("gh workflow run --workflow no_such_workflow_xyz.yml", "no_such_workflow_xyz.yml"),
        # A non-first word carrying a job qualifier, and one carrying a line
        # citation: both normalisations must apply per-WORD, not only to word 0.
        ("gh run view no_such_workflow_xyz.yml:somejob", "no_such_workflow_xyz.yml"),
        ("see src/populus/no_such_module_xyz.py:42", "src/populus/no_such_module_xyz.py"),
    ],
)
def test_cross_run_repo_path_after_the_first_word_is_a_gate_failure(
    tmp_path, capsys, span, stem
):
    """A repository-shaped path anywhere in the span fails closed when unresolvable."""
    sec = tmp_path / "sec.md"
    sec.write_text(f"The run runs `{span}` during the cutover.\n")
    i2 = tmp_path / "i2.md"
    i2.write_text("Edits `Makefile`.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 1, out
    assert "UNRESOLVED in sec" in out
    assert stem in out

    tracked = cross_run.load_tracked("origin/main")
    spans = _extract(sec, tracked, set())
    assert spans.routes[span] == "unresolved", spans.routes
    assert stem in spans.unresolved
    assert not spans.found


@pytest.mark.parametrize(
    ("span", "path"),
    [
        # THE LIVE ONE. 26 occurrences in the real I-2 plan; measured as
        # `dropped` before this fix.
        ("--workflow publish.yml", ".github/workflows/publish.yml"),
        ("gh workflow run --workflow publish.yml", ".github/workflows/publish.yml"),
        ("python scripts/inst_snapshot.py", "scripts/inst_snapshot.py"),
    ],
)
def test_cross_run_repo_path_after_the_first_word_resolves(tmp_path, capsys, span, path):
    """The same widening must RESOLVE what genuinely resolves, not only fail.

    A fix that only ever added failures would be indistinguishable from making
    the gate unpassable.
    """
    sec = tmp_path / "sec.md"
    sec.write_text(f"The run runs `{span}` during the cutover.\n")
    i2 = tmp_path / "i2.md"
    i2.write_text("Edits `Makefile`.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 0, out

    tracked = cross_run.load_tracked("origin/main")
    assert path in tracked, "fixture is meaningless unless the path is tracked"
    spans = _extract(sec, tracked, set())
    assert spans.routes[span] == "found", (spans.routes, out)
    assert spans.found == {path}


def test_cross_run_two_repo_shaped_words_are_ambiguous_not_silently_picked(
    tmp_path, capsys
):
    """2+ candidates -> `unresolved`. Uncertainty fails CLOSED.

    Both words below resolve perfectly well on their own. The tool still refuses
    them, because picking one would be a guess about which file the span is
    ABOUT, and a wrong guess silently mis-attributes a slice's blocked set --
    the same fail-open the whole F23 series is about, one level up.

    Note the fixture uses two EXTENSIONED paths. `Makefile` would not do:
    ``path_shaped()`` is False for a bare extensionless name, so `cp Makefile
    pyproject.toml` yields ONE candidate and resolves. That asymmetry is
    pre-existing and deliberate -- it is what keeps bare prose words out of the
    candidate set -- but it makes an obvious-looking fixture prove nothing.
    """
    sec = tmp_path / "sec.md"
    sec.write_text("The run runs `cp pyproject.toml README.md` during the cutover.\n")
    i2 = tmp_path / "i2.md"
    i2.write_text("Edits `Makefile`.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 1, out
    assert "UNRESOLVED in sec" in out

    tracked = cross_run.load_tracked("origin/main")
    spans = _extract(sec, tracked, set())
    assert spans.routes["cp pyproject.toml README.md"] == "unresolved", spans.routes
    # Reported as the PAIR, so the operator sees why it is ambiguous rather than
    # hunting for which of two perfectly good paths the tool disliked.
    assert spans.unresolved == {"pyproject.toml + README.md"}, spans.unresolved
    assert not spans.found


def test_cross_run_repo_candidates_reuses_path_shaped():
    """One definition of "repository-shaped", not two.

    Both previous F23 rounds were closed by adding a second, subtly different
    notion of what a path looks like. This reads the source and forbids that:
    ``repo_candidates`` must call ``path_shaped`` and must not define its own
    predicate.
    """
    import ast

    tree = ast.parse(CROSS_RUN.read_text(encoding="utf-8"))
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.FunctionDef) and n.name == "repo_candidates")
    called = {n.func.id for n in ast.walk(fn)
              if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
    assert "path_shaped" in called, called


def test_cross_run_ambiguous_stem_fixture_is_really_ambiguous():
    """Guard for the test above: `__init__.py` must have >1 tracked hit."""
    tracked = cross_run.load_tracked("origin/main")
    hits = [q for q in tracked if q.rsplit("/", 1)[-1] == "__init__.py"]
    assert len(hits) > 1, hits


# --- F23, THIRD round: per-word classification is TOTAL ---------------------
#
# `word_stem()` returns None for anything CAND_RE cannot read, and the previous
# `repo_candidates` turned that None into a bare `continue`. Same vanish shape as
# `classify_span` once had, one level down: the SPAN reached a bucket, but the
# word carrying its repository path never did, so the span fell to the catch-all
# `dropped` and the gate exited 0. Measured against that revision, all four with
# `found=0 unresolved=0 dropped=1` and process exit 0:
UNCLASSIFIED_WORD_FORMS = [
    ('python "scripts/no_such_future_tool_xyz.py"',
     "scripts/no_such_future_tool_xyz.py", "double_quoted"),
    ("python 'scripts/no_such_future_tool_xyz.py'",
     "scripts/no_such_future_tool_xyz.py", "single_quoted"),
    ("python (scripts/no_such_future_tool_xyz.py)",
     "scripts/no_such_future_tool_xyz.py", "parenthesised"),
    ("--workflow=no_such_workflow_xyz.yml",
     "no_such_workflow_xyz.yml", "option_assignment"),
]


@pytest.mark.parametrize(
    ("span", "stem"), [(s, p) for s, p, _ in UNCLASSIFIED_WORD_FORMS],
    ids=[i for _, _, i in UNCLASSIFIED_WORD_FORMS],
)
def test_cross_run_quoted_and_bracketed_paths_are_classified(
    tmp_path, capsys, span, stem
):
    """Defect F23, third escape: the wrapper syntax had to come off FIRST.

    ``CAND_RE`` admits neither a quote, nor a bracket, nor an ``=``, and
    ``word_stem`` was consulted before the word had been stripped of the syntax
    a plan document wraps around a path. So an ordinary reference was rejected
    and the word disappeared, taking the span's only repository path with it.
    """
    sec = tmp_path / "sec.md"
    sec.write_text(f"The run runs `{span}` during the cutover.\n")
    i2 = tmp_path / "i2.md"
    i2.write_text("Edits `Makefile`.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 1, out
    assert "UNRESOLVED in sec" in out
    assert stem in out

    tracked = cross_run.load_tracked("origin/main")
    spans = _extract(sec, tracked, set())
    assert spans.routes[span] == "unresolved", spans.routes
    assert stem in spans.unresolved
    assert not spans.dropped, spans.dropped


@pytest.mark.parametrize(
    ("span", "path"),
    [
        # The same four wrapper forms, pointing at files that DO exist. A fix
        # that only ever added failures would be indistinguishable from making
        # the gate unpassable.
        ('python "scripts/inst_snapshot.py"', "scripts/inst_snapshot.py"),
        ("python 'scripts/inst_snapshot.py'", "scripts/inst_snapshot.py"),
        ("python (scripts/inst_snapshot.py)", "scripts/inst_snapshot.py"),
        ("--workflow=publish.yml", ".github/workflows/publish.yml"),
        ("gh workflow run --workflow=publish.yml", ".github/workflows/publish.yml"),
    ],
)
def test_cross_run_wrapped_paths_that_exist_still_resolve(tmp_path, capsys, span, path):
    """The positive half of the totality fix."""
    sec = tmp_path / "sec.md"
    sec.write_text(f"The run runs `{span}` during the cutover.\n")
    i2 = tmp_path / "i2.md"
    i2.write_text("Edits `Makefile`.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 0, out

    tracked = cross_run.load_tracked("origin/main")
    assert path in tracked, "fixture is meaningless unless the path is tracked"
    spans = _extract(sec, tracked, set())
    assert spans.routes[span] == "found", (spans.routes, out)
    assert spans.found == {path}


# A word that BEARS a repository path and that no normaliser can read. These are
# what the third `uncertain` kind exists for, and mutation testing is why they
# are here: disabling the `uncertain` branch entirely left the whole suite GREEN,
# which means the branch was code nobody had exercised -- a test proving nothing.
UNCERTAIN_WORDS = [
    ("double_colon_citation", "src/populus/cli.py:12:34"),
    ("assignment_in_a_path", "scripts/a=b.py"),
    # `trailing_comma` -- `src/populus/no_such_xyz.py,` -- used to live here.
    # F29 made it READABLE: a trailing prose mark is now stripped, so it
    # normalises to a plain candidate and is no longer uncertain. Replaced with
    # a spelling no normaliser claims, so the branch stays exercised.
    ("brace_expansion", "src/populus/{a,b}.py"),
]


@pytest.mark.parametrize(("label", "word"), UNCERTAIN_WORDS,
                         ids=[lbl for lbl, _ in UNCERTAIN_WORDS])
def test_cross_run_unreadable_path_bearing_word_is_uncertain(
    tmp_path, capsys, label, word
):
    """G3: path-bearing uncertainty fails CLOSED, it does not fall to `dropped`.

    Each of these ends in a repository file extension, or its first segment is a
    real top-level entry of the baseline tree, so ``path_shaped()`` says it
    bears a path -- while ``CAND_RE``, the job qualifier and the line-citation
    normaliser all decline to read it. Dropping it would be a fail-open of
    exactly the F23 shape: the plan named a file and the OWNERSHIP gate said
    nothing.
    """
    tracked = cross_run.load_tracked("origin/main")
    top_dirs = frozenset(q.split("/", 1)[0] for q in tracked)
    kind, value = cross_run.classify_word(word, top_dirs)
    assert kind == "uncertain", (word, kind, value)
    assert cross_run.word_stem(word) is None, (
        "fixture is meaningless unless the normalisers really do decline it"
    )

    sec = tmp_path / "sec.md"
    sec.write_text(f"The run touches `see {word} today` during the cutover.\n")
    i2 = tmp_path / "i2.md"
    i2.write_text("Edits `Makefile`.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 1, out
    assert "UNRESOLVED in sec" in out


@pytest.mark.parametrize(
    ("span", "why"),
    [
        # Both families are LIVE in the I-2 plan and both are path-SHAPED, so
        # they reach the resolution ladder now that per-word classification is
        # total. Each is exempted by an IGNORE_PATTERNS entry carrying a reason.
        ("$RUNNER_TEMP/publication-authority.pre-mutation.json", "CI variable root"),
        ("$INST_ACT_RUN/four-plane.S1.json", "CI variable root"),
        ("builds/<build-id>/deployments/<generation>.json", "placeholder template"),
        ("<result>.approvals.json", "placeholder template"),
        ("registry/company_tickers/snapshots/<sha>/company_tickers.json",
         "placeholder template"),
    ],
)
def test_cross_run_runtime_artifact_families_are_ignored_with_a_reason(
    tmp_path, span, why
):
    """The two IGNORE families the totality fix surfaced, pinned as `ignored`.

    They are not `dropped` -- that would be the silent sink -- and not
    `unresolved` -- that would make the gate unpassable on the real plans. They
    are exempted, by pattern, with a written reason, which is the only category
    in this tool allowed to hide a token.
    """
    sec = tmp_path / "sec.md"
    sec.write_text(f"The run writes `{span}` during the cutover.\n")
    tracked = cross_run.load_tracked("origin/main")
    spans = _extract(sec, tracked, set())
    assert spans.routes[span] == "ignored", (why, spans.routes)


def _tracked_indexes(ref="origin/main"):
    tracked = cross_run.load_tracked(ref)
    by_base: dict[str, list[str]] = {}
    by_suffix: dict[str, list[str]] = {}
    for q in tracked:
        by_base.setdefault(q.rsplit("/", 1)[-1], []).append(q)
        parts = q.split("/")
        for i in range(1, len(parts)):
            by_suffix.setdefault("/".join(parts[i:]), []).append(q)
    return tracked, by_base, by_suffix


@pytest.mark.parametrize(
    "path", ["src/populus/cli.py", "README.md", "dashboard/public/_headers"],
)
def test_cross_run_new_ignore_patterns_cannot_hide_a_real_path(path):
    """The other half: a hiding rule must not reach a path that really exists.

    An IGNORE pattern is the one mechanism here that can make a token disappear
    with the gate still green, so each new one is checked against real tracked
    paths rather than only against the tokens it was written for.
    """
    tracked, by_base, by_suffix = _tracked_indexes()
    assert not cross_run.ignored(path, tracked, by_base, by_suffix), path
    assert path in tracked, "fixture is meaningless unless the path is tracked"


# --- F28: an IGNORE pattern may not hide a WRAPPED tracked path -------------
#
# Every one of these was measured at bucket `ignored` on the previous revision,
# with the gate at exit 0, although `src/populus/cli.py` IS tracked on the
# pinned baseline. Each is claimed by a DIFFERENT pattern -- the variable root,
# the placeholder, and the leading slash -- so this is a precedence defect, not
# three pattern defects, and it is fixed by ORDER rather than by narrowing.
WRAPPED_TRACKED_PATHS = [
    ("variable_root", "$REPO/src/populus/cli.py"),
    ("placeholder_suffix", "src/populus/cli.py<placeholder>"),
    ("leading_slash", "/src/populus/cli.py"),
]


@pytest.mark.parametrize(("label", "span"), WRAPPED_TRACKED_PATHS,
                         ids=[lbl for lbl, _ in WRAPPED_TRACKED_PATHS])
def test_cross_run_ignore_cannot_hide_a_tracked_path(tmp_path, label, span):
    """G4: resolution runs FIRST, and a resolvable value is never exempted."""
    tracked, by_base, by_suffix = _tracked_indexes()
    assert not cross_run.ignored(span, tracked, by_base, by_suffix), span
    plan = tmp_path / "sec.md"
    plan.write_text(f"The run edits `{span}` in place.\n")
    spans = _extract(plan, tracked, set())
    assert spans.routes[span] == "found", spans.routes
    assert spans.found == {"src/populus/cli.py"}, spans.found


# --- F28 round 2: an ARBITRARY CHECKOUT ROOT may not hide a tracked path ----
#
# Round 1 inverted the IGNORE/resolution precedence and fixed the three wrappers
# NORMALISERS knows: `$REPO/...`, `...<placeholder>`, `/...`. It left open the
# spelling a person actually writes -- the absolute path to a file in their own
# checkout -- because a checkout root is not a wrapper but an ARBITRARY number
# of arbitrary leading segments. Every form below was measured at bucket
# `ignored` with the gate at exit 0, although `src/populus/cli.py` IS tracked.
CHECKOUT_ROOTED_TRACKED_PATHS = [
    ("owner_home", "/Users/johnbaek/projects/Populus/src/populus/cli.py"),
    ("container_repo", "/repo/src/populus/cli.py"),
    ("container_workspace", "/workspace/src/populus/cli.py"),
    ("ci_workspace_var", "$GITHUB_WORKSPACE/Populus/src/populus/cli.py"),
]


@pytest.mark.parametrize(("label", "span"), CHECKOUT_ROOTED_TRACKED_PATHS,
                         ids=[lbl for lbl, _ in CHECKOUT_ROOTED_TRACKED_PATHS])
def test_cross_run_absolute_checkout_root_resolves_to_tracked(
    tmp_path, label, span, capsys
):
    """G4: an arbitrary leading root does not buy an exemption.

    Process-level, not just unit-level: the point of the defect was that the
    GATE exited 0, so the gate's status is what is asserted.
    """
    tracked, by_base, by_suffix = _tracked_indexes()
    assert not cross_run.ignored(span, tracked, by_base, by_suffix), span
    hit, amb, weak, undec = cross_run.resolve_or_ambiguous(
        span, tracked, by_base, by_suffix)
    assert (hit, amb, weak, undec) == ("src/populus/cli.py", False, False, False), \
        (span, hit, amb, weak, undec)

    sec = tmp_path / "sec.md"
    sec.write_text(f"The run edits `{span}` in place.\n")
    i2 = tmp_path / "i2.md"
    i2.write_text("Edits `Makefile`.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 0, out
    spans = _extract(sec, tracked, set())
    assert spans.routes[span] == "found", spans.routes
    assert spans.found == {"src/populus/cli.py"}, spans.found


def test_cross_run_ambiguous_checkout_root_suffix_is_unresolved(tmp_path, capsys):
    """N4 and G3: an ambiguous suffix is REFUSED, never silently picked.

    `/tmp/Populus/README.md` is the fifth measured F28 form, and it is the one
    that must NOT resolve: four `README.md` files are tracked, so no segment
    suffix of the token names exactly one. The fix must move it out of
    `ignored` -- where the gate exited 0 -- without inventing an attribution.
    Landing it in `unresolved` is the whole point: uncertainty fails closed.
    """
    span = "/tmp/Populus/README.md"
    tracked, by_base, by_suffix = _tracked_indexes()
    assert len([t for t in tracked if t.rsplit("/", 1)[-1] == "README.md"]) >= 2, \
        "fixture is meaningless unless README.md is genuinely ambiguous"
    hit, amb, weak, undec = cross_run.resolve_or_ambiguous(
        span, tracked, by_base, by_suffix)
    assert (hit, amb, weak, undec) == (None, True, False, False), (hit, amb, weak, undec)
    # And IGNORE may not claim it either: undecided is not the same as
    # incapable of resolving, and G4 covers both.
    assert not cross_run.ignored(span, tracked, by_base, by_suffix), span

    sec = tmp_path / "sec.md"
    sec.write_text(f"The run edits `{span}` in place.\n")
    i2 = tmp_path / "i2.md"
    i2.write_text("Edits `Makefile`.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 1, out
    assert "UNRESOLVED in sec" in out and span in out, out
    spans = _extract(sec, tracked, set())
    assert spans.routes[span] == "unresolved", spans.routes
    assert not spans.found, spans.found


NON_REPO_ABSOLUTE_PATHS = ["/etc/passwd", "/usr/local/bin/thing",
                           "/etc/ssl/certs/ca-certificates.crt"]


@pytest.mark.parametrize("span", NON_REPO_ABSOLUTE_PATHS)
def test_cross_run_non_repo_absolute_path_does_not_resolve(tmp_path, span, capsys):
    """The negative control the suffix rule needs to be worth anything.

    Segment-suffix resolution is the widest rung on the ladder, so it is the one
    most able to manufacture a false attribution. A path that is genuinely not
    in this repository must resolve to NOTHING -- if one of these ever reports
    `found`, the rule has stopped being about this repository's file set.
    """
    tracked, by_base, by_suffix = _tracked_indexes()
    hit, amb, weak, undec = cross_run.resolve_or_ambiguous(
        span, tracked, by_base, by_suffix)
    assert (hit, amb, weak, undec) == (None, False, False, False), (span, hit, amb, weak, undec)

    sec = tmp_path / "sec.md"
    sec.write_text(f"Reads `{span}` at runtime.\n")
    i2 = tmp_path / "i2.md"
    i2.write_text("Edits `Makefile`.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 0, out
    spans = _extract(sec, tracked, set())
    assert spans.routes[span] != "found", spans.routes
    assert not spans.found, spans.found


def test_cross_run_suffix_match_only_cuts_at_segment_boundaries():
    """The rule is a SEGMENT-LIST search, not a string-suffix search.

    The suffix it reports must be an exact tail of the token's SEGMENT list. A
    plain ``str.endswith`` rule would happily resolve `.../xpopulus/cli.py`
    through the tracked segment `populus` by cutting a real segment in half;
    asserted on ``suffix_match`` directly, because at the gate level the two
    spellings can coincidentally agree via a shorter suffix.
    """
    tracked, _by_base, by_suffix = _tracked_indexes()
    suffix, hits = cross_run.suffix_match(
        "/a/b/src/populus/cli.py", tracked, by_suffix)
    assert (suffix, hits) == ("src/populus/cli.py", ["src/populus/cli.py"])
    for token in ("/a/b/xpopulus/cli.py", "/a/bsrc/populus/cli.py",
                  "/etc/mysrc/populus/cli.py"):
        suffix, _hits = cross_run.suffix_match(token, tracked, by_suffix)
        segs = token.split("/")
        assert suffix in {"/".join(segs[i:]) for i in range(1, len(segs))}, \
            (token, suffix)


# --- F28 round 3: suffix evidence is TRI-STATE ------------------------------
#
# This test previously asserted that a one-segment suffix NEVER produces a
# `found` -- full stop, prefix irrelevant. That is the assertion that PINNED the
# defect rather than catching it: three tracked root-level files escaped the
# ownership gate at exit 0 because of it, measured directly --
#
#     `<HOME>/projects/Populus/NOTICE`      dropped, exit 0   (NOTICE IS tracked)
#     `/repo/Makefile`                      dropped, exit 0   (Makefile IS tracked)
#     `$GITHUB_WORKSPACE/Populus/LICENSE`   dropped, exit 0   (LICENSE IS tracked)
#
# The rule it pinned was right about its examples and wrong as an absolute. What
# survives is the narrowed rule -- a one-segment suffix under an UNRECOGNIZED
# prefix is no evidence -- and it is stated below with the SAME three tokens, so
# the protection it bought is not lost. The old, wider assertion is DELETED
# rather than kept alongside: two tests asserting opposite halves of one contract
# is how a previous round shipped a test that excused the defect it was meant to
# catch.
def test_cross_run_one_segment_suffix_under_an_unrecognized_prefix():
    """The narrowed ONE-SEGMENT rule: a bare basename under a foreign prefix.

    Each token below ends in the basename of exactly one tracked file, and
    every one of those attributions would be wrong -- a declared-IGNORE runtime
    artifact, a vendor URL, and a root-level filename under a prefix that is
    NOT a checkout root (the F28 direction-1 fixtures prove the same basename
    DOES resolve when the prefix IS one). The first is LIVE in the I-2 plan, so
    this is not a hypothetical. (An earlier third token, `/a/b/projects/Populus`,
    depended on the since-deleted tracked path `docs/design/handoff/Populus
    Design System.dc.html` -- and on `load_tracked` truncating that path at its
    first space, a latent quoting limitation that currently has no tracked
    space-bearing path to bite.)

    `weak` must be False too, not merely `hit is None`: escalating these to
    `unresolved` would turn four already-exempted live IGNORE spans into
    permanent gate failures with nothing for a human to decide.
    """
    tracked, by_base, by_suffix = _tracked_indexes()
    for token in (
        "registry/company_tickers/snapshots/<sha>/company_tickers.json",
        "https://www.sec.gov/files/company_tickers.json",
        "/a/b/projects/NOTICE",
    ):
        suffix, hits = cross_run.suffix_match(token, tracked, by_suffix)
        assert "/" not in suffix and len(hits) == 1, (token, suffix, hits)
        prefix = token[: len(token) - len(suffix)]
        assert not cross_run.is_checkout_root(prefix), (token, prefix)
        hit, amb, weak = cross_run.resolve_suffix_any(token, tracked, by_suffix)
        assert (hit, amb, weak) == (None, False, False), (token, hit, amb, weak)


# The three forms the old absolute rule let escape. Each names a TRACKED
# root-level file through an ordinary checkout path, so the terminal segment is
# not a guess -- it is the file.
ROOT_LEVEL_UNDER_CHECKOUT_ROOT = [
    ("owner_home", "/Users/johnbaek/projects/Populus/NOTICE", "NOTICE"),
    ("container_repo", "/repo/Makefile", "Makefile"),
    ("ci_workspace_var", "$GITHUB_WORKSPACE/Populus/LICENSE", "LICENSE"),
]


@pytest.mark.parametrize(("label", "span", "expected"),
                         ROOT_LEVEL_UNDER_CHECKOUT_ROOT,
                         ids=[lbl for lbl, _, _ in ROOT_LEVEL_UNDER_CHECKOUT_ROOT])
def test_cross_run_root_level_file_under_a_checkout_root_resolves(
    tmp_path, label, span, expected, capsys
):
    """F28 direction 1: real ownership must not escape through a one-segment cut.

    Process-level as well as unit-level, because the defect WAS the gate's exit
    status: all three were `dropped` at exit 0 while the file they name is
    tracked on the pinned baseline.
    """
    tracked, by_base, by_suffix = _tracked_indexes()
    assert expected in tracked, "fixture is meaningless unless the path is tracked"
    hit, amb, weak, undec = cross_run.resolve_or_ambiguous(
        span, tracked, by_base, by_suffix)
    assert (hit, amb, weak, undec) == (expected, False, False, False), (span, hit, amb, weak, undec)
    assert not cross_run.ignored(span, tracked, by_base, by_suffix), span

    sec = tmp_path / "sec.md"
    sec.write_text(f"The run edits `{span}` in place.\n")
    i2 = tmp_path / "i2.md"
    i2.write_text("Edits `pyproject.toml`.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 0, out
    spans = _extract(sec, tracked, set())
    assert spans.routes[span] == "found", spans.routes
    assert spans.found == {expected}, spans.found


# F28 direction 2: a prefix that is NOT this repository must not manufacture a
# conflict. `/opt/unrelated/...` spells a real repository-relative path, so the
# tool cannot simply drop it -- but it may not assert ownership either.
def test_cross_run_unrecognized_prefix_is_unresolved_not_found(tmp_path, capsys):
    """G3: a multi-segment suffix under an unjustifiable prefix fails CLOSED.

    Measured on the previous revision: `found -> src/populus/cli.py`, which is a
    FALSE ownership claim -- it blocks a slice on a conflict that does not exist.
    `unresolved` is the honest outcome: the tool cannot tell, so a human decides.
    """
    span = "/opt/unrelated/src/populus/cli.py"
    tracked, by_base, by_suffix = _tracked_indexes()
    assert "src/populus/cli.py" in tracked
    hit, amb, weak, undec = cross_run.resolve_or_ambiguous(
        span, tracked, by_base, by_suffix)
    assert (hit, amb, weak, undec) == (None, False, True, False), (hit, amb, weak, undec)
    # G4: and no hiding category may claim it either -- undecided is not the
    # same as shown incapable of resolving.
    assert not cross_run.ignored(span, tracked, by_base, by_suffix), span

    sec = tmp_path / "sec.md"
    sec.write_text(f"Reads `{span}` at runtime.\n")
    i2 = tmp_path / "i2.md"
    i2.write_text("Edits `pyproject.toml`.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 1, out
    assert "UNRESOLVED in sec" in out and span in out, out
    spans = _extract(sec, tracked, set())
    assert spans.routes[span] == "unresolved", spans.routes
    assert not spans.found, spans.found


# --------------------------------------------------------------------------
# F34: the URI discriminator is SEMANTIC, and it is wrong in BOTH directions
# when it is a scheme pattern instead.
#
# The predecessor of this block was
# `test_cross_run_url_scheme_never_resolves_to_ownership`, parametrised over
# three `scheme://` strings. It was DELETED rather than kept alongside these:
# it pinned "matches `^[A-Za-z][A-Za-z0-9+.-]*://`" as the contract, which is
# precisely the discriminator F34 replaced, and a test asserting the old
# contract next to the new one is how two earlier defects in this tool survived
# a review round. Its three strings are carried forward below as the first three
# rows of REMOTE_AUTHORITY_REPO_PATHS, so nothing it covered is lost.
REMOTE_AUTHORITY_REPO_PATHS = [
    ("https", "https://vendor.example/src/populus/cli.py"),
    ("http", "http://vendor.example/src/populus/cli.py"),
    # userinfo must not be read as the host: the authority is `vendor.example`.
    ("git_ssh", "git+ssh://git@vendor.example/src/populus/cli.py"),
    # PROTOCOL-RELATIVE: an authority and NO scheme, so a scheme regex misses it
    # entirely. Measured on the previous revision, both at `found ->
    # src/populus/cli.py` -- a FALSE ownership claim, because `is_checkout_root`
    # read the REMOTE HOST as this repository's checkout directory.
    ("protocol_relative_repo", "//repo/src/populus/cli.py"),
    ("protocol_relative_workspace", "//workspace/src/populus/cli.py"),
    ("protocol_relative_reponame", "//Populus/src/populus/cli.py"),
    # ... and one whose host is not in the recognized set, which the previous
    # revision called `unresolved`: a permanent gate failure for a decided
    # non-repository reference.
    ("protocol_relative_vendor", "//vendor.example/src/populus/cli.py"),
    # A port must not be read as part of the host either.
    ("port", "https://vendor.example:8443/src/populus/cli.py"),
]


@pytest.mark.parametrize(("label", "span"), REMOTE_AUTHORITY_REPO_PATHS,
                         ids=[lbl for lbl, _ in REMOTE_AUTHORITY_REPO_PATHS])
def test_cross_run_remote_authority_never_resolves_to_ownership(
    tmp_path, label, span, capsys
):
    """N8: a REMOTE AUTHORITY is a DECIDED non-repository reference.

    The authority component says whose host it is, so this is neither ownership
    nor uncertainty: it is `dropped` -- counted, listable under --show-dropped,
    and not a gate failure. Asserted across scheme'd, protocol-relative,
    userinfo-bearing and port-bearing forms so the guard is a property of what
    the reference MEANS rather than of a string pattern.
    """
    tracked, by_base, by_suffix = _tracked_indexes()
    assert "src/populus/cli.py" in tracked
    assert cross_run.uri_disposition(span) == (cross_run.URI_OFF_REPO, span)
    hit, amb, weak, undec = cross_run.resolve_or_ambiguous(
        span, tracked, by_base, by_suffix)
    assert (hit, amb, weak, undec) == (None, False, False, False), (span, hit, amb, weak, undec)

    sec = tmp_path / "sec.md"
    sec.write_text(f"Mirrored at `{span}` upstream.\n")
    i2 = tmp_path / "i2.md"
    i2.write_text("Edits `pyproject.toml`.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 0, out
    spans = _extract(sec, tracked, set())
    assert spans.routes[span] == "dropped", spans.routes
    assert not spans.found, spans.found


# `<HOME>` is spelled from the environment rather than written out: this file is
# scanned by check_abs_paths.sh alongside the tool it tests.
_CHECKOUT = f"{_USERS}johnbaek/projects/Populus"

LOCAL_FILE_URIS = [
    # The ESCAPE F34 reported: a local path inside the checkout, merely written
    # as a file URL. `dropped` on the previous revision -- so `file://` was a way
    # to hide an owned checkout path from the overlap gate.
    ("empty_authority", f"file://{_CHECKOUT}/src/populus/cli.py",
     "found", "src/populus/cli.py"),
    # `localhost` is a LOCAL authority, not a remote host.
    ("localhost", f"file://localhost{_CHECKOUT}/src/populus/cli.py",
     "found", "src/populus/cli.py"),
    ("loopback", f"file://127.0.0.1{_CHECKOUT}/src/populus/cli.py",
     "found", "src/populus/cli.py"),
    # Percent-decoding happens BEFORE resolution, so an encoded local file URL
    # resolves exactly as its decoded spelling does.
    ("percent_encoded", f"file://{_CHECKOUT}/src/populus/cli%2Epy",
     "found", "src/populus/cli.py"),
    ("percent_encoded_root", f"file://{_CHECKOUT}/src/populus%2Fcli.py",
     "found", "src/populus/cli.py"),
    # A container checkout root works through the SAME rule, extension-blind.
    ("container_root", "file:///repo/Makefile", "found", "Makefile"),
    ("extensionless", "file:///opt/checkout/dashboard/public/_headers",
     "found", "dashboard/public/_headers"),
]


@pytest.mark.parametrize(
    ("label", "span", "bucket", "expected"), LOCAL_FILE_URIS,
    ids=[row[0] for row in LOCAL_FILE_URIS],
)
def test_cross_run_local_file_uri_goes_down_the_one_ladder(
    tmp_path, label, span, bucket, expected, capsys
):
    """G4/F34: a LOCAL `file:` reference is a filesystem path, not a URL.

    It is percent-decoded and handed to the SAME ladder every other path uses --
    never special-cased into ownership -- so it reaches `found` through the
    ordinary checkout-root rule and inherits every refusal that rule carries.
    """
    tracked, by_base, by_suffix = _tracked_indexes()
    assert expected in tracked
    disposition, value = cross_run.uri_disposition(span)
    assert disposition == cross_run.URI_LOCAL, (span, disposition)
    assert value.startswith("/"), value
    hit, amb, weak, undec = cross_run.resolve_or_ambiguous(
        span, tracked, by_base, by_suffix)
    assert (hit, amb, weak, undec) == (expected, False, False, False), (span, hit, amb, weak, undec)

    sec = tmp_path / "sec.md"
    sec.write_text(f"The run edits `{span}` in this slice.\n")
    i2 = tmp_path / "i2.md"
    i2.write_text("Edits `pyproject.toml`.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 0, out
    spans = _extract(sec, tracked, set())
    assert spans.routes[span] == bucket, spans.routes
    assert spans.found == {expected}, spans.found


LOCAL_FILE_URI_EQUIVALENCES = [
    # An unrecognized prefix stays a REFUSAL, exactly as bare: `weak`.
    ("unrecognized_prefix", "file:///opt/unrelated/src/populus/cli.py",
     "/opt/unrelated/src/populus/cli.py", "unresolved"),
    # Four tracked `README.md`, so the suffix is AMBIGUOUS and fails closed.
    ("ambiguous_suffix", f"file://{_USERS}x/tmp/Populus/README.md",
     f"{_USERS}x/tmp/Populus/README.md", "unresolved"),
    # Extensionless and unresolvable through a recognized root: still `weak`.
    ("extensionless_unrecognized",
     "file:///opt/unrelated/dashboard/public/_headers",
     "/opt/unrelated/dashboard/public/_headers", "unresolved"),
    # `file:` may not buy an EXEMPTION either. Both spellings land in the same
    # non-failing bucket, and it is the bare spelling's rule that puts them
    # there -- the `^/` IGNORE pattern, and the catch-all.
    ("no_such_file", "file:///repo/scripts/no_such_future_tool_xyz.py",
     "/repo/scripts/no_such_future_tool_xyz.py", "ignored"),
    ("no_such_extensionless", "file:///repo/docs/runbooks/no_such_thing_at_all",
     "/repo/docs/runbooks/no_such_thing_at_all", "dropped"),
]


@pytest.mark.parametrize(
    ("label", "file_uri", "bare", "bucket"), LOCAL_FILE_URI_EQUIVALENCES,
    ids=[row[0] for row in LOCAL_FILE_URI_EQUIVALENCES],
)
def test_cross_run_local_file_uri_behaves_as_its_bare_equivalent(
    tmp_path, label, file_uri, bare, bucket
):
    """`file:` grants no exemption: it decodes to a path and inherits its fate.

    The point of feeding the decoded path to the one ladder rather than giving
    `file:` a rung of its own is that every outcome the ladder already produces
    -- the unrecognized prefix, the ambiguous suffix, the written-off artifact,
    the catch-all -- applies unchanged. Asserted as an EQUALITY against the bare
    spelling AND against a named bucket, so neither a loosening of one side nor a
    matched drift of both can pass.
    """
    tracked, by_base, by_suffix = _tracked_indexes()
    assert (cross_run.resolve_or_ambiguous(file_uri, tracked, by_base, by_suffix)
            == cross_run.resolve_or_ambiguous(bare, tracked, by_base, by_suffix))

    def bucket_of(span):
        plan = tmp_path / (re.sub(r"\W", "_", span)[:80] + ".md")
        plan.write_text(f"The run edits `{span}` in this slice.\n")
        return _extract(plan, tracked, set()).routes[span]

    assert bucket_of(file_uri) == bucket_of(bare) == bucket


def test_cross_run_unresolvable_local_file_uri_fails_the_gate(tmp_path, capsys):
    """The equivalence above, carried through to the EXIT CONTRACT.

    The reported token is the DECODED path rather than the `file:` spelling the
    plan wrote: the discriminator normalises before classification, so what the
    operator is asked to classify as NEW / PROSE / IGNORE is the filesystem path
    the reference denotes. Pinned here so that normalisation is a stated
    property of the report rather than an accident of it.
    """
    file_uri = "file:///opt/unrelated/src/populus/cli.py"
    bare = "/opt/unrelated/src/populus/cli.py"
    sec = tmp_path / "sec.md"
    sec.write_text(f"The run edits `{file_uri}` in this slice.\n")
    i2 = tmp_path / "i2.md"
    i2.write_text("Edits `pyproject.toml`.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 1, out
    assert "UNRESOLVED in sec" in out and bare in out, out


@pytest.mark.parametrize(
    "token",
    [
        "src/populus/cli.py",                 # a bare path
        "dashboard/public/_headers",
        "publish.yml:publish",                # parses as scheme `publish.yml`
        "src/populus/cli.py:513-520",
        "mailto:someone@vendor.example",      # a scheme with no authority
        "dashboard/src/pages/search/index.v2.json.gz.ts",
        "dashboard/src/pages/congress/data/feed/[year].v1.json.ts",
        "file:",                              # a file: reference with no path
        "/etc/passwd",                        # a bare absolute path
        "/usr/local/bin/thing",
        "NOTICE",                             # a bare basename
        "docs/runbooks/deploy.md:12",
    ],
)
def test_cross_run_uri_discriminator_leaves_non_uri_tokens_alone(token):
    """The FOURTH arm: anything that is not a URI reference is UNTOUCHED.

    A discriminator that claims too much is the mirror of one that claims too
    little. `publish.yml:publish` in particular parses as a scheme with no
    authority, and must keep flowing down the existing path -- it is a workflow
    job qualifier, not a URL.

    `//[unclosed/src/populus/cli.py` USED TO BE IN THIS LIST, and that was the
    F34 second-round defect written down as a passing test. `urlsplit` raises
    on it, and returning `(None, token)` -- the answer this list is about --
    said "decided: not a URI, carry on down the path ladder" about a string
    nothing had parsed. It now answers `URI_UNDECIDABLE`; see
    `test_cross_run_undecidable_is_distinct_from_not_a_uri`. Every entry that
    remains here PARSES, which is the property this list is really asserting.

    `//localhost/src/populus/cli.py` -- commented "local authority, no file:
    scheme" -- ALSO used to be in this list, and that was the F34 THIRD-round
    defect written down as a passing test, for the second time and in the same
    shape. Its prefix `/` is not a recognized checkout root, so the token
    happened to reach `unresolved` anyway and the helper's `None` looked
    harmless; `//localhost/repo/src/populus/cli.py`, one segment different, was
    attributed to a tracked file at exit 0. That is precisely why a helper-only
    expectation was the wrong pin, and it has been REPLACED -- not supplemented
    -- by the END-TO-END bucket assertions in
    `test_cross_run_local_authority_without_file_scheme_is_undecidable` and
    `test_cross_run_local_non_file_authority_never_claims_ownership`.

    So this list now asserts a sharper property than "parses": every entry
    parses AND carries no authority. An authority-bearing token is decided by
    one of the three non-`None` arms, never by this one.
    """
    assert cross_run.uri_disposition(token) == (None, token), token
    parts = urllib.parse.urlsplit(token)  # the entries here are all parseable
    assert not parts.netloc, (token, parts.netloc)


def test_cross_run_uri_authority_is_the_HOST_not_the_raw_netloc():
    """Userinfo and a port are not part of the host, in either direction.

    Reading the raw netloc instead of the parsed host is a surviving mutant
    otherwise: every remote form in this file happens to agree, and only a LOCAL
    authority wearing userinfo or a port tells the two apart. It matters because
    the mistake is silent -- `user@localhost` is not in the local set, so a
    genuinely local file URL would be called remote and an owned path would
    leave the gate.
    """
    local = f"file://user@localhost{_CHECKOUT}/src/populus/cli.py"
    assert cross_run.uri_disposition(local) == (
        cross_run.URI_LOCAL, f"{_CHECKOUT}/src/populus/cli.py")
    ported = f"file://localhost:9{_CHECKOUT}/src/populus/cli.py"
    assert cross_run.uri_disposition(ported) == (
        cross_run.URI_LOCAL, f"{_CHECKOUT}/src/populus/cli.py")
    # ... and the other direction: a LOCAL-LOOKING userinfo may not make a
    # remote host local. The host here is `vendor.example`.
    remote = "https://localhost@vendor.example/src/populus/cli.py"
    assert cross_run.uri_disposition(remote) == (cross_run.URI_OFF_REPO, remote)


def test_cross_run_uri_discriminator_runs_to_a_fixpoint(tmp_path):
    """A remote authority may not hide behind one `file:` layer.

    `file:file://repo/...` peels to `//repo/...`, whose authority is the REMOTE
    HOST `repo` -- and `repo` is in `CHECKOUT_ROOT_SEGMENTS`, so a single-pass
    discriminator hands the peeled string to the ladder and `is_checkout_root`
    manufactures ownership from it. This is the F34 false claim reachable one
    wrapper deeper, which is why the peel is iterated rather than done once.
    """
    hidden = "file:file://repo/src/populus/cli.py"
    assert cross_run.uri_disposition(hidden) == (cross_run.URI_OFF_REPO, hidden)
    # A FIXPOINT, not a fixed depth: two layers is not a magic number, and a
    # bound of "two peels" is a surviving mutant without this line.
    deeper = "file:file:file://repo/src/populus/cli.py"
    assert cross_run.uri_disposition(deeper) == (cross_run.URI_OFF_REPO, deeper)
    # The converse: nesting must not cost a genuinely local reference its
    # resolution either.
    nested_local = f"file:file://{_CHECKOUT}/src/populus/cli.py"
    assert cross_run.uri_disposition(nested_local) == (
        cross_run.URI_LOCAL, f"{_CHECKOUT}/src/populus/cli.py")

    tracked, by_base, by_suffix = _tracked_indexes()
    assert cross_run.resolve_or_ambiguous(
        hidden, tracked, by_base, by_suffix) == (None, False, False, False)
    assert cross_run.resolve_or_ambiguous(
        nested_local, tracked, by_base, by_suffix) == (
            "src/populus/cli.py", False, False, False)

    plan = tmp_path / "sec.md"
    plan.write_text(f"Mirrored at `{hidden}` upstream.\n")
    spans = _extract(plan, tracked, set())
    assert spans.routes[hidden] == "dropped", spans.routes
    assert not spans.found, spans.found


def test_cross_run_uri_discriminator_is_not_a_scheme_pattern():
    """F34 stated as one assertion: syntax and meaning disagree, both ways.

    The deleted `test_cross_run_url_scheme_never_resolves_to_ownership` would
    have passed on BOTH of these -- neither is a `scheme://` string in the sense
    that regex meant -- which is why it could not have caught either defect.
    """
    scheme_re = re.compile(r"^[A-Za-z][A-Za-z0-9+.\-]*://")
    escape = f"file://{_CHECKOUT}/src/populus/cli.py"
    false_claim = "//repo/src/populus/cli.py"
    # The escape MATCHES the old pattern and yet is a local, owned path.
    assert scheme_re.match(escape)
    assert cross_run.uri_disposition(escape)[0] == cross_run.URI_LOCAL
    # The false claim does NOT match the old pattern and yet is remote.
    assert not scheme_re.match(false_claim)
    assert cross_run.uri_disposition(false_claim)[0] == cross_run.URI_OFF_REPO
    # And the tool no longer carries a scheme regex at all.
    src = Path(cross_run.__file__).read_text(encoding="utf-8")
    assert "SCHEME_RE" not in src, "the syntax-only discriminator is back"


def test_cross_run_is_checkout_root_is_case_sensitive_and_last_segment_only():
    """The rule that licenses every ownership assertion, stated directly.

    Case-sensitivity is load-bearing, not fussiness: with a lowercase `populus`
    accepted, the prefix `/x/src/populus` of `/x/src/populus/no_such/cli.py`
    would be "a checkout root" and the token would be attributed to
    `src/populus/cli.py`.
    """
    for prefix in ("/Users/johnbaek/projects/Populus", "$GITHUB_WORKSPACE/Populus",
                   "/repo", "/workspace", "/opt/checkout", "Populus/",
                   "/home/runner/work/Populus/Populus"):
        assert cross_run.is_checkout_root(prefix), prefix
    for prefix in ("", "/", "/opt/unrelated", "/Users/johnbaek/projects",
                   "/x/src/populus", "identity", "https://www.sec.gov/files",
                   "/repo/nested", "REPO", "workspaces"):
        assert not cross_run.is_checkout_root(prefix), prefix


@pytest.mark.parametrize(
    ("span", "expected"),
    [
        ("/opt/checkout/dashboard/public/_headers", "dashboard/public/_headers"),
        ("/_headers", "dashboard/public/_headers"),
        ("$GITHUB_WORKSPACE/Populus/dashboard/public/_headers",
         "dashboard/public/_headers"),
    ],
)
def test_cross_run_checkout_root_over_an_extensionless_path_resolves(
    tmp_path, span, expected, capsys
):
    """The rung `path_shaped()` cannot reach on its own.

    `path_shaped()` is CONTEXT-FREE -- a repository file extension, or a first
    segment that is a real top-level entry -- and an absolutely-rooted
    EXTENSIONLESS path has neither. Such a span produced zero candidates and
    fell into `dropped`, which is the same F28 fail-open as the five headline
    forms wearing a different bucket. `/_headers` is LIVE in the security plan.
    """
    tracked, by_base, by_suffix = _tracked_indexes()
    assert expected in tracked, "fixture is meaningless unless the path is tracked"
    sec = tmp_path / "sec.md"
    sec.write_text(f"The slice rewrites `{span}`.\n")
    i2 = tmp_path / "i2.md"
    i2.write_text("Edits `Makefile`.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 0, out
    spans = _extract(sec, tracked, set())
    assert spans.routes[span] == "found", spans.routes
    assert spans.found == {expected}, spans.found


def test_cross_run_catch_all_rung_is_additive_only():
    """The rung must sit AFTER `repo_candidates`, not before it.

    Placed before, it would outrank `declared_new`, `directory` and `ignored`
    and could take a span away from a category that had already claimed it.
    Placed after, it can only claim what was already headed for `dropped`. The
    ordering is the whole safety argument, so it is asserted structurally --
    a behavioural test would only sample it.
    """
    import ast

    src = CROSS_RUN.read_text(encoding="utf-8")
    tree = ast.parse(src)
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.FunctionDef) and n.name == "classify_span")
    lines = [n.lineno for n in ast.walk(fn)
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
             and n.func.id == "repo_candidates"]
    assert len(lines) == 1, lines
    # The catch-all `return "dropped", t or span, ctx` and the rung above it.
    drop = src.index('return "dropped", t or span, ctx')
    drop_line = src[:drop].count("\n") + 1
    rung = [n.lineno for n in ast.walk(fn)
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
            and n.func.id == "resolve_or_ambiguous" and n.lineno < drop_line]
    assert rung, "the pre-catch-all rung is gone"
    assert max(rung) > lines[0], (
        "the rung moved ABOVE repo_candidates -- it is no longer additive and "
        "can now steal a span from declared_new / directory / ignored"
    )


def test_cross_run_bare_token_is_untouched_by_the_suffix_rule():
    """The new rung must be inert where there is no separator.

    A bare token has no proper segment suffix, so basename resolution stays the
    only route for it and nothing about single-word spans changed. Stated as a
    test because "inert by construction" is exactly the kind of claim that
    quietly stops being true.
    """
    tracked, _by_base, by_suffix = _tracked_indexes()
    for token in ("README.md", "NOTICE", "cli.py", "no_such_file_xyz.md", ""):
        assert cross_run.suffix_match(token, tracked, by_suffix) == ("", []), token


def test_cross_run_ignore_still_hides_the_runtime_families():
    """The inversion must not have disabled the category it reorders.

    Each of these is a real IGNORE entry whose value resolves to nothing under
    every reading, so the veto does not fire and the exemption still applies.
    """
    tracked, by_base, by_suffix = _tracked_indexes()
    for token in ("$RUNNER_TEMP/publication-authority.pre-mutation.json",
                  "<result>.approvals.json",
                  "populus-data/builds/20260826.1/manifest.json",
                  "CLAUDE.md"):
        assert cross_run.ignored(token, tracked, by_base, by_suffix), token


# --- F29: trailing prose punctuation must not drop a path-bearing word ------
#
# The six-bucket invariant stayed GREEN while a real owned path landed in
# `dropped` -- the failure the invariant was supposed to make impossible,
# reappearing one layer up as a SEMANTIC misclassification. The first entry is
# the control that already worked; the other three were measured `dropped`.
PUNCTUATED_COMMAND_SPANS = [
    ("clean_control", 'python "scripts/inst_snapshot.py"'),
    ("quoted_comma", 'python "scripts/inst_snapshot.py",'),
    ("paren_comma", "python (scripts/inst_snapshot.py),"),
    ("bracket_semicolon", "python [scripts/inst_snapshot.py];"),
]


@pytest.mark.parametrize(("label", "span"), PUNCTUATED_COMMAND_SPANS,
                         ids=[lbl for lbl, _ in PUNCTUATED_COMMAND_SPANS])
def test_cross_run_trailing_punctuation_does_not_drop_a_path(tmp_path, label, span):
    tracked, _by_base, _by_suffix = _tracked_indexes()
    plan = tmp_path / "sec.md"
    plan.write_text(f"Run `{span}` at the cutover.\n")
    spans = _extract(plan, tracked, set())
    assert spans.routes[span] == "found", spans.routes
    assert spans.found == {"scripts/inst_snapshot.py"}, spans.found


def test_cross_run_trailing_punctuation_stripping_is_outer_only(tmp_path):
    """Peeling must never rewrite one path into a different one.

    `[year].v1.json.ts` is a real Astro route file whose name BEGINS with `[`
    and does not end with `]`; an over-eager unwrap would turn it into
    `year].v1.json.ts`. And a mark-only word must survive rather than becoming
    the empty string.
    """
    assert cross_run.strip_outer_syntax("[year].v1.json.ts") == "[year].v1.json.ts"
    assert cross_run.strip_outer_syntax("src/populus/cli.py") == "src/populus/cli.py"
    assert cross_run.strip_outer_syntax(",") == ","
    assert cross_run.strip_outer_syntax('("scripts/x.py"),') == "scripts/x.py"


def test_cross_run_classify_word_is_total():
    """Structural half of G2: EVERY word yields one of three named kinds.

    ``word_stem`` may return ``None``; ``classify_word`` may not. Deliberate
    garbage included -- the point is that there is no input for which the
    router declines to decide.
    """
    tracked = cross_run.load_tracked("origin/main")
    top_dirs = frozenset(q.split("/", 1)[0] for q in tracked)
    for word in (
        "", " ", '"', "''", "()", "[]", "{}", "<>", "--flag", "--flag=",
        "--workflow=publish.yml", '"scripts/x.py"', "(scripts/x.py)",
        "README.md", "publish.yml:publish", "application/json", "origin/main",
        "1.2.3", "${{", "}}", "POPULUS_DATA_DIR=/tmp/x", "\\u003c", "-> 6e/6e",
        "src/populus/cli.py:513-520", "cik:0001045810",
    ):
        kind, value = cross_run.classify_word(word, top_dirs)
        assert kind in cross_run.WORD_KINDS, (word, kind)
        assert isinstance(value, str), (word, value)


def test_cross_run_word_classifier_contains_no_silent_exit():
    """Mechanical pin, the same one ``classify_span`` carries.

    Every recurrence of this class entered through a ``continue`` or a bare
    ``return``. Behavioural tests can only sample; this forbids the SHAPE, in
    both the word router and the loop that consumes it.
    """
    import ast

    tree = ast.parse(CROSS_RUN.read_text(encoding="utf-8"))
    for name in ("classify_word", "repo_candidates"):
        fn = next(n for n in ast.walk(tree)
                  if isinstance(n, ast.FunctionDef) and n.name == name)
        assert not [n for n in ast.walk(fn) if isinstance(n, ast.Continue)], \
            f"{name} must not `continue` -- that is the vanish class"
        assert not [n for n in ast.walk(fn)
                    if isinstance(n, ast.Return) and n.value is None], \
            f"{name} must not `return` without a value"
        assert isinstance(fn.body[-1], ast.Return), \
            f"{name} must end in a return"


def test_cross_run_word_classifier_reuses_path_shaped():
    """One definition of "repository-shaped", still. Now checked in BOTH places.

    Both earlier F23 rounds were closed by adding a second, subtly different
    notion of what a path looks like. ``classify_word`` is where the predicate
    is now consulted, and ``repo_candidates`` re-asserts it; neither may define
    its own.
    """
    import ast

    tree = ast.parse(CROSS_RUN.read_text(encoding="utf-8"))
    for name in ("classify_word", "repo_candidates"):
        fn = next(n for n in ast.walk(tree)
                  if isinstance(n, ast.FunctionDef) and n.name == name)
        called = {n.func.id for n in ast.walk(fn)
                  if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
        assert "path_shaped" in called, (name, called)


@pytest.mark.parametrize(
    "span",
    [
        # Prose and non-paths must NOT be swept up by the wrapper stripping or
        # by the option splitting. This is the half of F23 that must not change.
        "POPULUS_DATA_DIR=/tmp/x",     # `=` split is guarded on a leading `-`
        "--name-status",
        "${{ secrets.* }}",
        "self-hosted, macOS, ARM64",
        "application/json",
        "origin/main",
        "npm ci",
        "1.2.3",
        "(build_id, code_sha)",
        "entity:cik:00010",
    ],
)
def test_cross_run_prose_survives_the_word_totality_fix(tmp_path, span):
    """Totality is not the same as resolution. Prose still lands in `dropped`."""
    sec = tmp_path / "sec.md"
    sec.write_text(f"Prose about `{span}` here.\n")
    tracked = cross_run.load_tracked("origin/main")
    spans = _extract(sec, tracked, set())
    assert spans.routes[span] == "dropped", spans.routes
    assert not spans.found and not spans.unresolved


def test_cross_run_astro_route_brackets_are_not_stripped():
    """`[year].v1.json.ts` is a real tracked file, not a bracketed wrapper.

    Wrapper stripping is restricted to MATCHED pairs, so a leading `[` with no
    trailing `]` is left exactly as written. Get this wrong and every Astro
    route file in the plans silently changes identity.
    """
    tracked = cross_run.load_tracked("origin/main")
    top_dirs = frozenset(q.split("/", 1)[0] for q in tracked)
    for word in ("[year].v1.json.ts", "[t]/holders.astro", "[key]/[part].v2.json.gz.ts"):
        assert cross_run.unwrap_word(word) == word, word
        kind, value = cross_run.classify_word(word, top_dirs)
        assert value == word, (word, kind, value)


@pytest.mark.parametrize(
    ("argv", "why"),
    [
        (["--ref", "no/such/ref/at/all"], "a ref git cannot read"),
        (["--plan", "sec=/definitely/no/such/plan.md"], "a plan file that is absent"),
    ],
)
def test_cross_run_operational_failure_is_status_two(tmp_path, argv, why):
    """0/1/2, the same as both shell gates. A broken git is not a FINDING.

    An uncaught ``CalledProcessError`` exited **1**, which is exactly the status
    "this gate found an unresolved token" uses. An operator -- or a CI step --
    reading that as a finding would go looking for a token that does not exist,
    and, worse, a green-after-fix run would be indistinguishable from a run that
    never read the baseline at all.
    """
    plan = tmp_path / "p.md"
    plan.write_text("Edits `Makefile`.\n")
    full = ["--plan", f"sec={plan}", "--plan", f"i2={plan}"] + argv
    with pytest.raises(cross_run.ScanError):
        cross_run.main(full)
    # And the process-level contract: status 2, not 1.
    r = subprocess.run(
        [sys.executable, str(CROSS_RUN), *full],
        cwd=REPO_ROOT, capture_output=True, text=True,
    )
    assert r.returncode == 2, why + "\n" + r.stdout + r.stderr
    assert "cross_run_overlap:" in r.stderr


def test_cross_run_empty_baseline_is_status_two(tmp_path):
    """An empty tracked set makes every token unresolvable -- a wall of noise.

    Reported as "could not scan" rather than as ~1,600 findings.
    """
    empty = _init_repo(tmp_path / "empty_repo")
    _git(empty, "commit", "-q", "--allow-empty", "-m", "empty")
    _git(empty, "rm", "-q", "--cached", ".gitkeep")
    _git(empty, "commit", "-q", "-m", "drop everything")
    r = subprocess.run(
        [sys.executable, str(CROSS_RUN), "--ref", "HEAD"],
        cwd=empty, capture_output=True, text=True,
    )
    assert r.returncode == 2, r.stdout + r.stderr
    assert "empty baseline" in r.stderr, r.stderr


def test_cross_run_failure_prints_a_summary_to_stderr(tmp_path):
    """Reporting shape, shared with both shell gates: findings on stdout, verdict
    on stderr."""
    sec = tmp_path / "sec.md"
    sec.write_text("Edits `src/populus/not_a_real_module_xyz.py`.\n")
    i2 = tmp_path / "i2.md"
    i2.write_text("Edits `Makefile`.\n")
    r = subprocess.run(
        [sys.executable, str(CROSS_RUN),
         "--plan", f"sec={sec}", "--plan", f"i2={i2}"],
        cwd=REPO_ROOT, capture_output=True, text=True,
    )
    assert r.returncode == 1, r.stdout + r.stderr
    assert "UNRESOLVED in sec" in r.stdout
    assert "cross_run_overlap: 1 unresolved token(s)" in r.stderr, r.stderr


def test_cross_run_ignore_entries_all_carry_a_reason():
    """IGNORE is the only category that can hide a token, so it must be legible."""
    assert all(reason.strip() for reason in cross_run.IGNORE.values())
    assert all(reason.strip() for _, reason in cross_run.IGNORE_PATTERNS)


def test_cross_run_blocked_is_the_union_not_the_sum(capsys):
    """An earlier revision printed a SUM for Slice 4; the true figure is the union.

    Live measurement: SEC=23, I2=35, BOTH=13 -> blocked 45, free 87. (An earlier
    draft of this docstring quoted 39/93; that was already superseded.) The
    assertions below are relational rather than literal so the property is
    pinned without re-pinning numbers that move with the plans.
    """
    plans = _plan_paths()
    cross_run.main(["--plan", f"sec={plans['sec']}", "--plan", f"i2={plans['i2']}"])
    out = capsys.readouterr().out
    line = next(ln for ln in out.splitlines() if ln.startswith("S4 "))
    # The report pads its numbers ("SEC= 6"), so split on whitespace-tolerant
    # `key=<spaces>value` rather than on bare tokens.
    fields = dict(re.findall(r"(\S+?)=\s*(\d+)", line))
    sec, i2 = int(fields["SEC"]), int(fields["I2"])
    both, blocked = int(fields["BOTH"]), int(fields["BLOCKED(union)"])
    assert both > 0, "fixture is meaningless unless the two sets actually overlap"
    assert blocked == sec + i2 - both
    assert blocked < sec + i2
    assert int(fields["FREE"]) == int(fields["surface"]) - blocked


def test_cross_run_slice_surface_corrections():
    """S1 owns the Makefile; S2 is documentation-only with a verify-only list."""
    tracked = cross_run.load_tracked("origin/main")
    surface, verify_only = cross_run.surfaces(tracked)
    assert "Makefile" in surface["S1 docs"]
    assert surface["S2 CI"] == {"README.md"}
    assert verify_only["S2 CI"] == {
        ".github/workflows/checks.yml",
        "tests/test_workflow_governance.py",
    }
    assert not (surface["S2 CI"] & verify_only["S2 CI"])


# --------------------------------------------------------------------------
# F34, SECOND ROUND -- an unparseable authority, and loopback by MEANING
#
# The previous round's tests checked the `uri_disposition()` boundary only.
# That is exactly why both halves below survived it: the helper's answer was
# asserted, and what the BUCKET did with that answer was not. So every case
# here is asserted END TO END -- the bucket a real plan document's span lands
# in, and the process exit status -- with the helper-level assertion kept only
# as corroboration.
#
# MEASURED on the pinned baseline, Python 3.12.13 and 3.9.6 alike, before the
# fix. Both halves are FAIL-OPEN: an ownership claim over a string nothing
# parsed, and an owned path leaving the gate at exit 0.
#
#   `//[bad/repo/src/populus/cli.py`          found -> src/populus/cli.py
#   `file://[bad/repo/src/populus/cli.py`     found -> src/populus/cli.py
#   `file://[0:0:0:0:0:0:0:1]/<co>/src/populus/cli.py`   dropped
#   `file://127.0.0.53/<co>/src/populus/cli.py`          dropped
# --------------------------------------------------------------------------

# (span, bucket, value-in-that-bucket, exit-status). `value` is None where the
# bucket is not `found` and the recorded value is the span itself.
UNDECIDABLE_AUTHORITIES = [
    # THE two headline false claims. The prefix `//[bad/repo/` ends in the
    # segment `repo`, which `is_checkout_root` recognises -- so with the parse
    # failure swallowed, the tool asserted ownership of a tracked file.
    ("protocol_relative", "//[bad/repo/src/populus/cli.py"),
    ("file_scheme", "file://[bad/repo/src/populus/cli.py"),
    # The same shape without the checkout-root segment. This one already
    # reached `unresolved` before the fix, but through the `weak` channel --
    # i.e. for the wrong reason, having first parsed a prefix out of an
    # unparsed string. Kept so the DISPOSITION assertion below has a case where
    # the bucket alone could not tell the two revisions apart.
    ("unclosed_bracket", "//[unclosed/src/populus/cli.py"),
    ("unclosed_bracket_file", "file://[unclosed/src/populus/cli.py"),
    # An unmatched CLOSING bracket is the same refusal from `urlsplit`.
    ("stray_close_bracket", "//]weird/repo/src/populus/cli.py"),
    # A bracketed host that is not an IP address at all. On 3.12 `urlsplit`
    # rejects it; the tool must not care WHICH ValueError it was.
    ("bracketed_non_ip", "file://[not-an-address]/repo/src/populus/cli.py"),
    # Undecidable does NOT require that the token look like a repository path.
    # An authority the tool could not read is undecidable whatever follows it.
    ("no_repo_path", "//[bad/there/is/nothing/here"),
]


@pytest.mark.parametrize(
    ("label", "span"), UNDECIDABLE_AUTHORITIES,
    ids=[row[0] for row in UNDECIDABLE_AUTHORITIES],
)
def test_cross_run_unparseable_authority_is_undecidable_not_found(
    tmp_path, label, span, capsys
):
    """G3, END TO END: a URI the tool cannot parse fails the gate.

    Asserted at three levels because the previous round asserted only the
    first: the disposition, the bucket a real plan's span lands in, and the
    PROCESS EXIT STATUS. A token that is authority-shaped and unparseable is
    undecidable -- the tool cannot tell what it names -- so it may reach
    neither `found` nor any non-failing bucket.
    """
    tracked, by_base, by_suffix = _tracked_indexes()
    assert cross_run.uri_disposition(span) == (cross_run.URI_UNDECIDABLE, span)
    assert cross_run.resolve_or_ambiguous(
        span, tracked, by_base, by_suffix) == (None, False, False, True)

    sec = tmp_path / "sec.md"
    sec.write_text(f"The run edits `{span}` in this slice.\n")
    i2 = tmp_path / "i2.md"
    i2.write_text("Edits `pyproject.toml`.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 1, out
    assert "UNRESOLVED in sec" in out and span in out, out

    spans = _extract(sec, tracked, set())
    assert spans.routes[span] == "unresolved", spans.routes
    # The load-bearing half: NOTHING was attributed. An assertion on the bucket
    # alone would still pass if the span were also recorded as found.
    assert not spans.found, spans.found


@pytest.mark.parametrize(
    "span",
    [
        "python //[bad/repo/src/populus/cli.py",
        "ruff check //[bad/repo/src/populus/cli.py --fix",
        "python //[bad/there/is/nothing",
    ],
)
def test_cross_run_undecidable_authority_after_the_first_word(tmp_path, span):
    """A COMMAND-FORM span carrying an unparseable authority, F23's shape.

    Found by mutation, not by inspection. Making `classify_word` return
    `nonpath` for an undecidable word leaves every single-word case correct --
    the pre-catch-all rung in `classify_span` still refuses it -- while THIS
    shape silently becomes `dropped` at exit 0, because that rung is guarded by
    `len(t.split()) == 1`. Measured, both spellings, on the pinned baseline:

        `python //[bad/repo/src/populus/cli.py`   unresolved -> dropped

    So the word-level route and the span-level rung each cover what the other
    misses, and only a multi-word fixture pins the word-level one.
    """
    tracked, _by_base, _by_suffix = _tracked_indexes()
    plan = tmp_path / (re.sub(r"\W", "_", span)[:80] + ".md")
    plan.write_text(f"The run runs `{span}` in this slice.\n")
    spans = _extract(plan, tracked, set())
    assert spans.routes[span] == "unresolved", spans.routes
    assert not spans.found, spans.found


def test_cross_run_undecidable_is_distinct_from_not_a_uri():
    """The distinction IS the fix, so it is asserted as a distinction.

    `None` means DECIDED -- not a URI reference, so the ordinary path ladder
    applies -- and is the right answer for a bare path. `URI_UNDECIDABLE` means
    "this carries an authority and I could not read it". The old code returned
    `None` for both, and a bucket-level test cannot see the difference on a
    token that happens to fail for some other reason, which is why the two
    values are compared directly here.
    """
    assert cross_run.URI_UNDECIDABLE not in (cross_run.URI_LOCAL,
                                             cross_run.URI_OFF_REPO, None)
    parseable = "src/populus/cli.py"
    unparseable = "//[bad/repo/src/populus/cli.py"
    assert cross_run.uri_disposition(parseable) == (None, parseable)
    assert cross_run.uri_disposition(unparseable)[0] == cross_run.URI_UNDECIDABLE
    # ... and the reason they must differ: the two strings share a suffix that
    # resolves, and the parseable one is SUPPOSED to resolve through it.
    tracked, by_base, by_suffix = _tracked_indexes()
    assert cross_run.resolve_or_ambiguous(
        parseable, tracked, by_base, by_suffix)[0] == "src/populus/cli.py"
    assert cross_run.resolve_or_ambiguous(
        unparseable, tracked, by_base, by_suffix)[0] is None


def test_cross_run_undecidable_authority_vetoes_the_ignore_table(tmp_path):
    """G4: a hiding category may not claim what the tool could not parse.

    Measured before the fix: `//[bad/opt/unrelated/thing.py` was bucket
    `ignored` at exit 0 -- the `^/`-adjacent patterns reach it once the leading
    `//[bad` is normalised away. G4 already says a merely UNDECIDED token may
    not be hidden; undecidable is the newest kind of undecided and inherits it.
    """
    tracked, by_base, by_suffix = _tracked_indexes()
    for span in ("//[bad/opt/unrelated/thing.py",
                 "//[bad/populus-data/builds/1/manifest.json",
                 "//[bad/there/is/nothing"):
        assert not cross_run.ignored(span, tracked, by_base, by_suffix), span
        plan = tmp_path / (re.sub(r"\W", "_", span)[:80] + ".md")
        plan.write_text(f"Reads `{span}` at runtime.\n")
        assert _extract(plan, tracked, set()).routes[span] == "unresolved", span


# --- Half 2: loopback is a MEANING, not three literal strings ---------------
#
# `dropped` is exit 0, so failing to recognise a spelling of localhost is the
# ESCAPE half of F34 reopened: an owned checkout path hides behind a
# non-canonical spelling. Each `found` row below was measured `dropped`.
LOOPBACK_SPELLINGS = [
    ("ipv6_expanded", f"file://[0:0:0:0:0:0:0:1]{_CHECKOUT}/src/populus/cli.py",
     True, "the loopback address written out in full"),
    ("ipv6_compressed", f"file://[::1]{_CHECKOUT}/src/populus/cli.py",
     True, "already worked -- the control for the row above"),
    ("ipv6_mixed_case", f"file://[0:0:0:0:0:0:0:0001]{_CHECKOUT}/src/populus/cli.py",
     True, "a leading-zero spelling of the same address"),
    ("ipv4_loopback", f"file://127.0.0.1{_CHECKOUT}/src/populus/cli.py",
     True, "already worked -- the control for the row below"),
    ("ipv4_127_0_0_53", f"file://127.0.0.53{_CHECKOUT}/src/populus/cli.py",
     True, "all of 127/8 is loopback, not just .1"),
    ("ipv4_127_255_255_254",
     f"file://127.255.255.254{_CHECKOUT}/src/populus/cli.py",
     True, "the far end of 127/8"),
    ("ipv4_mapped", f"file://[::ffff:127.0.0.1]{_CHECKOUT}/src/populus/cli.py",
     True, "an IPv4-mapped loopback, unwrapped to its embedded address"),
    ("localhost", f"file://localhost{_CHECKOUT}/src/populus/cli.py",
     True, "the enumerated name"),
    ("localhost_root_anchored", f"file://localhost.{_CHECKOUT}/src/populus/cli.py",
     True, "a trailing dot is DNS root-anchoring, so it is the SAME name"),
    # --- the deliberate refusals, and the genuine remotes ---
    ("localhost_localdomain",
     f"file://localhost.localdomain{_CHECKOUT}/src/populus/cli.py",
     False, "a DIFFERENT DNS name; reserved by no RFC, mapped by convention "
            "only, so accepting it would guess at a resolver to license an "
            "ownership claim"),
    ("localhost_subdomain", f"file://a.localhost{_CHECKOUT}/src/populus/cli.py",
     False, "same reason: this tool decides ownership, not name resolution"),
    ("not_quite_127", f"file://128.0.0.1{_CHECKOUT}/src/populus/cli.py",
     False, "outside 127/8 -- the negative control for the whole IP rule"),
    ("unspecified_v4", f"file://0.0.0.0{_CHECKOUT}/src/populus/cli.py",
     False, "the unspecified address is not the loopback address"),
    ("unspecified_v6", f"file://[::]{_CHECKOUT}/src/populus/cli.py",
     False, "likewise in v6"),
    ("genuine_remote_host", f"https://vendor.example{_CHECKOUT}/src/populus/cli.py",
     False, "a real remote host, the headline N8 case"),
    ("localhost_as_userinfo",
     f"https://localhost@vendor.example{_CHECKOUT}/src/populus/cli.py",
     False, "the host is vendor.example; userinfo may not make it local"),
]


@pytest.mark.parametrize(
    ("label", "span", "is_local", "why"), LOOPBACK_SPELLINGS,
    ids=[row[0] for row in LOOPBACK_SPELLINGS],
)
def test_cross_run_loopback_is_canonicalized_not_string_matched(
    tmp_path, label, span, is_local, why, capsys
):
    """END TO END, both directions, one parametrisation.

    A local authority means the reference is a filesystem path and goes down
    the ordinary ladder, so an owned checkout path reaches `found` (exit 0,
    counted as ownership). A remote one is a decided non-repository reference
    and stays `dropped` (exit 0, counted, never owned). Asserting the BUCKET
    rather than only `is_local_authority` is the point: the helper-level test
    is what the expanded IPv6 form already passed through.
    """
    expected = "src/populus/cli.py"
    tracked, by_base, by_suffix = _tracked_indexes()
    assert expected in tracked, "fixture is meaningless unless the path is tracked"

    sec = tmp_path / "sec.md"
    sec.write_text(f"The run edits `{span}` in this slice.\n")
    i2 = tmp_path / "i2.md"
    i2.write_text("Edits `pyproject.toml`.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 0, (why, out)

    spans = _extract(sec, tracked, set())
    if is_local:
        assert spans.routes[span] == "found", (why, spans.routes)
        assert spans.found == {expected}, (why, spans.found)
        assert cross_run.uri_disposition(span)[0] == cross_run.URI_LOCAL, why
    else:
        assert spans.routes[span] == "dropped", (why, spans.routes)
        assert not spans.found, (why, spans.found)
        assert cross_run.uri_disposition(span) == (cross_run.URI_OFF_REPO, span), why


def test_cross_run_local_authority_set_carries_no_ip_literals():
    """The mechanism, not just its outputs: no IP may be matched as a STRING.

    The defect was textual matching, so the fix is only real if the literals
    are GONE. A table lookup extended with `0:0:0:0:0:0:0:1` would pass every
    behavioural row above while leaving the next spelling -- `127.0.0.2`, an
    RFC 5952 variant -- to escape exactly as before.
    """
    import ast

    assert cross_run.LOCAL_HOSTNAMES == frozenset({"localhost"})
    src = Path(cross_run.__file__).read_text(encoding="utf-8")
    assert "LOCAL_AUTHORITIES" not in src, "the textual set is back"
    fn = next(n for n in ast.walk(ast.parse(src))
              if isinstance(n, ast.FunctionDef) and n.name == "is_local_authority")
    assert "ipaddress.ip_address" in ast.unparse(fn), "the semantic test is gone"
    # STRING CONSTANTS in the code, not text in the comments -- a comment
    # naming `127.0.0.1` is documentation and matches nothing. The docstring is
    # excluded for the same reason.
    consts = {n.value for n in ast.walk(fn)
              if isinstance(n, ast.Constant) and isinstance(n.value, str)}
    consts.discard(ast.get_docstring(fn))
    for literal in ("127.0.0.1", "::1", "0:0:0:0", "0:0:0:0:0:0:0:1"):
        assert not any(literal in c for c in consts), (
            literal, sorted(consts), "matched as a string again")
    # ... and the module-level set carries no address either.
    assert not any(any(ch.isdigit() or ch == ":" for ch in h)
                   for h in cross_run.LOCAL_HOSTNAMES), cross_run.LOCAL_HOSTNAMES


def test_cross_run_loopback_agrees_across_python_versions():
    """`.is_loopback` is not stable across the interpreters on this machine.

    `ipaddress.ip_address('::ffff:127.0.0.1').is_loopback` is False on 3.9.6
    and True on 3.12.13 -- both installed here, and the operator's own verify
    command runs the tool under the bare `python3`. A gate verdict may not
    depend on which interpreter was typed, so the IPv4-mapped form is unwrapped
    to its embedded address before the question is asked. This test pins the
    UNWRAPPING, which is what makes the two versions agree.
    """
    import ast

    assert cross_run.is_local_authority("::ffff:127.0.0.1")
    assert cross_run.is_local_authority("::ffff:127.0.0.53")
    assert not cross_run.is_local_authority("::ffff:128.0.0.1")
    # The unwrapping must not be a blanket "any v4-mapped address is local".
    assert not cross_run.is_local_authority("::ffff:8.8.8.8")
    # ... and the STRUCTURAL half, which is the only half that can bite here.
    # MEASURED as a surviving mutant: on 3.12 `IPv6Address.is_loopback`
    # unwraps `ipv4_mapped` internally, so deleting the unwrapping below is an
    # EQUIVALENT mutant under this suite's interpreter -- no input separates
    # the two, and every behavioural row above still passes. It stops being
    # equivalent the moment the tool is run under 3.9.6, which is what the
    # operator's own bare `python3` is on this machine. A property that only
    # a second interpreter can falsify has to be pinned structurally or not at
    # all, so the unwrapping itself is asserted present.
    src = Path(cross_run.__file__).read_text(encoding="utf-8")
    fn = next(n for n in ast.walk(ast.parse(src))
              if isinstance(n, ast.FunctionDef) and n.name == "is_local_authority")
    body = ast.unparse(fn)
    assert "ipv4_mapped" in body, (
        "the IPv4-mapped unwrapping is gone -- `is_local_authority` now answers "
        "differently on 3.9.6 and 3.12.13, and the gate verdict depends on "
        "which interpreter the operator typed")


def test_cross_run_is_local_authority_rejects_the_empty_host():
    """No authority is not a LOCAL authority.

    `is_local_authority("")` returning True would make every scheme-less token
    a `file:`-equivalent local reference. The caller guards on `parts.netloc`
    first, so this is defence in depth -- and a surviving mutant without it.
    """
    assert not cross_run.is_local_authority("")


def test_cross_run_f34_round_two_forms_do_not_move_a_live_span(tmp_path):
    """The published slice counts must not move, and that is MEASURED here.

    Exactly one backticked span in either real plan reaches the URI
    discriminator at all -- `https://www.sec.gov/files/company_tickers.json`,
    which parses, whose host is neither an IP nor `localhost`, and which stays
    `off_repo` / `dropped`. So neither half of this fix can touch a live span,
    and the six-bucket totals are unchanged.
    """
    plans = _plan_paths()          # skips itself when the plans are absent
    tracked, _by_base, _by_suffix = _tracked_indexes()
    reached = {}
    for key, path in plans.items():
        for line in Path(path).read_text(encoding="utf-8").splitlines():
            for span in cross_run.BACKTICK_RE.findall(line):
                for probe in (span.strip(), *span.split()):
                    disposition, _ = cross_run.uri_disposition(probe)
                    if disposition is not None:
                        reached[span] = disposition
        spans = _extract(path, tracked, set(cross_run.NEW[key]))
        assert not spans.unresolved, (key, sorted(spans.unresolved))
    assert reached == {
        "https://www.sec.gov/files/company_tickers.json": cross_run.URI_OFF_REPO
    }, reached


# --------------------------------------------------------------------------
# F34, THIRD ROUND -- a LOCAL authority WITHOUT a `file:` scheme
#
# The same defect class as the second round, and for the same reason: the
# previous round pinned the HELPER's answer for this shape and never asked what
# the BUCKET did with it. The entry it pinned was
# `//localhost/src/populus/cli.py`, whose prefix `/` is not a recognized
# checkout root -- so that ONE token reached `unresolved` anyway, the `None`
# looked harmless, and the list it sat in was titled "leaves non-URI tokens
# alone". Change one segment and the fail-open is visible.
#
# MEASURED on the pinned baseline, Python 3.9.6 AND 3.12.13, before the fix.
# All three are FALSE OWNERSHIP CLAIMS at exit 0:
#
#   `//localhost/repo/src/populus/cli.py`       found -> src/populus/cli.py
#   `http://localhost/repo/src/populus/cli.py`  found -> src/populus/cli.py
#   `//127.0.0.53/Populus/src/populus/cli.py`   found -> src/populus/cli.py
#
# Cause: `uri_disposition` had three outcomes for an authority-bearing token
# and a fourth, `None`, that means "not a URI reference, use the ordinary path
# ladder". A local authority under a non-`file:` scheme fell into `None`, the
# token continued down the ladder, and its `repo` / `Populus` segment was read
# as a checkout root. The code's own comment already called such a reference
# UNDECIDED while the code returned the DECIDED answer; that mismatch was the
# bug.
#
# `http://localhost/...` is an HTTP resource served by a local daemon, not a
# filesystem path. The tool cannot tell what it names, and "cannot tell" fails
# CLOSED -- `URI_UNDECIDABLE`, which terminates in `unresolved` before the
# basename and suffix rungs and vetoes `ignored()`.
#
# The four dispositions now partition every authority-bearing URI reference:
#
#   remote authority                 -> URI_OFF_REPO     -> dropped    (exit 0)
#   local authority, `file:`         -> URI_LOCAL        -> the ladder
#   local authority, NOT `file:`     -> URI_UNDECIDABLE  -> unresolved (exit 1)
#   authority did not parse          -> URI_UNDECIDABLE  -> unresolved (exit 1)
#
# and `None` is reserved for tokens with NO authority, which is what the
# non-URI list above now asserts of every one of its entries.
# --------------------------------------------------------------------------

LOCAL_NON_FILE_AUTHORITIES = [
    # THE three measured false claims. Each names a segment `is_checkout_root`
    # recognises -- `repo`, `Populus` -- which is what licensed the attribution.
    ("protocol_relative_localhost", "//localhost/repo/src/populus/cli.py"),
    ("http_localhost", "http://localhost/repo/src/populus/cli.py"),
    ("protocol_relative_127_0_0_53", "//127.0.0.53/Populus/src/populus/cli.py"),
    # A CANONICALIZED-LOOPBACK variant: the second round taught the tool to
    # recognise every spelling of loopback, so every one of those spellings can
    # now reach this arm. A fix keyed on the literal `localhost` would leave
    # these three attributing tracked files exactly as before.
    ("http_ipv6_expanded", "http://[0:0:0:0:0:0:0:1]/repo/src/populus/cli.py"),
    ("http_ipv4_mapped", "http://[::ffff:127.0.0.1]/repo/src/populus/cli.py"),
    ("https_ipv6_compressed", "https://[::1]/repo/src/populus/cli.py"),
    ("http_localhost_root_anchored",
     "http://localhost./repo/src/populus/cli.py"),
    # The token the OLD helper-only regression used. It reached `unresolved`
    # before the fix too -- through the `weak` channel, for the wrong reason,
    # having first parsed a prefix out of a reference it had already called
    # undecided. Kept so the DISPOSITION assertion has a case the bucket alone
    # cannot tell the two revisions apart on.
    ("unrecognized_prefix", "//localhost/src/populus/cli.py"),
    # Undecidable does NOT require that the token look like a repository path,
    # and this one MOVED: `dropped` (exit 0) before the fix, `unresolved` after.
    # That is the intended direction. `//localhost/x` carries an authority --
    # it is a protocol-relative URI reference, not a bare path -- and the tool
    # cannot tell what an authority-bearing non-`file:` reference names, so it
    # may not be counted as a decided non-repository reference either.
    ("no_repo_path", "//localhost/x"),
    ("no_repo_path_http", "http://localhost/x"),
    # A `file:` layer wrapping a local NON-`file:` reference. This reaches the
    # branch on the SECOND pass of the fixpoint loop, after one peel, which is
    # the only way `cur` and `token` can differ there. Found by mutation:
    # returning `cur` instead of `token` survived every row above, and would
    # report `http://localhost/repo/src/populus/cli.py` -- a string the plan
    # never wrote -- for the operator to classify. Both `URI_OFF_REPO` and the
    # unparseable arm report the ORIGINAL token, and this arm must agree; the
    # span a plan is asked about has to be the span the plan contains.
    ("file_wrapping_http_localhost",
     "file:http://localhost/repo/src/populus/cli.py"),
    ("file_wrapping_encoded_http_localhost",
     "file:%68ttp://localhost/repo/src/populus/cli.py"),
]


@pytest.mark.parametrize(
    ("label", "span"), LOCAL_NON_FILE_AUTHORITIES,
    ids=[row[0] for row in LOCAL_NON_FILE_AUTHORITIES],
)
def test_cross_run_local_authority_without_file_scheme_is_undecidable(
    tmp_path, label, span, capsys
):
    """G3, END TO END: a served-from-localhost reference fails the gate.

    Asserted at four levels, because a helper-only assertion is exactly what
    let this survive: the disposition, the ladder's `undecidable` flag, the
    BUCKET a real plan document's span lands in, and the PROCESS EXIT STATUS.
    """
    tracked, by_base, by_suffix = _tracked_indexes()
    assert cross_run.uri_disposition(span) == (cross_run.URI_UNDECIDABLE, span)
    assert cross_run.resolve_or_ambiguous(
        span, tracked, by_base, by_suffix) == (None, False, False, True)

    sec = tmp_path / "sec.md"
    sec.write_text(f"The run edits `{span}` in this slice.\n")
    i2 = tmp_path / "i2.md"
    i2.write_text("Edits `pyproject.toml`.\n")
    rc = cross_run.main(["--plan", f"sec={sec}", "--plan", f"i2={i2}"])
    out = capsys.readouterr().out
    assert rc == 1, out
    assert "UNRESOLVED in sec" in out and span in out, out

    spans = _extract(sec, tracked, set())
    assert spans.routes[span] == "unresolved", spans.routes
    # The load-bearing half: NOTHING was attributed. A bucket assertion alone
    # would still pass if the span were ALSO recorded as found.
    assert not spans.found, spans.found
    # ... and the token is reported as ITSELF, not as the path it was being
    # misread as, so the operator classifies what the plan actually wrote.
    assert span in spans.unresolved, spans.unresolved


def test_cross_run_local_non_file_authority_never_claims_ownership():
    """G4 + the headline claim: the three measured forms owned a tracked file.

    Stated as one assertion over the exact strings that were measured, so the
    regression reads as the defect did. `src/populus/cli.py` must be tracked
    for the fixture to mean anything -- an untracked fixture path would make
    every row pass vacuously.
    """
    owned = "src/populus/cli.py"
    tracked, by_base, by_suffix = _tracked_indexes()
    assert owned in tracked, "fixture is meaningless unless the path is tracked"
    for span in ("//localhost/repo/src/populus/cli.py",
                 "http://localhost/repo/src/populus/cli.py",
                 "//127.0.0.53/Populus/src/populus/cli.py"):
        hit, ambiguous, weak, undecidable = cross_run.resolve_or_ambiguous(
            span, tracked, by_base, by_suffix)
        assert hit is None, (span, hit, "attributed a tracked file again")
        assert undecidable and not (ambiguous or weak), (span, ambiguous, weak)
        # G4: undecided may not be HIDDEN either. `//localhost/repo/...` is not
        # in the IGNORE table today, but the veto is the property, not the
        # table's current contents.
        assert not cross_run.ignored(span, tracked, by_base, by_suffix), span


@pytest.mark.parametrize(
    ("label", "span", "want"),
    [
        # --- LOCAL `file:` keeps its behaviour: normalise, decode, resolve ---
        ("file_localhost", f"file://localhost{_CHECKOUT}/src/populus/cli.py",
         "found"),
        ("file_empty_authority", f"file://{_CHECKOUT}/src/populus/cli.py",
         "found"),
        ("file_127_0_0_53", f"file://127.0.0.53{_CHECKOUT}/src/populus/cli.py",
         "found"),
        ("file_ipv4_mapped",
         f"file://[::ffff:127.0.0.1]{_CHECKOUT}/src/populus/cli.py", "found"),
        # --- a REMOTE authority keeps its behaviour: dropped, exit 0 ---
        ("protocol_relative_vendor", "//vendor.example/src/populus/cli.py",
         "dropped"),
        ("protocol_relative_vendor_root",
         "//vendor.example/repo/src/populus/cli.py", "dropped"),
        ("https_vendor", "https://vendor.example/repo/src/populus/cli.py",
         "dropped"),
        ("protocol_relative_repo", "//repo/src/populus/cli.py", "dropped"),
        ("file_localhost_localdomain",
         f"file://localhost.localdomain{_CHECKOUT}/src/populus/cli.py",
         "dropped"),
        # The peeled counterpart of `file_wrapping_http_localhost` above: one
        # `file:` layer over a REMOTE authority still reaches `off_repo`, so the
        # new arm did not steal the fixpoint loop's second pass.
        ("file_wrapping_http_vendor",
         "file:http://vendor.example/repo/src/populus/cli.py", "dropped"),
        # ... and one `file:` layer over a LOCAL `file:` still resolves.
        ("file_wrapping_file_localhost",
         f"file:file://localhost{_CHECKOUT}/src/populus/cli.py", "found"),
        # --- genuinely authority-LESS tokens keep the ordinary path ladder ---
        ("bare_path", "src/populus/cli.py", "found"),
        ("root_under_checkout_root", "/repo/Makefile", "found"),
        ("bare_basename", "NOTICE", "found"),
        ("extensionless", "dashboard/public/_headers", "found"),
        ("workflow_job", "publish.yml:publish", "found"),
        ("line_suffix", "src/populus/cli.py:513-520", "found"),
        ("mailto", "mailto:someone@vendor.example", "dropped"),
        ("etc_passwd", "/etc/passwd", "dropped"),
        ("usr_local_bin", "/usr/local/bin/thing", "dropped"),
        ("file_no_path", "file:", "dropped"),
        # --- and the two unresolved controls, unchanged ---
        ("file_off_tree", "file:///opt/unrelated/src/populus/cli.py",
         "unresolved"),
        ("unparseable", "//[bad/repo/src/populus/cli.py", "unresolved"),
        ("unparseable_unclosed", "//[unclosed/src/populus/cli.py",
         "unresolved"),
    ],
)
def test_cross_run_local_non_file_fix_moves_only_its_own_boundary(
    tmp_path, label, span, want
):
    """The BOUNDARY, as one table: only local-authority-non-`file:` moved.

    A fail-closed change is only safe if it is narrow, and "narrow" is a claim
    about the OTHER dispositions, so they are asserted here rather than argued.
    Every row below is byte-identical before and after the fix; the rows that
    moved live in `LOCAL_NON_FILE_AUTHORITIES` above and nowhere else.
    """
    tracked, _by_base, _by_suffix = _tracked_indexes()
    plan = tmp_path / (re.sub(r"\W", "_", label)[:80] + ".md")
    plan.write_text(f"The run edits `{span}` in this slice.\n")
    spans = _extract(plan, tracked, set())
    assert spans.routes[span] == want, (span, spans.routes)
    if want != "found":
        assert not spans.found, (span, spans.found)


def test_cross_run_none_disposition_means_no_authority():
    """The MECHANISM, not just the outputs: `None` is now authority-free.

    The defect was a fourth outcome quietly absorbing an authority-bearing
    shape, so the fix is only real if `None` can no longer be reached with a
    netloc in hand. Brute-forced over the cross product of the schemes and
    authorities this tool distinguishes, which is the space the four
    dispositions partition.
    """
    hosts = ["localhost", "localhost.", "127.0.0.1", "127.0.0.53", "[::1]",
             "[0:0:0:0:0:0:0:1]", "[::ffff:127.0.0.1]", "vendor.example",
             "localhost.localdomain", "a.localhost", "128.0.0.1", "0.0.0.0"]
    schemes = ["", "http", "https", "file", "ftp", "ws"]
    for scheme in schemes:
        for host in hosts:
            for tail in ("/repo/src/populus/cli.py", "/x", "/"):
                probe = f"{scheme}:" if scheme else ""
                probe += f"//{host}{tail}"
                disposition, _ = cross_run.uri_disposition(probe)
                assert disposition is not None, (
                    probe, "an authority-bearing token reached the `None` arm "
                           "-- the F34 third-round fail-open is back")


def test_cross_run_f34_round_three_form_does_not_move_a_live_span():
    """The published slice counts must not move, and that is MEASURED here.

    Instrumented against both real plans before the fix: ZERO backticked spans,
    and zero WORDS of any multi-word span, reach the changed branch -- the only
    span that reaches the discriminator at all is
    `https://www.sec.gov/files/company_tickers.json`, whose authority is
    remote. So the six-bucket totals and every published slice count are
    unchanged, as a measurement rather than an expectation.

    Re-derived here instead of trusting the round-two test, because the
    branch this asks about is a different one: round two asked which spans
    reached `uri_disposition`, this asks which reached the LOCAL-authority arm.
    """
    plans = _plan_paths()          # skips itself when the plans are absent
    reached = []
    for path in plans.values():
        for line in Path(path).read_text(encoding="utf-8").splitlines():
            for span in cross_run.BACKTICK_RE.findall(line):
                for probe in (span.strip(), *span.split()):
                    core = cross_run.strip_outer_syntax(
                        cross_run.split_option_assignment(
                            cross_run.strip_outer_syntax(probe)))
                    for candidate in (probe, core):
                        try:
                            parts = urllib.parse.urlsplit(candidate)
                            host = parts.hostname or ""
                        except ValueError:
                            continue
                        if (parts.netloc
                                and cross_run.is_local_authority(host)
                                and parts.scheme != "file"):
                            reached.append(span)
    assert reached == [], reached
