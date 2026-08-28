#!/usr/bin/env python3
"""Cross-run file-ownership overlap for the repository-professionalization program.

Reads the in-flight runs' plan documents, extracts every repository path they
name, and intersects those owned sets with this program's per-slice edit
surfaces. The output tells the operator which slices are safe to start now and
which are blocked behind another run.

Exit status is the gate: 0 when every token in every plan is classified, 1 when
any token is not. A token is classified when it is one of

  * a path tracked on the baseline ref (exactly, by unique suffix, by unique
    basename, or -- through a RECOGNIZED CHECKOUT ROOT -- by the longest unique
    segment-boundary suffix of the token, so
    ``<HOME>/projects/Populus/src/populus/cli.py`` is attributed to
    ``src/populus/cli.py`` and ``/repo/Makefile`` to ``Makefile``; resolution is
    EXTENSION-BLIND, so ``NOTICE`` and ``dashboard/public/_headers`` resolve like
    any other tracked path),
  * a tracked DIRECTORY the plan names as a scope rather than an edit surface
    (``ops/runner/``); classified, but never expanded into its files,
  * a file the run declares it will CREATE (per-run ``NEW``),
  * a path-less prose family the reviewer mapped by hand (``PROSE``),
  * a non-repository artifact with a written reason (``IGNORE``).

Candidates come from EVERY backticked span, not from a fixed extension list.
A candidate that resolves to nothing is REPORTED: as an ``UNRESOLVED`` failure
when it is path-shaped, and otherwise as a counted ``note:`` line that
``--show-dropped`` expands in full.

NO SPAN MAY VANISH. Every backticked span is routed to exactly one of six
buckets -- found, unresolved, dropped, declared_new, ignored, directory -- and
the routing function is total, so there is no exit without a record. See the
NO-VANISH CONTRACT block above ``classify_span``.

``IGNORE`` is the category added to close the ~19 security / ~63 I-2 unresolved
tokens: published site JSON, ``populus-data/**`` (a separate private checkout),
agent ``feedback_*.md`` memory names, and runtime/site artifacts. Each entry
carries its reason so a future reader can tell a deliberate exemption from a
token someone silently dropped to make the gate green.

The plan documents are UNTRACKED, owner-owned working files. They therefore do
not exist in a fresh worktree cut from the baseline ref; pass ``--plan
key=PATH`` to point the tool at wherever they live.

--- CONTRACT -----------------------------------------------------------------

EXIT STATUS -- three outcomes, never two. The same 0/1/2 split the two shell
gates use, so an operator reads all three tools the same way:

  0  every backticked span in every plan was classified, and none was an
     unresolved repository path.
  1  the scan completed and at least one span is UNRESOLVED. Reported by name,
     with a stderr summary line.
  2  COULD NOT SCAN -- a bad argument, an unreadable plan, a failing ``git
     ls-tree``, or a baseline ref that yields no files. Nothing is certified.
     ``2`` exists because an uncaught ``CalledProcessError`` used to exit 1,
     which is indistinguishable from "the gate failed" -- a broken ``git`` read
     as a finding.

WHAT THIS GUARANTEES
  G1  NO SPAN MAY VANISH. Every backticked span routes to exactly one of six
      buckets. ``classify_span`` is total by construction: no ``continue``, no
      bare ``return``, and a terminal catch-all.
      Pinned by: test_cross_run_every_span_is_routed_to_exactly_one_bucket,
                 test_cross_run_classify_span_is_total,
                 test_cross_run_classifier_contains_no_silent_exit.
  G2  NO WORD MAY VANISH. Within a multi-word span, every WORD routes to
      exactly one of ``nonpath`` / ``candidate`` / ``uncertain``.
      ``classify_word`` is total by the same construction.
      Pinned by: test_cross_run_classify_word_is_total,
                 test_cross_run_word_classifier_contains_no_silent_exit,
                 test_cross_run_quoted_and_bracketed_paths_are_classified.
  G3  Uncertainty fails CLOSED. A word that bears a repository path but cannot
      be normalised, a span naming two or more repository paths, a token whose
      only evidence is a repository-relative suffix under a prefix that CANNOT
      be shown to be a checkout root, a URI reference whose AUTHORITY the tool
      could not PARSE, and a URI reference whose authority IS this machine but
      whose scheme is not ``file:`` (so it names a served resource, not a path
      on disk), all route to ``unresolved`` -- exit 1 -- rather than being
      silently attributed.
      Pinned by: test_cross_run_two_repo_shaped_words_are_ambiguous_not_silently_picked,
                 test_cross_run_repo_path_after_the_first_word_is_a_gate_failure,
                 test_cross_run_unrecognized_prefix_is_unresolved_not_found,
                 test_cross_run_unparseable_authority_is_undecidable_not_found,
                 test_cross_run_undecidable_is_distinct_from_not_a_uri,
                 test_cross_run_local_authority_without_file_scheme_is_undecidable,
                 test_cross_run_local_non_file_authority_never_claims_ownership.
  G4  Every hiding category carries a written reason, and NO hiding category may
      claim a span that can be normalised onto a tracked baseline path, NOR one
      that is merely UNDECIDED. IGNORE is applied only after wrapper/root
      normalisation, tracked resolution, and SEGMENT-SUFFIX resolution through a
      recognized checkout root have all been tried; a suffix naming two or more
      tracked files, and one naming exactly one tracked file through an
      UNRECOGNIZED prefix, both route to ``unresolved`` -- never to ``ignored``
      and never to an arbitrarily chosen tracked path.
      Pinned by: test_cross_run_ignore_entries_all_carry_a_reason,
                 test_cross_run_ignore_cannot_hide_a_tracked_path,
                 test_cross_run_absolute_checkout_root_resolves_to_tracked,
                 test_cross_run_ambiguous_checkout_root_suffix_is_unresolved,
                 test_cross_run_non_repo_absolute_path_does_not_resolve,
                 test_cross_run_checkout_root_over_an_extensionless_path_resolves,
                 test_cross_run_one_segment_suffix_under_an_unrecognized_prefix,
                 test_cross_run_root_level_file_under_a_checkout_root_resolves,
                 test_cross_run_unrecognized_prefix_is_unresolved_not_found,
                 test_cross_run_remote_authority_never_resolves_to_ownership,
                 test_cross_run_local_file_uri_goes_down_the_one_ladder,
                 test_cross_run_undecidable_authority_vetoes_the_ignore_table,
                 test_cross_run_loopback_is_canonicalized_not_string_matched,
                 test_cross_run_local_non_file_authority_never_claims_ownership.

WHAT THIS DELIBERATELY DOES NOT COVER
  N1  Spans inside FENCED code blocks. ``BACKTICK_RE`` matches single-backtick
      spans only, by design -- a fenced block is a transcript, not a reference.
  N2  Paths a plan names in PROSE with no code span at all. That is what the
      hand-maintained ``PROSE`` map is for.
  N3  RESOLUTION. The contract is that nothing vanishes, never that everything
      resolves: routes, MIME types, version strings, env vars, git refs and
      shell fragments legitimately land in ``dropped`` at exit 0.
  N4  Ambiguous shorthands. A basename or suffix matching two or more tracked
      files is REFUSED rather than picked; the operator disambiguates.
  N5  Path-bearing words whose surrounding syntax is not a matched wrapper pair
      or a trailing prose mark. ``NORMALISERS`` below is the complete list of
      what is stripped before classification; anything else (a mid-word escape,
      a concatenation operator) is not normalised and lands in ``dropped``.
  N6  A path named ONLY by its basename inside a longer token whose leading
      segments are NOT a recognized checkout root. Segment-suffix resolution
      refuses to attribute on a single trailing segment in that case -- see the
      ONE-SEGMENT RULE in ``resolve_suffix_any`` -- so
      ``https://vendor.example/files/company_tickers.json`` is NOT read as the
      tracked ``tests/fixtures/inst/mcp/company_tickers.json``. That is a
      deliberate refusal, not an oversight: the alternative was measured, and it
      attributed a vendor URL and a checkout ROOT to tracked files. A basename
      standing ALONE (``NOTICE``) still resolves, as it always did, and so does
      one under a recognized root (``/repo/Makefile``). The cost is that a plan
      naming a file as ``<unrecognized-root>/<name>`` where ``<name>`` is a
      unique tracked basename lands in ``dropped``, counted, never hidden.
  N7  WHICH prefixes are checkout roots. ``is_checkout_root`` decides on the
      prefix's LAST segment: the repository name, or one of a small enumerated
      set of container/CI checkout-directory names. It is a convention, not a
      proof -- a checkout in a directory named after neither yields ``weak``
      (exit 1, a human classifies), and a tracked directory that happened to be
      named ``Populus`` or ``repo`` deep inside the tree would be honoured as a
      root. Both are accepted: the first fails CLOSED, and the second requires a
      token spelling a path under that directory that is not itself tracked.
  N8  A REMOTE AUTHORITY is ``dropped``, not ``unresolved``. A URI reference
      whose authority names another host is a decided non-repository reference,
      not an uncertainty. It is counted and listable, never silent, but it does
      not fail the gate. The test is SEMANTIC, not a scheme pattern, and it
      covers the PROTOCOL-RELATIVE form (``//host/path``), which has an
      authority and no scheme -- see the note on ``uri_disposition``. The
      converse also holds and is not an exception to this note: a LOCAL
      ``file:`` reference is not a remote reference at all, so it is decoded and
      resolved down the ordinary ladder rather than dropped. WHICH authorities
      are local is decided semantically -- every spelling of a loopback address
      via ``ipaddress``, plus the enumerated name ``localhost`` -- so the
      expanded ``0:0:0:0:0:0:0:1`` and the rest of ``127/8`` are local, and a
      merely localhost-LOOKING name such as ``localhost.localdomain`` is not.
      An authority the tool cannot PARSE is neither remote nor local: it is
      UNDECIDABLE and fails the gate, per G3. So is a LOCAL authority carried by
      a scheme other than ``file:`` -- ``http://localhost/...`` is a resource
      served by a daemon on this machine, not a path on this machine's disk, and
      nothing in the token says which file (if any) backs it. Those are the two
      URI shapes that do NOT stay in ``dropped``, and both exceptions are
      deliberate: neither a token nothing parsed nor a token whose meaning is a
      server-side route is a DECIDED non-repository reference. Between them the
      four dispositions partition every URI reference -- remote authority
      (``dropped``), local ``file:`` (resolved down the one ladder), local
      non-``file:`` and unparseable (both ``unresolved``) -- and everything with
      no authority and no ``file:`` scheme is not a URI reference this tool acts
      on at all, so it takes the ordinary path ladder.
"""

from __future__ import annotations

import argparse
import ipaddress
import re
import subprocess
import sys
import urllib.parse

EXT = r"(?:md|py|ts|astro|yml|yaml|json|toml|sh|css|lock|plist|sql)"


class ScanError(Exception):
    """The tool could not complete a scan. Maps to exit status 2, never 1.

    Exists because an uncaught ``subprocess.CalledProcessError`` from
    ``git ls-tree`` exited **1** -- the same status as "the gate found an
    unresolved token". A broken git therefore read as a finding, which is the
    fail-open shape both shell gates carry a status 2 to avoid.
    """

RUNS = {
    "sec": "docs/build/RUN-PUBLIC-SECURITY-HARDENING-plan.md",
    "i2": "docs/build/RUN-I-2-INSTITUTIONAL-TICKER-ACTIVATION-plan.md",
}

