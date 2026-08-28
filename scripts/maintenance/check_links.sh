#!/usr/bin/env bash
# Inbound-reference gate for large documentation moves.
#
# Usage:
#   check_links.sh          scan the working tree (tracked + untracked)
#   check_links.sh -h       print this header
#
# EXIT STATUS -- three outcomes, never two. The same 0/1/2 split
# check_abs_paths.sh and cross_run_overlap.py use:
#   0  scanned successfully, no broken reference found
#   1  scanned successfully, at least one broken reference found. Reported with
#      `BROKEN LINK:` / `BROKEN REF:` on stdout, one line each.
#   2  COULD NOT SCAN -- bad usage, or a temp file, a git command, a SCANNER or
#      a read failed. Nothing is certified.
#
# --- CONTRACT ---------------------------------------------------------------
#
# WHAT THIS GUARANTEES
#   G1  Every Markdown link destination in every tracked-or-untracked `*.md`
#       file resolves to something that exists -- inline `](...)` and
#       reference-style `[id]: ...` alike, relative to the DOCUMENT's own
#       directory, with root-absolute destinations resolved against the repo
#       root and never falling back between the two.
#       Pinned by: test_links_nested_relative_link_fails,
#                  test_links_reference_style_broken_definition_fails,
#                  test_links_reference_style_valid_definition_passes.
#   G2  Every repo-root-relative script/doc path named in the Makefile or a
#       workflow file exists.
#       Pinned by: test_links_script_only_violation_fails,
#                  test_links_tracked_broken_link_and_missing_script_fail.
#   G3  Every external command's FAILURE is distinguishable from its NO-MATCH
#       and reaches the caller as status 2.
#       Pinned by: test_links_cannot_scan_exits_two,
#                  test_links_failing_markdown_scanner_exits_two,
#                  test_links_failing_reference_scanner_exits_two,
#                  test_links_no_match_is_not_a_scanner_error.
#   G4  Untracked files are scanned, so a candidate branch's new documents are
#       covered before they are staged.
#       Pinned by: test_links_untracked_file_is_scanned.
#
# WHAT THIS DELIBERATELY DOES NOT COVER
#   N1  Fenced and inline CODE. Markdown ABOUT Markdown legitimately contains
#       `](`, and a code-blind parser reported this repository's own fixture
#       table as broken. Pinned by test_links_fenced_and_inline_code_are_skipped.
#   N2  Any destination carrying a URI SCHEME (`https:`, `mailto:`, `tel:`,
#       `data:`, ...) or protocol-relative `//host/path`, and any bare `#anchor`.
#       Off-tree by definition. Pinned by test_links_uri_schemes_are_not_paths.
#   N3  ANCHOR VALIDITY. `docs/x.md#missing-heading` is checked as far as
#       `docs/x.md`; whether the heading exists is not checked.
#   N4  Path mentions in SOURCE files. A `src/lib/x.ts` string there is a module
#       specifier relative to its own package, not a repo path; scanning them
#       yielded 130+ false positives, and a gate that can never be green is
#       worse than no gate. Scope is the Makefile and workflow files only.
#   N5  Extensions outside `.py .sh .md .yml` in the executable-reference scan,
#       and non-`*.md` documentation. Deliberately narrow, same reason as N4.
#   N6  A file tracked in the index but absent from the worktree. It cannot be
#       read, and a file that does not exist has no outgoing links.
#
# Status 2 exists because the previous version was fail-OPEN: if `mktemp`
# failed, TMPFAIL was empty, every redirection into it failed silently, the
# final `[ -s "$TMPFAIL" ]` was false and the gate exited 0 -- certifying a tree
# it had never scanned. A gate that reports success on an unscanned tree is the
# exact silent-pass defect class this tooling exists to eliminate, so EVERY
# required command below is checked and any failure is a hard 2.
#
# The SAME fail-open class lived one level down, at the scanner layer, until it
# was fixed here too. `pipefail` is set but `errexit` is NOT, and both scanning
# pipelines -- the markdown `awk | while read` and the executable-reference
# `grep | sed | sort | while read` -- had their exit status discarded. The
# verdict was taken solely from whether TMPFAIL was non-empty, so an awk, grep,
# sed, sort or read failure produced an empty TMPFAIL and a confident exit 0
# over an INCOMPLETE scan. Every scanner below now writes to a temp file whose
# status is captured and checked before anything iterates over it.
#
# `grep` status 1 means "no match", which is a NORMAL outcome here (a Makefile
# that names no script). Only status >1 is a scanner error. `awk` has no such
# convention: any non-zero status from it is an error.
set -uo pipefail

die() { echo "check_links: $*" >&2; exit 2; }

# The help text is read out of this file's own header by pure bash -- no `sed`
# with a hardcoded line range whose status nobody checks. See the same function
# in check_abs_paths.sh; the two gates behave identically on `-h`.
usage() {
  local line
  [ -r "$0" ] || return 1
  while IFS= read -r line; do
    case "$line" in
      '#!'*) continue ;;
      '#') echo "" ;;
      '# '*) printf '%s\n' "${line#\# }" ;;
      *) return 0 ;;
    esac
  done < "$0"
  return 0
}