# (b) reviewed prose map: families the plan discusses without ever writing a path.
PROSE = {"sec": {"tests/test_workflow_governance.py"}, "i2": set()}

# Files each run declares it will CREATE. Legitimately absent from the baseline,
# so they resolve without being tracked. Per-run, not shared: a file only one run
# creates must not silently resolve inside the other's plan.
NEW = {
    "sec": {
        ".github/CODEOWNERS",
        ".github/dependabot.yml",
        ".gitleaks.toml",
        ".gitleaksignore",
        "SECURITY.md",
        "dashboard/public/theme-init.js",
        "dashboard/src/lib/inline-json.ts",
        "docs/runbooks/github-security.md",
        "src/populus/net/bounded_http.py",
        "src/populus/parse/xml.py",
    },
    "i2": {
        "dashboard/src/lib/inline-json.ts",
        "dashboard/src/pages/congress/data/feed/[year].v1.json.ts",
        "dashboard/src/pages/search/buckets/[key]/[part].v2.json.gz.ts",
        "dashboard/src/pages/search/index.v2.json.gz.ts",
        "docs/runbooks/inst-identity-activation.md",
        "scripts/inst_activation_approval.py",
        "scripts/inst_activation_rollback.sh",
        "scripts/inst_activation_state.py",
        "src/populus/counsel_dispositions.json",
        "src/populus/identity/activation_audit.py",
        "src/populus/identity/source_bundle.py",
        "tests/test_identity_activation_audit.py",
        "tests/test_inst_activation_approval.py",
        "tests/test_inst_activation_rollback.py",
        "tests/test_inst_activation_state.py",
        "tests/test_source_bundle.py",
    },
}

# Non-repository artifacts. Each needs a reason: the whole point of the category
# is that "unclassifiable" stays a real failure rather than becoming a dumping
# ground that makes the gate structurally incapable of failing.
IGNORE_PATTERNS = [
    (r"^feedback_[A-Za-z0-9_]+\.md$",
     "agent feedback/memory note name, not a file in this repository"),
    (r"^/",
     "published site URL path (served route), not a repository path"),
    (r"^populus-data/",
     "the private populus-data checkout, a separate repository"),
    (r"^docs/build/RUN-[A-Z0-9-]+.*\.md$",
     "another run's untracked working document, not a baseline path"),
    # Surfaced only once extraction stopped requiring a known extension
    # (defect 2): both are real slashed tokens the plans use, and both are
    # deliberately absent from the tree.
    (r"^\.claude/worktrees(/|$)",
     "harness worktree root, local-only via .git/info/exclude, never tracked"),
    (r"(^|/)node_modules/",
     "npm install artifact, gitignored by design"),
    # Surfaced only once PER-WORD classification became total (F23, third
    # round): both families are path-SHAPED -- they end in a repository file
    # extension, or their first segment is a real top-level entry -- so they now
    # reach the resolution ladder instead of falling out of the word loop
    # through a `continue`. Neither can ever be a repository path.
    (r"^\$[A-Za-z_{]",
     "a shell/CI variable-rooted runtime path ($RUNNER_TEMP/..., "
     "$INST_ACT_RUN/...); resolved at run time on the runner, never tracked"),
    (r"<[^>]*>",
     "a PLACEHOLDER-bearing template path (<build-id>, <record-sha256>, "
     "<result>); names a family of runtime artifacts, not a file on disk. "
     "Repository paths never contain angle brackets, so this cannot hide one"),
]

IGNORE = {
    ".claude/settings.local.json":
        "harness-local settings file, gitignored by design",
    "CLAUDE.md":
        "harness instruction file; the I-2 plan states none exists on the base",
    "planned-files.json":
        "per-run planning artifact, gitignored (only planned-files-m2-11.json is tracked)",
    "sqlite_schema.sql":
        "SQLite's internal schema table name, not a file on disk",
    # Published / runtime JSON produced by a build or a deploy, never committed.
    "builds/20260826.1/deployments/1.json": "populus-data build record",
    "feed.v1.json": "published site artifact",
    "signals.v1.json": "published site artifact",
    "inventory.json": "published site artifact",
    "latest.json": "populus-data registry pointer",
    "manifest.json": "published build manifest",
    "source.json": "populus-data registry artifact",
    "inst_source.json": "populus-data registry artifact",
    "identity/company_tickers.json": "populus-data registry artifact",
    "identity/company_tickers.source.json": "populus-data registry artifact",
    "registry/company_tickers/latest.json": "populus-data registry artifact",
    "registry/inst_sources/inst-source-v2.binding.json": "populus-data registry artifact",
    "publication-authority.stage.json": "runtime deploy-authority artifact",
    "publication-recovery-authority.json": "runtime deploy-authority artifact",
    "scheduled-publication-authority.json": "runtime deploy-authority artifact",
    "recovery/originating-owner-chain.json": "runtime recovery artifact",
    "recovery/publication-recovery-authority.json": "runtime recovery artifact",
    "recovery/stage-reconciliation-result.json": "runtime recovery artifact",
    "recovery/transitions/000001.json": "runtime recovery artifact",
    "site-artifact/publication-authority/scheduled.json": "published site artifact",
    # Paths the LANDED runs removed or moved out from under the plans that cite
    # them (2026-08-28: security run PRs #57-#61 and professionalization Slices
    # 0-5, PRs #62-#67, all merged). IGNORE is subordinate to resolution, so if
    # any of these paths ever returns to the tree, resolution wins again.
    ".claude/launch.json":
        "deleted by the security run's PR 2 (#58); the sec plan's citation is "
        "its own deletion instruction, now executed",
    "STATUS.md":
        "deleted by PROF Slice 1 (#63): K4 cutover into docs/roadmap.md",
    "BACKLOG.md":
        "deleted by PROF Slice 1 (#63): K4 cutover into docs/roadmap.md",
    "docs/runbooks/deploy.md":
        "moved by PROF Slice 1 (#63) to docs/operations/deploy.md",
    "docs/runbooks/rollback.md":
        "moved by PROF Slice 1 (#63) to docs/operations/rollback.md",
    "dashboard/docs/qoq-presentation.md":
        "moved by PROF Slice 1 (#63) to docs/frontend/qoq-presentation.md",
    "scripts/accept_m2_11.py":
        "moved by PROF Slice 3 (#65) to scripts/acceptance/institutional_serving.py; "
        "the make accept-m2-11 target name is unchanged (D12)",
}


# --------------------------------------------------------------------------
# IGNORE IS SUBORDINATE TO RESOLUTION (defect F28)
#
# An IGNORE pattern used to be consulted BEFORE any attempt to read the token as
# a repository path, so a pattern written to exempt a runtime artifact also
# exempted every tracked path that happened to wear the same syntax. Measured on
# the previous revision, all three at bucket ``ignored`` with the gate at exit 0,
# although ``src/populus/cli.py`` IS tracked on the pinned baseline:
#
#     `$REPO/src/populus/cli.py`        ignored  (the `^\$[A-Za-z_{]` pattern)
#     `src/populus/cli.py<placeholder>` ignored  (the `<[^>]*>` pattern)
#     `/src/populus/cli.py`             ignored  (the `^/` pattern)
#
# That is a fail-open with the same shape as every other defect in this tool: a
# real owned path lands in a NON-FAILING bucket. Worse, it is reachable on
# purpose -- wrapping a path in a variable root or a placeholder is exactly how
# a plan writes a path it is about to change.
#
# The precedence is now INVERTED. ``ignored()`` first strips the three wrappers
# the patterns are written for, then asks the ordinary resolution ladder whether
# ANY of those readings lands on a tracked file. Only a value shown incapable of
# resolving may be exempted. The patterns did not have to be narrowed and no new
# pattern was added; the ORDER is the fix, which is why it cannot be reopened by
# someone adding a fourth pattern later.
#
# NORMALISERS is the complete list -- see N5. Each entry maps a token to another
# reading of the same token; the closure of all of them is tried.
_VAR_ROOT_RE = re.compile(r"^\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)/")
_PLACEHOLDER_RE = re.compile(r"<[^>]*>")

NORMALISERS = (
    ("variable root", lambda t: _VAR_ROOT_RE.sub("", t)),      # $REPO/x -> x
    ("placeholder", lambda t: _PLACEHOLDER_RE.sub("", t)),      # x<ph>   -> x
    ("leading slash", lambda t: t.lstrip("/")),                 # /x      -> x
)


def readings(token: str) -> list[str]:
    """``token`` plus every normalised reading of it. Order-preserving, unique.

    Closed under ``NORMALISERS`` so a token wearing two wrappers at once
    (``$REPO/<build>/x``) is still read down to its bare path.
    """
    seen, out, queue = set(), [], [token]
    while queue:
        t = queue.pop(0)
        if not t or t in seen:
            continue
        seen.add(t)
        out.append(t)
        for _name, fn in NORMALISERS:
            queue.append(fn(t))
    return out


# `resolves_to_tracked()` used to live here as the IGNORE veto's predicate. It
# is gone rather than left unused: it answered "does some reading resolve
# UNIQUELY", which is exactly the question that let an AMBIGUOUS checkout-root
# path fall through to IGNORE. `resolve_or_ambiguous()` below replaces it and
# returns both facts, so there is one ladder and no second, weaker predicate for
# a later change to wire itself to by mistake.
# --------------------------------------------------------------------------
# ARBITRARY CHECKOUT ROOTS (defect F28, second round)
#
# The first round of F28 inverted the IGNORE/resolution precedence, which fixed
# the three wrappers ``NORMALISERS`` knows how to strip -- ``$REPO/src/...``,
# ``src/...<placeholder>`` and ``/src/...``. It did NOT fix the most ordinary
# spelling of all: the ABSOLUTE PATH TO A FILE IN SOMEBODY'S CHECKOUT. Measured
# on the previous revision, all five at bucket ``ignored`` with the gate at exit
# 0, although ``src/populus/cli.py`` IS tracked on the pinned baseline:
#
#   (`<HOME>` stands for the users root and `<TMP>` for the temp root. This
#    file is SCANNED by check_abs_paths.sh -- it is not one of the two files
#    K8 excludes -- so it may not contain a literal machine path, not even in a
#    comment. The real bytes live in the test fixtures.)
#
#     `<HOME>/projects/Populus/src/populus/cli.py`         ignored
#     `/repo/src/populus/cli.py`                             ignored
#     `/workspace/src/populus/cli.py`                        ignored
#     `<TMP>/Populus/README.md`                            ignored
#     `$GITHUB_WORKSPACE/Populus/src/populus/cli.py`         ignored
#
# Every one of them reached the ``^/`` or ``^\$[A-Za-z_{]`` IGNORE pattern with
# nothing to stop it, because ``NORMALISERS`` strips a wrapper it recognises and
# a checkout root is not a wrapper -- it is an ARBITRARY number of arbitrary
# leading segments. That is the same fail-open as the first round: a sibling
# plan names an owned file the way a person actually writes it, and the
# OWNERSHIP gate certifies the slice conflict-free.
#
# The rule below is not a fourth NORMALISER. A normaliser is a rewrite of the
# token; this is a SEARCH over the token's segment-boundary suffixes for the
# longest one that names something tracked. Two properties make it safe:
#
#   * SEGMENT BOUNDARIES ONLY. The candidates are ``"/".join(parts[i:])``, so
#     `.../populus/cli.py` resolves while a match starting mid-segment cannot
#     be formed at all -- there is no string search here, only a segment list.
#     A plain substring rule would let `/etc/mypopulus/cli.py` resolve.
#   * AMBIGUITY FAILS CLOSED, per G3 and N4. Hits GROW monotonically as segments
#     are dropped (every tracked file ending in `a/b/c` also ends in `b/c`), so
#     the first non-empty hit list is the MOST SPECIFIC one. If it names two or
#     more tracked files the token is refused as ``unresolved`` -- never
#     silently attributed to one of them, and never handed on to IGNORE.
#     `/tmp/Populus/README.md` is exactly this case: four tracked `README.md`.
#
# Bare tokens are untouched: with no `/` there is no proper suffix to try, so
# the whole mechanism is inert on them and basename resolution stays the only
# route, unchanged.
# --------------------------------------------------------------------------
# RECOGNIZED CHECKOUT ROOTS (defect F28, third round)
#
# The second round made the segment-suffix search assert ownership on ANY unique
# multi-segment hit, whatever came before it. That is unsound in BOTH directions,
# and both were measured directly:
#
#   FAILS OPEN -- real ownership escapes:
#     `<HOME>/projects/Populus/NOTICE`        dropped, exit 0   (NOTICE IS tracked)
#     `/repo/Makefile`                        dropped, exit 0   (Makefile IS tracked)
#     `$GITHUB_WORKSPACE/Populus/LICENSE`     dropped, exit 0   (LICENSE IS tracked)
#   because a ONE-segment suffix was refused outright, so a root-level owned file
#   named by its ordinary absolute checkout path certified the slice free.
#
#   FAILS CLOSED WRONGLY -- ownership manufactured out of nothing:
#     `https://vendor.example/src/populus/cli.py`  found -> src/populus/cli.py
#     `/opt/unrelated/src/populus/cli.py`          found -> src/populus/cli.py
#   Neither is a path into this repository. A false conflict blocks work that is
#   not blocked and makes the whole overlap table untrustworthy.
#
# The cure is that suffix evidence is TRI-STATE, not a boolean. Ownership is
# asserted only on EVIDENCE, and absence of evidence is not read as absence of
# conflict:
#
#   found       the DROPPED PREFIX is a recognized checkout root, so the token
#               demonstrably names this repository. Suffix length is irrelevant
#               once the prefix is justified -- `<root>/NOTICE` is as sound as
#               `<root>/src/populus/cli.py`.
#   weak        a unique MULTI-segment hit under a prefix that cannot be shown to
#               name this repository. The token spells a repository-relative path
#               but under a foreign root, so the tool cannot tell. Routed to
#               `unresolved` -- exit 1 -- and, per G4, no hiding category may
#               claim it either.
#   nothing     a unique ONE-segment hit under an unrecognized prefix. That is a
#               bare BASENAME guess and stays refused -- see N6 -- so it falls
#               through to IGNORE / path_shaped / dropped exactly as before.
#
# WHAT COUNTS AS A RECOGNIZED CHECKOUT ROOT is decided on the prefix's LAST
# segment only, because that is the segment that names the directory the tree was
# cloned into; everything to its left is the operator's arbitrary filing system.
# Two families, both case-SENSITIVE:
#
#   * it is the repository name itself -- the near-universal clone-directory name
#     (`<HOME>/projects/Populus/...`, `$GITHUB_WORKSPACE/Populus/...`, and the
#     GitHub-hosted runner's doubled `<work>/Populus/Populus/...`). This file is
#     SCANNED by check_abs_paths.sh, so no literal machine path may appear here,
#     not even in a comment -- the real bytes live in the test fixtures.
#   * it is a conventional checkout-directory name used by container and CI
#     images: `/repo`, `/workspace`, `/opt/checkout`.
#
# Case-sensitivity is load-bearing, not fussiness: accepting a lowercase
# `populus` would make the prefix `/x/src/populus` of
# `/x/src/populus/no_such_dir/cli.py` "a checkout root" and attribute it to
# `src/populus/cli.py`. Measured negative control: `/opt/unrelated/...` and
# `/a/b/projects/...` are both refused, and `/opt/checkout/...` is not.
REPO_NAME = "Populus"

CHECKOUT_ROOT_SEGMENTS = frozenset({"repo", "workspace", "checkout"})

# --------------------------------------------------------------------------
# URI REFERENCES ARE CLASSIFIED BY MEANING, NOT BY SYNTAX (defect F34)
#
# The previous revision guarded the ladder with a SCHEME REGEX -- anything
# matching `^[A-Za-z][A-Za-z0-9+.-]*://` was refused ownership. A pattern is not
# a discriminator: it was wrong in BOTH directions, and both were measured
# against the pinned baseline.
#
#     `file://<HOME>/projects/Populus/src/populus/cli.py`   dropped   (ESCAPE)
#         A LOCAL path inside the checkout, merely spelled as a file URL. The
#         scheme regex matched, so ownership was refused and a real owned path
#         left the gate at exit 0. `file://` is then a way to hide an owned
#         checkout path from a sibling run's overlap check.
#
#     `//repo/src/populus/cli.py`                           found     (FALSE CLAIM)
#         PROTOCOL-RELATIVE: an authority and no scheme, so the scheme regex did
#         not match. The authority is the REMOTE HOST `repo` -- but the prefix
#         `//repo/` reaches `is_checkout_root`, whose recognized set contains
#         `repo`, and the span was attributed to `src/populus/cli.py`. A remote
#         host named `repo`, `workspace`, `checkout` or `Populus` manufactures a
#         conflict that does not exist.
#
# The discriminator is now SEMANTIC and is applied BEFORE suffix resolution, in
# terms of the URI reference's own components (`urllib.parse.urlsplit`, which
# parses the protocol-relative form correctly and is the reason no string
# surgery appears here):
#
#   REMOTE AUTHORITY -> `off_repo`. Any URI reference carrying a non-empty
#       authority whose host is not local. This includes the protocol-relative
#       form, which HAS an authority and no scheme. The authority names another
#       host, so this is a DECIDED non-repository reference -- the tool can
#       tell, nothing is left for a human -- and it stays `dropped`, per N8, so
#       that every documentation link a plan cites does not become a permanent
#       unfixable gate failure. It is counted and listable, never silent.
#
#   LOCAL `file:` REFERENCE -> `local`, carrying the DECODED PATH. `file:` with
#       an empty or local authority denotes a filesystem path. It is
#       percent-decoded and handed to the SAME ladder every other path uses, so
#       `file://<HOME>/projects/Populus/src/populus/cli.py` reaches `found`
#       through the ordinary checkout-root rule and
#       `file:///opt/unrelated/src/populus/cli.py` reaches `unresolved` exactly
#       as its bare equivalent does. It is NOT special-cased into ownership:
#       there is one ladder, and the file URL is fed to it.
#
#   UNPARSEABLE AUTHORITY -> `undecidable`. A reference that carries an
#       authority marker and that `urlsplit` REFUSES to parse. See the F34
#       second-round block immediately below.
#
#   ANYTHING ELSE -> not a URI reference for this tool's purposes, and it
#       continues down the existing path unchanged. `publish.yml:publish` parses
#       as scheme `publish.yml` with no authority and is deliberately untouched;
#       so is `mailto:`, and so is `//localhost/x` -- a local authority with no
#       `file:` scheme is not a filesystem path, so it stays UNDECIDED and fails
#       closed at `unresolved` rather than being read either way.
#
# --------------------------------------------------------------------------
# F34, SECOND ROUND -- the two halves the first round left open
#
# HALF 1. AN UNPARSEABLE AUTHORITY WAS TREATED AS "NOT A URI".
#
# `urlsplit` raises `ValueError` on an authority it cannot parse. The first
# round caught that and returned `(None, token)` -- the SAME answer it gives a
# bare path -- so the token continued down the ordinary path ladder, where its
# leading segments were read as an ordinary prefix. Measured on the pinned
# baseline, Python 3.12:
#
#     `//[bad/repo/src/populus/cli.py`       found -> src/populus/cli.py  (FALSE CLAIM)
#     `file://[bad/repo/src/populus/cli.py`  found -> src/populus/cli.py  (FALSE CLAIM)
#
# Both raise `ValueError: Invalid IPv6 URL`. With the parse discarded, the
# longest tracked segment-suffix is `src/populus/cli.py`, the prefix left in
# front of it is `//[bad/repo/`, and `is_checkout_root` reads its LAST segment
# -- `repo` -- as a recognized checkout root. Ownership is asserted over a
# string nothing in the tool ever managed to parse.
#
# That is backwards. A token that is authority-SHAPED but unparseable is the
# definition of UNDECIDABLE: the tool cannot tell what it names, and G3 says
# uncertainty fails CLOSED. It is now its own disposition, applied BEFORE
# suffix resolution, routed to `unresolved` (exit 1), and -- like `weak` and
# `ambiguous` -- it VETOES every hiding category, so `//[bad/opt/unrelated/
# thing.py` can no longer be swallowed by the `^/`-adjacent IGNORE patterns
# either. Measured: that span moved `ignored` -> `unresolved`.
#
# `undecidable` is DISTINCT from `None`, and the distinction is the fix. `None`
# means "decided: this is not a URI reference, carry on down the path ladder"
# and is the right answer for `src/populus/cli.py`, `publish.yml:publish` and
# `mailto:...`. `undecidable` means "this IS a URI reference and I could not
# read it, so no later rung may pretend it read it". Collapsing the two is
# precisely how the two false claims above were produced.
#
# The trigger is the PARSE FAILURE itself, not a syntactic guess at what looks
# like an authority. In CPython's `urlsplit` every `ValueError` originates in
# the authority component -- the unmatched-bracket check on the netloc, and the
# bracketed-host validation -- so "raised" and "authority-shaped and
# unparseable" are the same event, and a bare path can never reach it. Verified
# on 3.12.13 against the whole non-URI control list below.
#
# HALF 2. LOOPBACK WAS MATCHED TEXTUALLY.
#
# The local set was the three literal strings `localhost`, `127.0.0.1`, `::1`.
# Textual matching is the same class of mistake as the scheme regex this
# discriminator replaced, and it was wrong in the fail-open direction:
#
#     `file://[0:0:0:0:0:0:0:1]/<checkout>/src/populus/cli.py`   dropped  (ESCAPE)
#     `file://127.0.0.53/<checkout>/src/populus/cli.py`          dropped  (ESCAPE)
#
# The first is the loopback address written out in full; the second is inside
# `127/8`, all of which is loopback. Both are LOCAL file references to an owned
# checkout path, and `dropped` is exit 0 -- so an owned path hides behind a
# non-canonical spelling of localhost, which is the F34 escape reopened.
#
# `is_local_authority` below canonicalizes SEMANTICALLY instead: the host is
# handed to `ipaddress.ip_address` and asked `.is_loopback`, so every spelling
# of every loopback address is covered by construction rather than by
# enumeration -- `::1`, its expanded form, all of `127/8`, and the IPv4-mapped
# `::ffff:127.0.0.1`, which is unwrapped to its embedded IPv4 address FIRST
# because `.is_loopback` disagrees with itself across the two interpreters on
# this machine (False on 3.9.6, True on 3.12.13) and a gate verdict may not
# depend on which one the operator typed. `urlsplit().hostname` strips
# the brackets from an IPv6 literal, which is exactly the form `ip_address`
# wants, and it also strips userinfo and the port, so neither can smuggle a
# remote host past the test (`git@vendor.example`, `vendor.example:8443`).
#
# WHAT IS NOT AN IP ADDRESS stays ENUMERATED, because a hostname's meaning is a
# resolver's opinion and not something this tool may infer:
#
#   * `localhost` is accepted, as before.
#   * `localhost.` is accepted. The trailing dot is DNS root-anchoring syntax,
#     not a different label -- it is the SAME NAME, and RFC 6761 names it in
#     exactly that spelling. Accepting it is canonicalization, which is the
#     whole point of this half; refusing it would leave a textual escape of the
#     kind just removed.
#   * `localhost.localdomain` is REFUSED. It is a DIFFERENT DNS name: a second
#     label under a `localdomain` TLD, reserved by no RFC, conventionally
#     mapped to 127.0.0.1 by some distributions' `/etc/hosts` and by nothing
#     else. Accepting it would be guessing at a resolver's configuration in
#     order to license an OWNERSHIP claim, which is the direction that must
#     fail closed. Subdomains of `.localhost` are refused for the same reason,
#     despite RFC 6761 -- this tool decides ownership, not name resolution.
#     Measured cost of both refusals: they stay `dropped`, exit 0, counted and
#     listable, never silent.
LOCAL_HOSTNAMES = frozenset({"localhost"})