# This gate takes NO arguments. It used to ACCEPT any and ignore them in
# silence, so `check_links.sh --worktree` -- the spelling its sibling gate
# requires -- scanned the tree and reported success while the operator believed
# a mode had been selected. An unrecognised argument is a usage error.
if [ $# -gt 0 ]; then
  case "$1" in
    -h|--help) usage || die "cannot read '$0' to print its help"; exit 0 ;;
    *) echo "check_links: unexpected argument '$1' (this gate takes none)" >&2
       exit 2 ;;
  esac
fi

# `mktemp` with NO template is not governed by TMPDIR on this host: BSD mktemp
# resolves the darwin per-user temp dir via confstr() and ignores the variable
# entirely, so a deliberately-unusable TMPDIR could not even reach the failure
# path. An explicit template under $TMPDIR makes the setup failure real,
# reproducible and testable on both BSD and GNU mktemp.
TMPROOT="${TMPDIR:-/tmp}"
TMPROOT="${TMPROOT%/}"

TMPFAIL="$(mktemp "$TMPROOT/check_links.fail.XXXXXX")" \
  || die "cannot create a temp file under '$TMPROOT' -- refusing to certify an unscanned tree"
FILES="$(mktemp "$TMPROOT/check_links.files.XXXXXX")" \
  || { rm -f "$TMPFAIL"; die "cannot create a temp file under '$TMPROOT'"; }
trap 'rm -f "$TMPFAIL" "$FILES"' EXIT
# Scanner output buffers. They exist so each scanner's exit status can be read
# BEFORE its output is consumed; a pipeline into `while read` throws that status
# away unless it is captured, and that is precisely what defect 2 was.
SCAN="$(mktemp "$TMPROOT/check_links.scan.XXXXXX")" \
  || { rm -f "$TMPFAIL" "$FILES"; die "cannot create a temp file under '$TMPROOT'"; }
REFS="$(mktemp "$TMPROOT/check_links.refs.XXXXXX")" \
  || { rm -f "$TMPFAIL" "$FILES" "$SCAN"; die "cannot create a temp file under '$TMPROOT'"; }
trap 'rm -f "$TMPFAIL" "$FILES" "$SCAN" "$REFS"' EXIT
: > "$TMPFAIL" || die "cannot write to '$TMPFAIL'"

git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a git work tree"

rc=0
# `-c core.quotePath=false`: without it git renders a non-ASCII path as an
# OCTAL-ESCAPED, double-quoted name, which `[ -f "$f" ]` then fails -- so a real
# document would be skipped in silence rather than scanned. See N6 for the one
# skip that IS deliberate.
list() {
  git -c core.quotePath=false ls-files --cached --others --exclude-standard -- "$@"
}

# (1) Markdown links, fenced code EXCLUDED.
#     Fenced blocks must be skipped: this plan embeds a shell script whose own
#     sed contains `](`, which an unfenced-blind parser reports as a broken link
#     to `//; s/`. A gate that fails on its own documentation is unusable.
list '*.md' > "$FILES" || die "git ls-files failed while listing markdown files"
# Second, independent guard on the file list -- see the identical block in
# check_abs_paths.sh. Written as a PRE-loop test, never as
# `done < "$FILES" || die`: a `while` returns the status of the last command
# its body ran, so the `||` form fires on ordinary clean input.
{ [ -n "$FILES" ] && [ -r "$FILES" ]; } \
  || die "the file list is missing or unreadable -- refusing to certify a partial scan"