# The three dispositions `uri_disposition` can assert. A fourth value is a bug,
# not a new behaviour: every caller enumerates these three and falls through on
# None.
URI_OFF_REPO = "off_repo"
URI_LOCAL = "local"
URI_UNDECIDABLE = "undecidable"


def is_local_authority(host: str) -> bool:
    """Whether ``host`` denotes THIS machine. Semantic for IPs, enumerated else.

    ``host`` is ``urlsplit().hostname`` -- already lowercased, already stripped
    of userinfo, port and the brackets around an IPv6 literal.

    An IP address is decided by ``ipaddress.ip_address(...).is_loopback``, so
    every spelling of loopback is covered without any of them being written
    down. A NAME is decided by the enumerated set: an empty host is not local
    (there is no authority to be local), and a name that is not in the set is
    remote, because inferring otherwise would mean guessing at a resolver.
    """
    if not host:
        return False
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        # An IPv4-MAPPED IPv6 address denotes its embedded IPv4 address, so it
        # is decided on that address rather than on the wrapper. Written out
        # rather than left to `.is_loopback` because the stdlib's answer for
        # `::ffff:127.0.0.1` CHANGED: measured False on 3.9.6 and True on
        # 3.12.13, both present on this machine and both used to run this file.
        # A gate verdict may not depend on which interpreter the operator
        # happened to type, so the mapping is unwrapped here and the tool gives
        # the same answer on every version.
        mapped = getattr(addr, "ipv4_mapped", None)
        return (addr if mapped is None else mapped).is_loopback
    # A single trailing dot is DNS root-anchoring, not part of the label.
    name = host[:-1] if host.endswith(".") else host
    return name in LOCAL_HOSTNAMES


def uri_disposition(token: str) -> tuple[str | None, str]:
    """Classify ``token`` as a URI reference. Returns ``(disposition, value)``.

    ``(URI_OFF_REPO, token)``  -- a non-empty, non-local authority: another
                                 host's reference, decided, never this
                                 repository.
    ``(URI_LOCAL, path)``      -- a ``file:`` reference with an empty or local
                                 authority; ``path`` is its percent-decoded path
                                 component, to be fed to the ordinary ladder.
    ``(URI_UNDECIDABLE, token)`` -- an authority-bearing reference whose meaning
                                 this tool cannot establish: either the
                                 authority did not PARSE, or it parsed as LOCAL
                                 under a scheme other than ``file:``, which
                                 names a served resource rather than a path.
                                 Not the same answer as ``None``; see the F34
                                 second- and third-round blocks below.
    ``(None, token)``          -- DECIDED: not a URI reference this tool acts
                                 on, so the ordinary path ladder applies. Only
                                 an AUTHORITY-LESS token reaches this answer;
                                 every authority-bearing one is decided by one
                                 of the three arms above.

    Iterated to a FIXPOINT (bounded by the strict shrinkage of the remaining
    string) so a doubly-wrapped ``file:file://host/x`` cannot present a remote
    authority behind one decode and escape the off-repo verdict.
    """
    cur, peeled = token, False
    for _ in range(len(token) + 1):
        try:
            parts = urllib.parse.urlsplit(cur)
            host = parts.hostname or ""
        except ValueError:
            # UNDECIDABLE, not "not a URI". Every `ValueError` `urlsplit` raises
            # comes from the authority component, so reaching here means the
            # token carries an authority the tool could not read. Falling
            # through to the path ladder here is what let `//[bad/repo/src/
            # populus/cli.py` be attributed to a tracked file. `.hostname` is
            # inside the guard as well: it revalidates a bracketed host, and a
            # future release moving the check there must not reopen this.
            return URI_UNDECIDABLE, token
        if parts.netloc:
            if not is_local_authority(host):
                return URI_OFF_REPO, token
            if parts.scheme != "file":
                # A local authority with no `file:` scheme names no filesystem
                # path. UNDECIDED -- see G3 -- so nothing is asserted here.
                #
                # F34 (third round). This arm used to return `None`, and `None`
                # is not "undecided": it is the DECIDED answer "not a URI
                # reference this tool acts on, use the ordinary path ladder".
                # The comment said one thing and the code did the other, and the
                # ladder then read the `repo` / `Populus` segment of
                # `//localhost/repo/src/populus/cli.py`,
                # `http://localhost/repo/src/populus/cli.py` and
                # `//127.0.0.53/Populus/src/populus/cli.py` as a recognized
                # checkout root and attributed all three to the tracked
                # `src/populus/cli.py`. Three false ownership claims, at exit 0,
                # on both interpreters.
                #
                # `http://localhost/...` is an HTTP resource served by a local
                # daemon, not a filesystem path. The tool cannot tell what such
                # a reference names -- the authority is this machine, but the
                # scheme says the path is a server-side route, not a path on
                # disk -- and "cannot tell" must fail CLOSED. It must never be
                # read as "an ordinary relative path, please resolve it".
                # `URI_UNDECIDABLE` is exactly that answer: it already
                # terminates in `unresolved` before the basename and suffix
                # rungs, and it already vetoes `ignored()`, so the token is
                # reported by name for a human to classify instead of being
                # attributed or hidden.
                return URI_UNDECIDABLE, token
        elif parts.scheme != "file":
            # No authority and no `file:` scheme: a bare path, or a scheme this
            # tool does not decide on (`mailto:`, `publish.yml:publish`).
            return (URI_LOCAL, cur) if peeled else (None, token)
        # A `file:` layer with an empty or local authority. Peel it and re-ask:
        # the path component of one layer can itself be a URI reference.
        nxt = urllib.parse.unquote(parts.path)
        if not nxt:
            return None, token          # `file:` with no path names nothing
        if nxt == cur:
            return URI_LOCAL, cur
        cur, peeled = nxt, True
    return URI_LOCAL, cur


def is_checkout_root(prefix: str) -> bool:
    """Whether ``prefix`` can be justified as naming THIS repository's checkout.

    ``prefix`` is the part of a token that segment-suffix resolution proposes to
    throw away. Returning True is what licenses an ownership assertion, so the
    default is False and the two accepted families are enumerated above.
    """
    p = prefix.strip("/")
    if not p:
        return False
    last = p.rsplit("/", 1)[-1]
    return last == REPO_NAME or last in CHECKOUT_ROOT_SEGMENTS


def suffix_match(token: str, tracked, by_suffix) -> tuple[str, list[str]]:
    """The LONGEST proper segment-suffix of ``token`` that names tracked file(s).

    Returns ``(suffix, hits)``, or ``("", [])`` when no proper suffix of
    ``token`` names anything tracked. A ``hits`` list of length >= 2 is an
    AMBIGUOUS shorthand, not a resolution -- and so, per the ONE-SEGMENT rule
    in ``resolve_suffix_any``, is a one-segment ``suffix``.
    """
    parts = token.split("/")
    for i in range(1, len(parts)):
        cand = "/".join(parts[i:])
        # An interior empty segment (`a//b`, or the `//` of a URL) would make
        # `cand` unusable as a lookup key; skip rather than invent a reading.
        if not cand or "" in parts[i:]:
            continue
        hits = set(by_suffix.get(cand, ()))
        if cand in tracked:
            hits.add(cand)
        if hits:
            return cand, sorted(hits)
    return "", []


def resolve_suffix_any(token: str, tracked, by_suffix):
    """``suffix_match`` over every reading. Returns ``(hit, ambiguous, weak)``.

    TRI-STATE, per the RECOGNIZED CHECKOUT ROOTS block above. ``hit`` is an
    ownership assertion and requires a justified prefix; ``ambiguous`` and
    ``weak`` are both "the tool cannot tell", route to ``unresolved`` (exit 1)
    and veto every hiding category; all three false means NO EVIDENCE, and the
    caller's ladder continues as if this rung did not exist.

    --- THE ONE-SEGMENT RULE, and why it now has an exception ----------------
    A match on a single trailing segment is a BASENAME match, and this tool
    already treats basename resolution as its weakest rung: ``resolve_uniquely``
    consults ``by_base`` only for a token that has no separator at all -- a
    token whose author wrote nothing but the name. When the author DID write a
    multi-segment path, throwing away every segment but the last is a guess
    about what they meant, not a reading of what they wrote.

    So a one-segment suffix under an UNRECOGNIZED prefix still may never produce
    a ``found``. Measured, on the real plans and in the suite -- each of these
    resolved through a unique BASENAME and each attribution is wrong:

        `registry/company_tickers/snapshots/<sha>/company_tickers.json`
             -> tests/fixtures/inst/mcp/company_tickers.json   (a test fixture;
                this span is LIVE in the I-2 plan and is a declared IGNORE)
        `https://www.sec.gov/files/company_tickers.json`
             -> tests/fixtures/inst/mcp/company_tickers.json   (a vendor URL)
        `<HOME>/projects/Populus`
             -> docs/design/handoff/Populus                    (a checkout ROOT)

    The EXCEPTION, and the reason the rule was unsound as an absolute: when the
    dropped prefix IS a recognized checkout root, the trailing segment is not a
    guess at all. ``<HOME>/projects/Populus/NOTICE`` names the root-level
    ``NOTICE`` of this repository as plainly as any path can, and refusing it
    let three tracked root-level files -- NOTICE, Makefile, LICENSE -- escape
    the ownership gate at exit 0. None of the three wrong attributions above
    comes back with the exception in place: ``.../snapshots/<sha>``,
    ``https://www.sec.gov/files`` and ``<HOME>/projects`` are none of them a
    recognized root, and a REMOTE-AUTHORITY token never reaches this function --
    ``resolve_or_ambiguous`` decides it off-repository first (F34). That order
    is load-bearing in the other direction too: without it the authority of
    ``//repo/src/populus/cli.py`` is a REMOTE HOST that ``is_checkout_root``
    reads as the prefix ``//repo/`` and honours, manufacturing ownership.

    A one-segment hit under an unrecognized prefix is NOT ``weak``. It is no
    evidence whatsoever -- that is what N6 says -- so escalating it would turn
    four already-exempted live IGNORE spans into permanent gate failures with
    nothing for a human to decide.

    AMBIGUITY is still asymmetric, and deliberately so. Uniqueness of a basename
    is weak evidence FOR an attribution; multiplicity is strong evidence that the
    token is UNDECIDABLE, and G3 says undecidable fails closed.
    `<TMP>/Populus/README.md` is exactly that case -- four tracked `README.md` --
    and it is the reason the rule is not simply "require two segments": with a
    flat two-segment minimum that span would resolve to nothing, look incapable
    of resolving, and be swallowed by the `^/` IGNORE pattern at exit 0, which is
    the F28 fail-open it was reported as.

    A justified hit from ANY reading wins over an ambiguity or a weakness seen in
    another -- readings are wrapper-strippings of one string, and a hit through a
    recognized checkout root is the more specific evidence.
    """
    ambiguous = False
    weak = False
    for r in readings(token):
        suffix, hits = suffix_match(r, tracked, by_suffix)
        if not hits:
            continue
        # `suffix_match` returns an exact SEGMENT tail of `r`, so the prefix is
        # what is left in front of it. Asserted rather than assumed: a future
        # change to `suffix_match` that returned a rewritten suffix would
        # silently mis-slice the prefix and hand ownership to the wrong root.
        if not r.endswith(suffix):
            raise ScanError(
                f"suffix {suffix!r} is not a tail of reading {r!r} -- the "
                f"prefix cannot be sliced, so no root can be justified"
            )
        prefix = r[: len(r) - len(suffix)]
        if len(hits) >= 2:
            ambiguous = True
        elif is_checkout_root(prefix):
            return hits[0], False, False
        elif "/" in suffix:
            weak = True
    return None, ambiguous, weak


def resolve_or_ambiguous(token, tracked, by_base, by_suffix):
    """THE resolution ladder. Returns ``(hit, ambiguous, weak, undecidable)``.

    Four channels, not three, since F34's second round. ``ambiguous``, ``weak``
    and ``undecidable`` are all "the tool cannot tell" and all route to
    ``unresolved`` -- but they are kept APART rather than folded into one flag,
    because they say different things to the operator and because a shared flag
    is a place for a mutation to hide. ``undecidable`` is an authority that
    could not be parsed; ``weak`` is a parsed path under an unjustifiable root.

    --- where ``undecidable`` is actually LOAD-BEARING, measured -------------
    A mutation pass found that removing ``or undec`` from any ONE of
    ``classify_span``'s four ladder call sites changes no bucket. That is not a
    missing test; it is what the surrounding code already guarantees, and it
    was MEASURED rather than argued:

      * SITE 1 (the multi-word / uncertain branch) is reachable, but its
        fallback after ``ignored()`` is an UNCONDITIONAL ``unresolved``, so the
        guard and the fallback agree. What actually stops an undecidable token
        being HIDDEN there is ``ignored()``'s veto -- and removing THAT does
        change a bucket, and is killed.
      * SITES 2, 3 and 4 are UNREACHABLE for an undecidable token. Sites 3 and
        4 sit behind ``CAND_RE``, and no string ``CAND_RE`` matches is one
        ``urlsplit`` rejects -- brute-forced over ``CAND_RE``'s entire alphabet
        up to length 5, zero hits, because a parse failure needs a leading
        ``//`` or a ``:`` and ``CAND_RE`` admits neither. Site 2 sits behind
        "zero candidates and zero uncertain words", and ``classify_word``
        routes every undecidable word to ``uncertain``, so that gate never
        opens.

    All four are KEPT anyway. This file's rule is that every call site reads
    the same ladder the same way; a site that silently disagreed would be a
    fail-open waiting for the day someone makes the site-1 fallback
    conditional or loosens ``CAND_RE``.

    One definition, three call sites in ``classify_span`` plus the IGNORE veto,
    so a future rung cannot be added to one ladder and forgotten on the others
    -- which is how F28's first round left the checkout-root case open.

    The URI discriminator is HERE rather than inside ``resolve_suffix_any``
    because it must also close the basename rung: a single ladder with a single
    guard is the only shape in which "a remote authority never resolves to
    ownership" is a property of the tool rather than of one function. F34: it is
    also why a LOCAL ``file:`` reference is REWRITTEN here rather than resolved
    by a rung of its own -- there is one ladder, and the decoded path is fed to
    it, so a file URL inherits the checkout-root rule, the ambiguity rule and
    the one-segment rule without restating any of them.
    """
    disposition, value = uri_disposition(token)
    if disposition == URI_OFF_REPO:
        return None, False, False, False
    if disposition == URI_UNDECIDABLE:
        # BEFORE the basename rung and BEFORE suffix resolution, for the same
        # reason the off-repo arm is: a rung that runs first is a rung that can
        # assert ownership, and nothing may assert ownership over a string this
        # tool could not parse.
        return None, False, False, True
    if disposition == URI_LOCAL:
        token = value
    hit = resolve_uniquely_any(token, tracked, by_base, by_suffix)
    if hit is not None:
        return hit, False, False, False
    hit, ambiguous, weak = resolve_suffix_any(token, tracked, by_suffix)
    return hit, ambiguous, weak, False


def ignored(token: str, tracked, by_base, by_suffix) -> bool:
    """Whether ``token`` is a written-off non-repository artifact.

    The tracked-resolution test runs FIRST and vetoes every exemption. There is
    no argument-free spelling of this function on purpose: a call site that
    cannot see the baseline cannot be trusted to decide what to hide.

    F28 (second round): the veto now covers segment-suffix resolution AND its
    ambiguous outcome. A token that names two or more tracked files is not
    "incapable of resolving" -- it is UNDECIDED, and G4 says a hiding category
    may not claim it either.

    F28 (third round): ``weak`` joins the veto for the same reason. A token that
    spells a full repository-relative path under a prefix the tool cannot
    justify is undecided, not written off.

    F34 (second round): ``undecidable`` joins the veto for the same reason
    again. Measured: ``//[bad/opt/unrelated/thing.py`` was ``ignored`` -- an
    unparseable authority swallowed by a hiding pattern at exit 0.
    """
    hit, ambiguous, weak, undecidable = resolve_or_ambiguous(
        token, tracked, by_base, by_suffix)
    if hit is not None or ambiguous or weak or undecidable:
        return False
    if token in IGNORE:
        return True
    return any(re.search(rx, token) for rx, _ in IGNORE_PATTERNS)


def load_tracked(ref: str) -> set[str]:
    """The baseline file set. Any failure is a ScanError -- never an empty set.

    An empty or failed read used to propagate as an empty ``tracked``, which
    makes EVERY token unresolvable and the report a wall of false findings, or
    -- worse -- raises out of ``main`` with exit 1, the same status as a real
    finding. Both are now status 2.
    """
    try:
        proc = subprocess.run(
            ["git", "ls-tree", "-r", "--name-only", ref],
            capture_output=True, text=True, check=True,
        )
    except FileNotFoundError as exc:            # git not on PATH
        raise ScanError(f"cannot run git: {exc}") from exc
    except subprocess.CalledProcessError as exc:
        raise ScanError(
            f"git ls-tree failed for ref {ref!r} (status {exc.returncode}): "
            f"{exc.stderr.strip()}"
        ) from exc
    tracked = set(proc.stdout.split())
    if not tracked:
        raise ScanError(
            f"ref {ref!r} lists no files -- refusing to certify against an "
            f"empty baseline"
        )
    return tracked


# Every backticked span is a CANDIDATE; classification happens afterwards.
#
# The previous version tokenised with a fixed extension list
# (``EXT``) plus three hardcoded special cases, so a path with no extension was
# never turned into a token at all, yet the report showed found=no AND
# unresolved=no for it -- a silent drop, the failure mode this gate exists to
# prevent. Both examples below are tracked on the baseline. Measured, because an
# earlier revision of this comment credited BOTH names to the security plan and
# both counts were wrong:
#
#   * ``dashboard/public/_headers`` -- 20 occurrences in the SECURITY plan
#     (19 backticked: 15 bare ``_headers``, 2 ``dashboard/public/_headers``,
#     2 ``/_headers``), and 0 in the I-2 plan;
#   * ``NOTICE`` -- 0 occurrences in the security plan, 1 in the I-2 plan.
#
# Extraction is now extension-blind and resolution is by tracked path / unique
# suffix / unique basename, none of which care about a dot.
BACKTICK_RE = re.compile(r"`([^`\n]+)`")

# A candidate is one whitespace-free path-shaped run. Leading `[` is allowed for
# Astro route files (`[year].v1.json.ts`), leading `.` for dotfiles.
CAND_RE = re.compile(r"^[A-Za-z0-9_.@+\[][A-Za-z0-9_.@+\[\]-]*(?:/[A-Za-z0-9_.@+\[\]-]+)*/?$")

# A LINE-QUALIFIED citation: `README.md:7`, `ARCHITECTURE.md:797`,
# `src/populus/ingest/house.py:315-334`. CAND_RE has no `:` in its character
# class, so every one of these failed the candidate test and was `continue`d
# BEFORE resolution and before the path_shaped() drop filter -- they appeared in
# neither found, nor unresolved, nor dropped. They simply vanished, which is the
# same silent-drop class as the extensionless defect above and made the gate's
# "counts are byte-identical" result depend on a hidden filter.
#
# The qualifier is now normalised away so the bare path is classified like any
# other reference. THREE qualifier forms occur in the real plans; all three were
# vanishing, so fixing only the first would have left the same hole open:
#
#   1. a line or line range      `README.md:7`, `Makefile:55-59`
#   2. a COMMA-SEPARATED list    `ARCHITECTURE.md:797-799,923`
#   3. a `::symbol` qualifier    `src/populus/canonical.py::canonical_json`,
#      including one carrying a signature with spaces in it:
#      `src/populus/licenses.py::require_counsel_disposition(document, flag, ...)`
#
# The suffix is stripped ONLY when what remains is itself a valid candidate, and
# only for spans CAND_RE already rejected -- CAND_RE admits no colon, so no
# token that used to resolve can change meaning.
#
# Deliberately NOT broadened past these: an arbitrary `foo:bar` stays untouched,
# so `application/json`-style prose is not turned into a phantom path. What this
# does also normalise is prose key/value pairs such as `cik:0001045810` and
# `attempt:1`; those become bare non-path tokens and are REPORTED in the
# `dropped` count rather than disappearing.
LINESPEC = r"\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*"
QUALIFIED_RE = re.compile(rf"^(?P<path>[^\s:]+)(?::{LINESPEC}|::.*)$")


def strip_line_suffix(token: str) -> str:
    """Return ``token`` without a trailing ``:line`` / ``::symbol`` citation."""
    m = QUALIFIED_RE.match(token)
    if m and CAND_RE.match(m.group("path")):
        return m.group("path")
    return token

# Whether an UNRESOLVED candidate is path-shaped enough to be worth reporting.
#
# This filter runs ONLY after resolution has already failed, so it cannot hide a
# token that a tracked path, a unique suffix/basename, a NEW declaration or an
# IGNORE entry would have matched -- the extensionless-drop defect cannot recur
# through it. `NOTICE` and `dashboard/public/_headers` resolve as tracked paths
# and never reach here. Its only job is to keep the code spans that are plainly
# not repository paths out of the failure list: env-var names, git refs, action
# refs, MIME types, version numbers, attribute chains. Anything it drops is
# COUNTED in the report and listed in full with --show-dropped.
_EXT_RE = re.compile(rf"\.{EXT}$")