while IFS= read -r f; do
  [ -n "$f" ] || die "the markdown file list contains an empty path -- refusing to certify a partial scan"
  # N6: tracked in the index, absent from the worktree. Not a silent drop of
  # something scannable -- there is nothing to read, and a file that does not
  # exist has no outgoing links. Every OTHER reason a file could be skipped is
  # a `die` above or below.
  [ -f "$f" ] || continue
  awk -v F="$f" '
    function resolve(tgt,   dir, base) {
      # OFF-TREE destinations, skipped by construction. The list used to be
      # `https?:`, `mailto:` and `#` ALONE, so every other URI scheme -- `tel:`,
      # `data:`, `ftp:`, `irc:`, `vscode:` -- and every protocol-relative
      # `//host/path` was resolved as if it were a relative FILE and reported as
      # a broken link. That is a false POSITIVE, and a gate that cries wolf gets
      # switched off exactly as fast as one that never fires. The rule is now
      # structural: anything carrying a URI scheme, anything protocol-relative,
      # and any bare fragment. See N2 in the header.
      if (tgt == "" || tgt ~ /^#/ || tgt ~ /^\/\// ) return
      if (tgt ~ /^[A-Za-z][A-Za-z0-9+.-]*:/) return
      dir = F; sub(/\/[^\/]*$/, "", dir); if (dir == F) dir = "."
      # Root-absolute links get their OWN rule; they are NOT a fallback for a
      # failed relative lookup. Silently falling back to repo root is how a
      # broken docs/nested/a.md -> README.md link passed.
      if (substr(tgt,1,1) == "/") base = substr(tgt,2); else base = dir "/" tgt
      print base
    }
    function flush(s,  n,i,arr,tgt) {
      n = split(s, arr, /\]\(/)
      for (i = 2; i <= n; i++) {
        tgt = arr[i]; sub(/\).*/, "", tgt); sub(/[ \t].*/, "", tgt); sub(/#.*/, "", tgt)
        resolve(tgt)
      }
    }
    # REFERENCE-STYLE link definitions: `[guide]: docs/guide.md "Title"`.
    # Only the inline `](...)` form was parsed before, so a standard Markdown
    # link form could be broken while the gate reported success.
    # Up to three leading spaces are allowed (four would be an indented code
    # block). The bound is spelled out rather than written as an interval
    # `{0,3}`, which not every awk on this host supports.
    function refdef(s,  tgt) {
      if (s !~ /^ ? ? ?\[[^]]+\][ \t]*:[ \t]*[^ \t]/) return
      tgt = s
      sub(/^[ \t]*\[[^]]+\][ \t]*:[ \t]*/, "", tgt)
      sub(/[ \t].*/, "", tgt)      # drop the optional title
      sub(/^</, "", tgt); sub(/>$/, "", tgt)
      sub(/#.*/, "", tgt)
      resolve(tgt)
    }
    /^[ \t]*(```|~~~)/ { infence = !infence; next }
    # Strip INLINE code spans too. Prose that discusses Markdown syntax legitimately
    # contains a backticked "](", and an inline-blind parser reports it as a broken
    # link -- this gate did exactly that against its own fixture table.
    !infence { line = $0; gsub(/`[^`]*`/, "", line); flush(line); refdef(line) }
  ' "$f" > "$SCAN"
  # Capture the scanner's status BEFORE consuming its output. Piping awk into
  # `while read` discarded this, so a broken awk yielded zero targets, an empty
  # TMPFAIL and a green gate over a file that was never parsed.
  ast=$?
  [ "$ast" -eq 0 ] || die "markdown scanner (awk) failed with status $ast on '$f' -- refusing to certify an incomplete scan"
  while IFS= read -r tgt; do
    [ -e "$tgt" ] || { echo "BROKEN LINK: $f -> $tgt"; echo x >> "$TMPFAIL" \
      || die "cannot append to '$TMPFAIL'"; }
  done < "$SCAN" || die "cannot read the markdown scanner output for '$f'"
done < "$FILES"

# (2) Executable repo-root path mentions. SCOPE IS DELIBERATELY NARROW: only the
#     Makefile and workflow files, where a path is genuinely repo-root-relative and
#     a moved script actually breaks execution (the publish.yml ->
#     scripts/fetch_legislators_cache.py class). Source files are EXCLUDED because
#     their "src/lib/x.ts" strings are module specifiers relative to their own
#     package, not repo paths -- scanning them yielded 130+ false positives and a
#     gate that can never be green is worse than no gate.
list Makefile '.github/workflows/*.yml' > "$FILES" \
  || die "git ls-files failed while listing Makefile/workflow files"
# Second, independent guard on the file list -- see the identical block in
# check_abs_paths.sh. Written as a PRE-loop test, never as
# `done < "$FILES" || die`: a `while` returns the status of the last command
# its body ran, so the `||` form fires on ordinary clean input.
{ [ -n "$FILES" ] && [ -r "$FILES" ]; } \
  || die "the file list is missing or unreadable -- refusing to certify a partial scan"
while IFS= read -r f; do
  [ -n "$f" ] || die "the Makefile/workflow file list contains an empty path -- refusing to certify a partial scan"
  [ -f "$f" ] || continue      # N6, as above
  # Three stages, three separately-checked statuses. The old form was one
  # `grep | sed | sort | while read` whose status was discarded entirely, and
  # its `2>/dev/null` also hid the diagnostic that would have explained a
  # failure. grep status 1 is "no match" -- a clean file, not an error.
  grep -oE '(^|[^A-Za-z0-9_./-])(scripts|docs|ops)/[A-Za-z0-9_./-]+[.](py|sh|md|yml)' "$f" > "$SCAN"
  gst=$?
  [ "$gst" -le 1 ] || die "reference scanner (grep) failed with status $gst on '$f' -- refusing to certify an incomplete scan"
  if [ "$gst" -eq 0 ]; then
    sed -E 's|^[^A-Za-z0-9_./-]||' "$SCAN" | sort -u > "$REFS"
    pst=$?          # pipefail: non-zero if EITHER sed or sort failed
    [ "$pst" -eq 0 ] || die "reference scanner (sed|sort) failed with status $pst on '$f' -- refusing to certify an incomplete scan"
    while IFS= read -r tgt; do
      [ -e "$tgt" ] || { echo "BROKEN REF: $f -> $tgt"; echo x >> "$TMPFAIL" \
        || die "cannot append to '$TMPFAIL'"; }
    done < "$REFS" || die "cannot read the reference scanner output for '$f'"
  fi
done < "$FILES"

[ -s "$TMPFAIL" ] && rc=1
exit $rc