def path_shaped(token: str, top_dirs: frozenset[str]) -> bool:
    if _EXT_RE.search(token):
        return True          # a repository file type, whatever directory it names
    if "/" in token:
        # A slash alone is not enough: `origin/main`, `refs/heads/main`,
        # `actions/checkout` and `application/json` all have one. The first
        # segment must actually be a top-level entry of the baseline tree.
        return token.split("/", 1)[0] in top_dirs
    return False


# --------------------------------------------------------------------------
# The NO-VANISH CONTRACT
#
# This is the FIFTH recurrence of one defect class in this tool: a backticked
# span leaves the classifier through a bare `continue` and is then reported in
# NEITHER found, NOR unresolved, NOR dropped. It simply disappears, and the
# tool's headline "the counts are byte-identical" result silently rests on a
# hidden filter.
#
# The four earlier instances were each fixed by widening a pattern -- a fixed
# extension list, then `:line`, then `:line,line`, then `::symbol`. Widening a
# pattern cannot close the class, because the class IS the existence of an exit
# with no record. Live proof that it was still open, measured on the real plans
# with the previous revision: 180 security-plan spans and 464 I-2 spans left the
# loop unrecorded, among them
#
#     `publish.yml:publish`                              (workflow job qualifier)
#     `record-sign.yml:record`                           (workflow job qualifier)
#     `scripts/inst_snapshot.py --prepare-working-copy`  (command form)
#
# all three of which `--show-dropped` returned zero matches for.
#
# The structure is now the guarantee, not the patterns:
#
#   * ``classify_span`` is a TOTAL function. Every path through it returns a
#     ``(bucket, value, ctx)`` triple; there is no ``continue``, no bare
#     ``return`` and no fall-through. Adding a new rejection rule without a
#     bucket is a syntax-level impossibility rather than a review question.
#   * ``Spans.record`` REJECTS an unknown bucket name, so a typo cannot invent a
#     silent sink.
#   * ``Spans.routes`` maps every raw span the classifier saw to the bucket it
#     landed in, which is what the invariant test compares against a fresh
#     ``BACKTICK_RE`` sweep of the same document. That test -- not any regex
#     here -- is what makes the class un-regressable.
#
# Resolution is NOT forced. Routes, prose, MIME types, CLI flag names and shell
# fragments legitimately belong in ``dropped``; the contract is only that they
# are COUNTED and listable, never that they resolve.
# --------------------------------------------------------------------------

BUCKETS = (
    "found",         # resolved to a tracked baseline path (this is the owned set)
    "unresolved",    # path-shaped and resolved to nothing -- a gate FAILURE
    "dropped",       # recorded, counted, listable under --show-dropped
    "declared_new",  # the run declares it will create this file (per-run NEW)
    "ignored",       # a non-repository artifact with a written reason (IGNORE)
    "directory",     # a tracked directory named as a scope, never expanded
)

# A qualifier of the form `<path>:<job>` -- `publish.yml:publish`,
# `record-sign.yml:record`. QUALIFIED_RE above handles `:<digits>` and
# `::<symbol>` but not this third real form, so it was reaching the old bare
# `continue`. Exactly ONE colon: `entity:cik:0001045810` is prose, not a
# qualifier, and must stay in dropped.
JOB_QUALIFIER_RE = re.compile(r"^(?P<stem>[^\s:]+):(?P<job>[^\s:]+)$")


# ``stem_of()`` lived here. It returned the path-bearing stem of a span's FIRST
# word and nothing else, which was defect F23's second escape; ``repo_candidates``
# below replaces it. DELETED rather than kept as a thin wrapper: a dead helper
# with the old, narrower contract is exactly what a future edit reaches for by
# name, and this tool has now had the same class of defect five times.
def word_stem(word: str) -> str | None:
    """Normalise ONE whitespace-free word to a bare path, or ``None``.

    Three spellings collapse to the same path: the word itself
    (``scripts/x.py``), a ``path:job`` workflow qualifier (``publish.yml:publish``)
    and a ``path:line`` / ``path::symbol`` citation (``README.md:7``).
    """
    if CAND_RE.match(word):
        return word
    m = JOB_QUALIFIER_RE.match(word)
    if m and CAND_RE.match(m.group("stem")):
        return m.group("stem")
    s = strip_line_suffix(word)
    if CAND_RE.match(s):
        return s
    return None


# --------------------------------------------------------------------------
# PER-WORD CLASSIFICATION IS TOTAL (defect F23, third fix)
#
# ``word_stem`` returns ``None`` for anything it cannot normalise, and the
# previous ``repo_candidates`` turned that ``None`` into a bare ``continue``.
# That is the SAME vanish shape ``classify_span`` was restructured to remove,
# one level down: the span still reached a bucket, but the WORD carrying its
# repository path never did, so the span fell to the catch-all ``dropped`` and
# the gate exited 0. Measured against the previous revision, all four at exit 0
# with ``found=0 unresolved=0 dropped=1``:
#
#     `python "scripts/no_such_future_tool_xyz.py"`   dropped  (double-quoted)
#     `python 'scripts/no_such_future_tool_xyz.py'`   dropped  (single-quoted)
#     `python (scripts/no_such_future_tool_xyz.py)`   dropped  (parenthesised)
#     `--workflow=no_such_workflow_xyz.yml`           dropped  (option assignment)
#
# In every one of them ``word_stem`` was consulted BEFORE the word had been
# stripped of the syntax wrapped around it, so ``CAND_RE`` -- which admits
# neither a quote, nor a bracket, nor an ``=`` -- rejected a perfectly ordinary
# path reference and the word disappeared.
#
# The fix is the same inversion used one level up: make the routing TOTAL.
# ``classify_word`` returns one of exactly three kinds for EVERY word, with no
# ``continue``, no bare ``return`` and a terminal catch-all:
#
#   ``candidate``  a repository-shaped path this span names.
#   ``uncertain``  the word BEARS a repository path but could not be normalised
#                  into one. Routed to ``unresolved`` -- exit 1 -- because a
#                  path the tool cannot read is not a path the tool may ignore.
#   ``nonpath``    genuine prose, a flag name, a MIME type, a version string, an
#                  env var, a git ref. Routed to ``dropped`` -- exit 0.
#
# ``path_shaped()`` remains the ONLY definition of "repository-shaped" in this
# file; ``classify_word`` calls it and defines no predicate of its own. Pinned
# by test_cross_run_repo_candidates_reuses_path_shaped.
# --------------------------------------------------------------------------

WORD_KINDS = ("nonpath", "candidate", "uncertain")

# Syntax that WRAPS a path in a plan document. Stripped only in matched pairs,
# so `[year].v1.json.ts` (a real Astro route file, leading `[`, no trailing `]`)
# is left exactly as written.
_WRAPPERS = {'"': '"', "'": "'", "(": ")", "[": "]", "{": "}", "<": ">"}


def unwrap_word(word: str) -> str:
    """Strip matched surrounding quote/bracket pairs. Never returns empty."""
    out = word
    while len(out) >= 3 and _WRAPPERS.get(out[0]) == out[-1]:
        out = out[1:-1]
    return out


# --------------------------------------------------------------------------
# TRAILING PROSE PUNCTUATION (defect F29)
#
# ``unwrap_word`` strips a matched pair only when the closing half is the LAST
# character of the word. A path quoted inside a sentence is not: the wrapper is
# followed by the sentence's own punctuation, so nothing was stripped, CAND_RE
# rejected the quote, ``path_shaped`` rejected the trailing comma, and the word
# was classified ``nonpath``. Measured on the previous revision -- the first
# resolves, the other three do not:
#
#     `python "scripts/inst_snapshot.py"`    found: scripts/inst_snapshot.py
#     `python "scripts/inst_snapshot.py",`   dropped
#     `python (scripts/inst_snapshot.py),`   dropped
#     `python [scripts/inst_snapshot.py];`   dropped
#
# A real owned path landing in ``dropped`` is exactly the failure the six-bucket
# invariant was built to make impossible, reappearing one layer up as a SEMANTIC
# misclassification: the invariant stays green because the span did reach a
# bucket -- just the wrong one.
#
# ``strip_outer_syntax`` alternates unwrapping and trailing-mark removal to a
# FIXPOINT, so repeated wrappers (`("scripts/x.py"),`) are peeled in any order.
# It is deliberately OUTER-only: an interior character is never touched, so a
# path is never rewritten into a different path.
#
# ``:`` is included because a dangling qualifier colon (`publish.yml:`) is prose
# punctuation too; the `path:line` and `path::symbol` forms end in a digit or a
# symbol name and are unaffected. ``-`` and ``_`` are NOT included: they are
# ordinary trailing characters of real file and branch names.
_TRAILING_PROSE = ",.;:!?"


def strip_outer_syntax(word: str) -> str:
    """Peel matched wrapper pairs and trailing prose marks to a fixpoint.

    Never returns empty: a mark-only word (``,``) rstrips to nothing, and the
    ``or`` guard keeps the previous reading instead.
    """
    out = word
    while True:
        nxt = unwrap_word(out).rstrip(_TRAILING_PROSE) or out
        if nxt == out:
            return out
        out = nxt


def split_option_assignment(word: str) -> str:
    """``--workflow=publish.yml`` -> ``publish.yml``; anything else unchanged.

    Restricted to words that START with ``-``. Without that guard this would
    also rewrite ``POPULUS_DATA_DIR=/tmp/x``, which is prose about an
    environment variable and must stay in ``dropped``.
    """
    if word.startswith("-") and "=" in word:
        return unwrap_word(word.split("=", 1)[1])
    return word


def classify_word(word: str, top_dirs: frozenset[str]) -> tuple[str, str]:
    """Route ONE whitespace-free word to exactly one of ``WORD_KINDS``.

    TOTAL by construction: every branch returns a ``(kind, value)`` pair, and
    the last statement is the catch-all return. Returning ``None`` -- the shape
    ``word_stem`` has and the shape that produced F23's third escape -- is a
    syntax-level impossibility here.
    """
    core = strip_outer_syntax(split_option_assignment(strip_outer_syntax(word)))
    # F34: decide URI references by MEANING before anything else looks at the
    # word's syntax. A remote authority is a decided non-repository reference,
    # which is exactly what `nonpath` means here -- the caller routes it to
    # `dropped`, per N8. A LOCAL `file:` reference is rewritten to its decoded
    # path and then classified like any other path, so `file:` grants no
    # exemption and claims no ownership of its own.
    disposition, value = uri_disposition(core)
    if disposition == URI_OFF_REPO:
        return "nonpath", core
    if disposition == URI_UNDECIDABLE:
        # F34, second round. `uncertain` is this classifier's spelling of
        # "bears a repository reference and could not be read" -- the caller
        # hands it to the same ladder a candidate gets, where the SAME
        # disposition refuses it again and it lands in `unresolved`. Returning
        # `nonpath` here would drop it at exit 0; letting it fall through to
        # `word_stem` is the bug this closes, since the stem of
        # `//[bad/repo/src/populus/cli.py` is an ordinary-looking path.
        return "uncertain", core
    if disposition == URI_LOCAL:
        core = value
    stem = word_stem(core)
    if stem is not None:
        stem = stem.rstrip("/") or stem
        if path_shaped(stem, top_dirs):
            return "candidate", stem
        return "nonpath", stem
    # Not normalisable. Ask the ONE predicate whether it nevertheless bears a
    # repository path; if it does, that is uncertainty and uncertainty fails
    # closed.
    if path_shaped(core, top_dirs):
        return "uncertain", core
    return "nonpath", core


def repo_candidates(
    token: str, top_dirs: frozenset[str]
) -> tuple[list[str], list[str]]:
    """EVERY repository-shaped word of a multi-word span, in order, deduplicated.

    Returns ``(candidates, uncertain)``. Both lists are deduplicated and
    order-preserving, and every word of ``token`` contributed to exactly one of
    them or was classified ``nonpath`` -- there is no fourth outcome and no
    ``continue`` that discards a word without a decision.

    --- defect F23, structural fix -------------------------------------------
    The previous revision inspected ``token.split()[0]`` ALONE. A span whose
    repository path sits after an interpreter or behind an option therefore had
    no candidate at all and fell to the CATCH-ALL ``dropped`` bucket, where the
    gate exits 0. Three measured instances, two synthetic and one LIVE:

        `python scripts/no_such.py`      -> dropped   (should be unresolved)
        `--workflow no_such.yml`         -> dropped   (should be unresolved)
        `--workflow publish.yml`         -> dropped   (LIVE; resolves uniquely
                                            to .github/workflows/publish.yml)

    On the LIVE case, count carefully. The text ``--workflow publish.yml``
    occurs 26 times in the I-2 plan, but only ONE of those is a standalone
    BACKTICKED span; the other 25 sit inside fenced code blocks, which
    ``BACKTICK_RE`` (``[^`\n]+`` between single backticks) never tokenises.
    So this fix moves exactly one span, not 26 -- which is why every slice
    count below is unchanged.
    The first word was `python` / `--workflow`, neither of which is a candidate,
    so the real path was never looked at. That is the same fail-open F23 closed
    for the first word only: a sibling run names a file that does not exist on
    the baseline, and the OWNERSHIP gate reports the slice conflict-free.

    Improving the "which word is the path" heuristic is what the two previous
    attempts did, and each left another spelling outside it. This inverts it
    instead: inspect ALL words, and let UNCERTAINTY fail closed. The caller
    routes zero candidates to ``dropped`` (prose -- exit 0), exactly one to the
    normal resolution ladder, and TWO OR MORE to ``unresolved`` (exit 1),
    because a span naming two repository paths is a span the tool cannot
    attribute and must not silently pick a winner from.

    ``path_shaped()`` is REUSED unchanged as the predicate -- there is one
    definition of "repository-shaped" in this file, not two -- so prose, MIME
    types, version strings, env vars, git refs and action refs still produce
    zero candidates and still land in ``dropped``.

    Measured on the real plans: 0 spans in either plan yield two or more
    candidates, and exactly one span (`--workflow publish.yml`) changes bucket.
    """
    buckets: dict[str, list[str]] = {k: [] for k in WORD_KINDS}
    for word in token.split():
        kind, value = classify_word(word, top_dirs)
        # `classify_word` can only return a name from WORD_KINDS, and this
        # lookup REJECTS anything else rather than dropping the word -- the
        # same discipline `Spans.record` applies one level up. A typo cannot
        # invent a silent sink.
        if kind not in buckets:
            raise ScanError(f"unknown word kind {kind!r} for word {word!r}")
        # `path_shaped` is named HERE as well as inside `classify_word`, as an
        # assertion rather than a second opinion: there is one definition of
        # "repository-shaped" in this file, and a candidate that failed it
        # would mean the two call sites disagree, which is a scan error, not a
        # word to drop.
        if kind == "candidate" and not path_shaped(value, top_dirs):
            raise ScanError(
                f"word {word!r} classified as a candidate but is not "
                f"path-shaped -- the predicate disagrees with itself"
            )
        if value not in buckets[kind]:
            buckets[kind].append(value)
    return buckets["candidate"], buckets["uncertain"]


def resolve_uniquely(token, tracked, by_base, by_suffix):
    """Resolve ``token`` ONLY when it lands on exactly one tracked file.

    Deliberately stricter than the main classifier's ladder: a normalised stem
    is a GUESS about what a prose span meant, so an ambiguous one must be
    reported as dropped rather than forced onto an arbitrary tracked path.
    """
    if token in tracked:
        return token
    hits = by_suffix.get(token, ()) if "/" in token else by_base.get(token, ())
    return hits[0] if len(hits) == 1 else None


def resolve_uniquely_any(token, tracked, by_base, by_suffix):
    """``resolve_uniquely`` over every reading of ``token`` (defect F28).

    The plain token is ``readings()[0]``, so this is strictly wider and can
    never change a token that already resolved. It exists so that the value an
    IGNORE pattern is no longer allowed to hide -- ``$REPO/src/populus/cli.py``
    -- is ATTRIBUTED to its tracked path rather than merely refused.
    """
    for r in readings(token):
        hit = resolve_uniquely(r, tracked, by_base, by_suffix)
        if hit is not None:
            return hit
    return None


def classify_span(span, ctx, tracked, by_base, by_suffix, new, new_basenames,
                  top_dirs, tracked_dirs):
    """Route one backticked span to exactly one bucket. TOTAL by construction.

    Returns ``(bucket, value, ctx)``. ``bucket`` is always one of ``BUCKETS``;
    there is no code path that returns nothing.
    """
    t = span.strip()
    if not CAND_RE.match(t):
        # A `path:line` citation is a reference to the path. Strip the suffix
        # and classify it like any other reference.
        s = strip_line_suffix(t)
        if CAND_RE.match(s):
            t = s
        else:
            # Not a plain reference. Inspect EVERY word of the span for a
            # repository-shaped candidate, then fall into the CATCH-ALL. Every
            # branch below records something.
            cands, unsure = repo_candidates(t, top_dirs)
            if len(cands) + len(unsure) >= 2:
                # AMBIGUOUS: the span names two or more repository-shaped
                # paths, so the tool cannot attribute it. Uncertainty fails
                # CLOSED -- the operator resolves it by hand rather than the
                # tool picking a winner and exiting 0. Measured: 0 live spans.
                return "unresolved", " + ".join(cands + unsure), ctx
            # ONE ladder for both kinds. An `uncertain` word -- one that bears a
            # repository path but could not be normalised -- gets exactly the
            # same NEW / IGNORE / directory / unique-resolution treatment a
            # candidate gets, and only falls to `unresolved` when none of them
            # claims it. Written as a separate early `return "unresolved"`, the
            # first draft of this fix skipped the IGNORE table entirely and
            # reported four already-exempted published-site routes as findings.
            only = cands + unsure
            if only:
                stem = only[0]
                if stem in new or stem in new_basenames:
                    return "declared_new", stem, ctx
                # F28: RESOLUTION FIRST. `ignored()` refuses to claim anything a
                # reading of which lands on a tracked file, and the resolution
                # attempt below runs over the same readings -- so a wrapped
                # tracked path is ATTRIBUTED, never hidden.
                if stem in tracked_dirs:
                    return "directory", stem, ctx
                hit, amb, weak, undec = resolve_or_ambiguous(
                    stem, tracked, by_base, by_suffix)
                if hit is not None:
                    return "found", hit, ctx
                if amb or weak or undec:
                    # F28: a segment-suffix naming two or more tracked files
                    # (`amb`), or naming exactly one but through a prefix that
                    # cannot be shown to be a checkout root (`weak`). Refused,
                    # never picked, and never handed to IGNORE.
                    return "unresolved", stem, ctx
                if ignored(stem, tracked, by_base, by_suffix):
                    return "ignored", stem, ctx
                # F23: repository-SHAPED but unresolvable -- zero tracked
                # hits, or an ambiguous suffix/basename. This used to fall
                # through to the CATCH-ALL below, so a command-form span
                # naming a file that does not exist on the baseline
                # (`scripts/no_such_future_tool.py --flag`) was counted as
                # `dropped` and the OWNERSHIP gate exited 0. That is a
                # fail-open: a sibling run introduces or renames a file
                # through a command-form reference and T0.4 declares the
                # affected slice conflict-free.
                #
                # Routing it to `unresolved` -- which exits 1 -- restores the
                # gate's own contract: a token that LOOKS like a repository
                # path and resolves to nothing is a failure the operator must
                # classify as NEW, PROSE or IGNORE, not a silent statistic.
                #
                # The gate stays passable because `path_shaped()` guards the
                # whole branch: a stem only reaches here when it carries a
                # repository file extension, or a directory separator whose
                # first segment is a real top-level entry of the baseline
                # tree. `git diff --name-status HEAD`, `make check`,
                # `application/json`, `origin/main`, `1.2.3` and
                # `${{ secrets.* }}` all fail that predicate and still land in
                # `dropped` with exit 0.
                return "unresolved", stem, ctx
            # F28, LAST RUNG BEFORE THE CATCH-ALL. `path_shaped()` gates entry to
            # `repo_candidates` above and is CONTEXT-FREE: it recognises a
            # repository file extension, or a first segment that is a real
            # top-level entry of the tree. An arbitrary checkout root over a
            # tracked EXTENSIONLESS path -- `/opt/checkout/dashboard/public/
            # _headers`, or the live `/_headers` -- has neither, so it yielded
            # zero candidates and fell into `dropped`. Same fail-open as the five
            # measured forms; only the bucket that swallowed it differs.
            #
            # TWO constraints, both learned by measurement rather than argued:
            #
            #   * PLACED HERE, after `repo_candidates` rather than before it, so
            #     the rung is strictly ADDITIVE. It can only claim spans already
            #     headed for the catch-all, and can never take one away from
            #     `declared_new`, `directory`, `ignored` or `unresolved`.
            #   * It depends on the ONE-SEGMENT RULE in `resolve_suffix_any`.
            #     Written BEFORE that rule existed, this same rung attributed
            #     `https://www.sec.gov/files/company_tickers.json` and
            #     `<HOME>/projects/Populus` -- a vendor URL and a checkout ROOT
            #     -- to tracked files through a bare basename, and moved a live
            #     count (S1 I2 8 -> 9) on the strength of it. With the rule in
            #     place it claims exactly ONE live span, `/_headers` ->
            #     `dashboard/public/_headers`, which is a real owned path, and
            #     no slice count moves. Remove the one-segment rule and this
            #     rung becomes a false-attribution engine again.
            #
            # Single-word and separator-bearing only: attributing a multi-word
            # span is `repo_candidates`' job, and it fails closed there.
            if len(t.split()) == 1 and "/" in t:
                hit, amb, weak, undec = resolve_or_ambiguous(
                    t, tracked, by_base, by_suffix)
                if hit is not None:
                    return "found", hit, t.rsplit("/", 1)[0]
                if amb or weak or undec:
                    return "unresolved", t, ctx
            # CATCH-ALL. Prose, shell fragments, flag names, MIME types, HTTP
            # headers, ambiguous stems. Reported as a count and listed in full
            # under --show-dropped. THIS is where the bare `continue` was.
            return "dropped", t or span, ctx

    t = t.rstrip("/") or t
    if "/" in t:
        ctx = t.rsplit("/", 1)[0]
        if t in tracked:
            return "found", t, ctx
        if t in new:
            return "declared_new", t, ctx
        # (a2) unique path SUFFIX. Plans routinely shorten
        # `src/populus/deploy/record.py` to `deploy/record.py`. Only a suffix
        # that lands on exactly one tracked file resolves, so an ambiguous
        # shorthand still fails the gate.
        if len(by_suffix.get(t, ())) == 1:
            return "found", by_suffix[t][0], ctx
        # A tracked DIRECTORY (`ops/runner/`, `.github/`). Classified, but NOT
        # expanded into its files: the plans name these as CODEOWNERS scopes,
        # not as edit surfaces, and expanding them would inflate every blocked
        # count.
        if t in tracked_dirs:
            return "directory", t, ctx
        # F28: resolution over every reading -- including segment-suffix
        # resolution through an arbitrary checkout root -- THEN the ignore table.
        hit, amb, weak, undec = resolve_or_ambiguous(
            t, tracked, by_base, by_suffix)
        if hit is not None:
            return "found", hit, ctx
        if amb or weak or undec:
            return "unresolved", t, ctx
        if ignored(t, tracked, by_base, by_suffix):
            return "ignored", t, ctx
        if path_shaped(t, top_dirs):
            return "unresolved", t, ctx
        return "dropped", t, ctx

    # bare token. Check the ROOT path FIRST -- an earlier version tested
    # basename-uniqueness first, which silently dropped `README.md` (many
    # READMEs exist) and understated two slice intersections.
    cand = f"{ctx}/{t}" if ctx else None
    if t in tracked:
        return "found", t, ctx
    if cand and cand in tracked:
        return "found", cand, ctx                 # (a) sibling shorthand
    if t in new or t in new_basenames:
        return "declared_new", t, ctx             # bare name of a declared NEW file
    if len(by_base.get(t, ())) == 1:
        return "found", by_base[t][0], ctx
    # F28: resolution over every reading, THEN the ignore table. `t` is a BARE
    # token here -- no `/` -- so the segment-suffix rung inside
    # `resolve_or_ambiguous` is inert on it by construction; it is called anyway
    # so all three sites read the same ladder.
    hit, amb, weak, undec = resolve_or_ambiguous(t, tracked, by_base, by_suffix)
    if hit is not None:
        return "found", hit, ctx
    if amb or weak or undec:
        return "unresolved", t, ctx
    if ignored(t, tracked, by_base, by_suffix):
        return "ignored", t, ctx
    if path_shaped(t, top_dirs):
        return "unresolved", t, ctx
    return "dropped", t, ctx


class Spans:
    """Bucketed classification of one plan's backticked spans.

    Unpacks as ``(found, unresolved, dropped)`` so existing callers are
    unchanged, while ``routes`` carries the full accounting the invariant test
    needs.
    """

    def __init__(self):
        self.buckets = {name: set() for name in BUCKETS}
        self.routes: dict[str, str] = {}

    def record(self, span: str, bucket: str, value: str) -> None:
        if bucket not in self.buckets:
            raise ValueError(f"unknown bucket {bucket!r} for span {span!r}")
        self.buckets[bucket].add(value)
        # `setdefault`, so ``routes`` is FIRST-WINS per distinct span text. The
        # same span can legitimately route differently on two lines, because
        # ``ctx`` -- the directory carried over from the preceding span on the
        # line -- differs. That is not a silent drop: the VALUE is added to its
        # bucket either way, so a second routing to ``unresolved`` still fails
        # the gate. Only the printed per-bucket tally is first-wins, and it is
        # labelled "distinct span(s)" for exactly that reason.
        self.routes.setdefault(span, bucket)

    @property
    def found(self):
        return self.buckets["found"]

    @property
    def unresolved(self):
        return self.buckets["unresolved"]

    @property
    def dropped(self):
        return self.buckets["dropped"]

    def __iter__(self):
        return iter((self.found, self.unresolved, self.dropped))


def extract(path, tracked, by_base, by_suffix, new, top_dirs, tracked_dirs=frozenset()):
    """Split a plan's backticked candidates into resolved paths and leftovers.

    Unpacks as ``(found, unresolved, dropped)``. Every span the file contains is
    routed to exactly one bucket -- see the NO-VANISH CONTRACT above.
    """
    result = Spans()
    new_basenames = {n.rsplit("/", 1)[-1]: n for n in new}
    try:
        fh = open(path, encoding="utf-8")
    except OSError as exc:
        # A plan the tool cannot open is an UNSCANNED plan. Status 2, never a
        # zero-span pass -- the same "refusing to certify an unscanned tree"
        # rule both shell gates enforce.
        raise ScanError(f"cannot read plan {path!r}: {exc}") from exc
    with fh:
        for line in fh:
            ctx = None
            for span in BACKTICK_RE.findall(line):
                bucket, value, ctx = classify_span(
                    span, ctx, tracked, by_base, by_suffix, new, new_basenames,
                    top_dirs, tracked_dirs,
                )
                result.record(span, bucket, value)
    return result


def surfaces(tracked):
    def t(pre):
        return {q for q in tracked if q.startswith(pre)}

    surface = {
        # S1 edits the Makefile too (one task in the slice rewrites a help target),
        # so the Makefile belongs in this surface, not only in S3's.
        "S1 docs": t("docs/build/") | t("docs/design/") | t("docs/runbooks/")
        | t("dashboard/docs/") | {
            "README.md", "dashboard/README.md", "ARCHITECTURE.md", "STATUS.md",
            "BACKLOG.md", "DESIGN-BRIEF.md", "HANDOFF-REVIEW.md",
            "REVIEW-RESPONSE.md", "planned-files-m2-11.json", "Makefile"},
        # S2 is documentation-only and explicitly forbidden from editing
        # checks.yml or the governance test; those are VERIFY_ONLY (below), and a
        # file it never changes must not inflate its blocked count.
        "S2 CI": {"README.md"},
        "S3 scripts": t("scripts/") | {
            "Makefile", "pyproject.toml", "docs/runbooks/self-hosted-runner.md",
            "docs/runbooks/rollback.md", "docs/runbooks/attestation.md",
            "src/populus/parse/__init__.py", "src/populus/mcp_server/__init__.py"},
        "S4 comments": t("src/") | t("dashboard/src/"),
        "S5 mcp": t("src/populus/mcp_server/"),
        "S6 ui/css": {
            "dashboard/src/lib/ui.ts", "dashboard/src/styles/global.css",
            "dashboard/src/layouts/Base.astro",
            "dashboard/src/scripts/entity-client.ts"} | t("dashboard/test/"),
    }
    verify_only = {
        "S2 CI": {".github/workflows/checks.yml", "tests/test_workflow_governance.py"},
    }
    return surface, verify_only


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ref", default="origin/main",
                    help="baseline git ref for the tracked file set (default: origin/main)")
    ap.add_argument("--plan", action="append", default=[], metavar="KEY=PATH",
                    help="override a run's plan path, e.g. --plan sec=/tmp/plan.md")
    ap.add_argument("--show-dropped", action="store_true",
                    help="list the backticked spans that resolved to nothing and are "
                         "not path-shaped -- prose, shell fragments, flag names, MIME "
                         "types (normally reported only as a count)")
    args = ap.parse_args(argv)

    plans = dict(RUNS)
    for spec in args.plan:
        key, _, path = spec.partition("=")
        if not path:
            ap.error(f"--plan expects KEY=PATH, got {spec!r}")
        plans[key] = path

    tracked = load_tracked(args.ref)
    by_base: dict[str, list[str]] = {}
    by_suffix: dict[str, list[str]] = {}
    for q in tracked:
        by_base.setdefault(q.rsplit("/", 1)[-1], []).append(q)
        parts = q.split("/")
        for i in range(1, len(parts)):
            by_suffix.setdefault("/".join(parts[i:]), []).append(q)

    # Top-level entries of the baseline tree. Used only to decide whether an
    # UNRESOLVED slashed token is worth reporting as a repository path.
    top_dirs = frozenset(q.split("/", 1)[0] for q in tracked)
    tracked_dirs = frozenset(
        "/".join(q.split("/")[:i])
        for q in tracked
        for i in range(1, len(q.split("/")))
    )

    owned, bad, unresolved_total = {}, False, 0
    for key, plan in plans.items():
        new = NEW.get(key, set())
        spans = extract(plan, tracked, by_base, by_suffix, new, top_dirs, tracked_dirs)
        got, unres, dropped = spans
        owned[key] = got | (PROSE.get(key, set()) & tracked)
        # The no-vanish accounting, printed so the contract is checkable from the
        # command line rather than only from a test. `routes` carries one entry
        # per DISTINCT backticked span; every one of them named a bucket.
        if args.show_dropped:
            # Counted by SPAN, not by resolved value, so the parts sum to the
            # whole: several distinct spans routinely resolve to one path
            # (`_headers`, `/_headers`, `dashboard/public/_headers`), and a
            # per-bucket set size would not add up to the span total.
            tally = {b: 0 for b in BUCKETS}
            for b in spans.routes.values():
                tally[b] += 1
            print(f"routes: {key}: {len(spans.routes)} distinct span(s) -> "
                  + ", ".join(f"{b}={tally[b]}" for b in BUCKETS)
                  + f"  (sum={sum(tally.values())}, unaccounted=0 by construction)")
        # Report EVERY unresolved token. Filtering the report by "looks like a path"
        # is how bare root filenames disappeared unnoticed.
        leftover = {u for u in unres if u not in new}
        if leftover:
            print(f"UNRESOLVED in {key} (classify each: NEW, PROSE or IGNORE):")
            for u in sorted(leftover):
                print("   ", u)
            bad = True
            unresolved_total += len(leftover)
        # Never silent: non-path-shaped leftovers are always at least counted.
        # This is the CATCH-ALL bucket, so the count grew when the vanish class
        # was closed -- the spans it now holds were previously reported nowhere.
        if dropped:
            print(f"note: {key}: {len(dropped)} backticked span(s) resolved to "
                  f"nothing and are not path-shaped (--show-dropped to list)")
            if args.show_dropped:
                for d in sorted(dropped):
                    print("     -", d)

    surface, verify_only = surfaces(tracked)
    for name, fs in surface.items():
        fs &= tracked
        a, b = fs & owned.get("sec", set()), fs & owned.get("i2", set())
        # BLOCKED is the UNION, never the sum. An earlier revision published a
        # SUM for Slice 4; the two sets overlap, so the sum overstates it. The
        # live measurement is SEC=23, I2=35, BOTH=13, so blocked is 23+35-13=45
        # and the free set is 87 -- not the 39/93 an earlier draft of this
        # comment quoted, which was itself superseded before it was written down.
        # Print BOTH and the union so that error cannot recur silently.
        print(f"{name:13s} surface={len(fs):3d}  SEC={len(a):2d}  I2={len(b):2d}  "
              f"BOTH={len(a & b):2d}  BLOCKED(union)={len(a | b):2d}  "
              f"FREE={len(fs - (a | b)):3d}")
        for k, v in (("sec", a), ("i2", b)):
            if v:
                print(f"    {k}: {', '.join(sorted(v))}")
        if a & b:
            print(f"    both: {', '.join(sorted(a & b))}")
        vo = verify_only.get(name, set()) & tracked
        if vo:
            print(f"    verify-only (not edited by this slice): {', '.join(sorted(vo))}")
        if name.startswith("S4"):
            print(f"    -> 4a free={len(fs - (a | b))}   4b blocked={len(a | b)}")
    if bad:
        # A summary on stderr, matching both shell gates' reporting shape: the
        # findings go to stdout, the verdict to stderr.
        print(f"cross_run_overlap: {unresolved_total} unresolved token(s) "
              f"across {len(plans)} plan(s)", file=sys.stderr)
    return 1 if bad else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ScanError as exc:
        # 2, never 1. See the CONTRACT block at the top of this file.
        print(f"cross_run_overlap: {exc}", file=sys.stderr)
        sys.exit(2)
