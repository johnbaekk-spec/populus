#!/usr/bin/env bash
# Machine-specific absolute-path gate.
#
# Replaces a one-liner from the professionalization plan that piped its finder
# through `grep -v <allowlist>`. That INVERTED the gate's exit code: `grep -v`
# exits 0 when at least one line survives the filter (i.e. a violation is
# present) and 1 when every line was filtered away (i.e. the tree is clean).
# The gate therefore passed exactly when it should have failed. This script
# never derives its verdict from a filter's exit status -- it counts surviving
# occurrences itself and returns 0 only when that count is zero.
#
# Usage:
#   check_abs_paths.sh [REF]        scan a git ref (default: origin/main)
#   check_abs_paths.sh --worktree   scan the working tree, including untracked
#
# EXIT STATUS -- three outcomes, never two:
#   0  scanned successfully, no machine-specific path found
#   1  scanned successfully, and either a machine-specific path was found or a
#      DETECTED line could not be fully parsed into occurrences (an ANOMALY --
#      see the DETECTED-BUT-UNCLASSIFIED block below). Both are reported with
#      file:line on stdout; a one-line summary goes to stderr.
#   2  COULD NOT SCAN -- bad usage, or a temp file / git command / SCANNER /
#      read failed. Nothing is certified.
#
# --- CONTRACT ---------------------------------------------------------------
#
# WHAT THIS GUARANTEES
#   G1  Every line DETECT_RE matches is either fully accounted for -- every
#       occurrence TOKEN_RE extracted from it was CLASSIFIED -- or reported.
#       There is no third outcome, and the decision is a COUNT COMPARISON that
#       consults no regular expression and no character class at all.
#       Pinned by: test_abs_paths_every_escape_spelling_is_reported,
#                  test_abs_paths_anomaly_rule_consults_no_character_class.
#   G2  Allowlisting is OCCURRENCE-level and CONTENT-keyed, and every exemption
#       is an EXACT STRING MATCH -- never a prefix, never a line NUMBER, never a
#       file path. One classified occurrence never certifies the rest of its
#       line.
#       Pinned by: test_abs_paths_allowlist_does_not_suppress_the_whole_line,
#                  test_abs_paths_allowlisted_path_does_not_mask_an_unparseable_one,
#                  test_abs_paths_anomaly_allowlist_is_content_keyed,
#                  test_abs_paths_service_account_prefix_escapes_are_reported.
#   G3  Every external command's FAILURE is distinguishable from its NO-MATCH
#       and reaches the caller as status 2.
#       Pinned by: test_abs_paths_cannot_scan_exits_two,
#                  test_abs_paths_failing_inner_scanner_exits_two,
#                  test_abs_paths_ref_mode_failing_sed_exits_two.
#   G4  Ref mode reports the REF's content and worktree mode reports the
#       working tree's, untracked files included.
#       Pinned by: test_abs_paths_ref_mode_reads_the_ref_not_the_worktree,
#                  test_abs_paths_scans_untracked_files_in_worktree_mode.
#
# WHAT THIS DELIBERATELY DOES NOT COVER
#   N1  Lines DETECT_RE never matches. A bare root with no terminating segment
#       (`/search/home/`, a `"/home/"` string literal at end of line) is out of
#       scope BY DESIGN -- it names no machine. Widening DETECT_RE to catch it
#       would make `src/populus/ingest/senate.py` permanently red.
#   N2  Machine paths that are not one of the three roots DETECT_RE names --
#       `/opt/homebrew/...`, `C:\Users\...`, `~/projects/...`. Out of scope.
#   N3  docs/build, docs/design and docs/maintenance (EXCLUDES below): in-flight
#       working documents that quote owner-machine paths by design.
#   N4  Representations this gate does not decide. It is a text scanner over a
#       line of bytes; FOUR families are outside what that can decide, and are
#       named here rather than pretended away. Measured at exit 0, both modes:
#
#         * VARIABLE-ROOTED concatenation -- `P=$PREFIX/Users/john/projects/x`.
#           The bytes before the root are an ordinary segment, exactly as in the
#           legitimate relative `cache-/Users/john/projects/x`. Deciding between
#           them requires knowing whether $PREFIX is empty.
#         * STRING-LITERAL concatenation -- `P="/Users" + "/john/projects/x"`.
#           Neither literal names a machine; only their concatenation does, and
#           concatenation is a language operation, not a lexical one.
#         * ESCAPED or ENCODED spellings -- `P="\x2fUsers\x2fjohn\x2fprojects"`,
#           and by the same argument /, %2f and base64.
#         * ABUTTING-SEGMENT-CHARACTER -- a LITERAL path whose root is preceded
#           directly by a character that could itself end a relative path
#           segment: `Owner path--/Users/john/projects/x` (em dash),
#           `Owner path->/Users/john/projects/x` (arrow), and
#           `Owner path!/Users/john/projects/x` (bang). Added after F32; see
#           the paragraph below for why this is a boundary, not an oversight.
#
#       R3's stated scope is therefore paths written LITERALLY in a single
#       source line AND STARTING AT A BOUNDARY -- start of line, or one of the
#       BOUNDCH characters (whitespace, quote, bracket, shell metacharacter, or
#       a path separator). It is not a defence against a contributor who
#       deliberately encodes one, nor against one who abuts a path onto prose
#       punctuation; it is a defence against the ordinary accident of pasting a
#       machine path. Closing the first three would mean interpreting the host
#       language, which this tool does not and will not do.
#
#       --- WHY THE FOURTH IS A BOUNDARY (defect F32) ------------------------
#       The fourth family is a different argument and deserves its own, because
#       (This file stays ASCII on purpose, as it does for `cafe(acute)` above,
#       so `--` below spells the em dash U+2014 and `->` the arrow U+2192. The
#       real bytes live in the test fixtures, not here.)
#
#       the obvious objection is right: `--`, `->` and `!` are DISTINCT BYTES
#       from `-` and from the acute `e`, so a character class CAN separate
#       `path--/Users/x` from `cache-/Users/x`. That was measured, not assumed:
#       adding those three characters to BOUNDCH does flag all three F32 lines.
#
#       It was rejected anyway, on measurement. POSIX permits every byte except
#       `/` and NUL in a filename, so `notes--`, `build!` and `step->` are all
#       legal directory names -- created on this machine to check, not reasoned
#       about -- and with the widened class all three of
#
#           notes--/Users/john/x      build!/Users/john/x      step->/Users/john/x
#
#       are reported as machine paths. Those are ordinary RELATIVE strings. The
#       widened class therefore buys three true positives at the price of three
#       FALSE ones, which is precisely the F27 trade that made this gate
#       unpassable on `cafe(acute)/` and `cache-/` and had to be reverted. A
#       fourth adjustment of the same class would be the same mistake a fourth
#       time.
#
#       The reason no character class can settle it is that the question is not
#       about the byte. `path--/Users/x` and `cache-/Users/x` differ only in
#       whether the run before the root is English prose or a directory name,
#       and that is a fact about MEANING, not about bytes. Deciding it needs
#       source context -- is this line inside a string literal, is that run a
#       word -- across markdown, Python, TypeScript, Astro, shell and YAML,
#       which is the same "interpret the host language" line the first three
#       families sit behind.
#
#       So the claim is NARROWED rather than the class widened: a root that
#       abuts a segment character does not start a detected path, exactly as
#       `/search/home/` does not. NOTSEG is one rule with one consequence in
#       both directions, and this is the cost side of it, now written down.
#       Pinned by the ABUTTING entries in UNSUPPORTED_REPRESENTATIONS.
#   N5  Filenames containing a newline. git grep -l cannot express them on a
#       line-oriented list; such a name makes `read_file` fail and the gate
#       exits 2. Fail-CLOSED, never a silent skip.
#   N6  The gate's own two self-referencing files -- `SELF_EXCLUDES` below --
#       are not scanned. A real owner path pasted into either of them is
#       therefore NOT caught. See the SELF-REFERENCE EXCLUSION block for the
#       decision, the alternative it replaced, and the size of the blind spot.
#
# The outer `git grep` has always distinguished status 1 (no match: a clean
# tree) from status >1 (a real failure). The THREE INNER grep stages did not,
# and neither did the ref-mode `sed` that strips the `<ref>:` prefix from the
# finder's output -- it ran in a pipeline whose only checked status was
# `PIPESTATUS[0]`, so a failing `sed` yielded an empty file list and a confident
# exit 0 over a ref that was never opened. FOUR stages, four checked statuses:
# `grep -oE` ran inside a `$(...)` command substitution, `grep -qE` mapped every
# non-zero status onto `continue` so an error was indistinguishable from a
# no-match, and `grep -nE` ran inside a `< <(...)` process substitution. None of
# the three could expose status 2 to the parent shell, so a scanner failure
# yielded zero tokens, a zero count and a confident exit 0 over content that was
# never evaluated -- the same fail-open class as the mktemp defect above, one
# level down. Each inner scanner now writes to a temp file whose status is read
# and classified before anything iterates over it.
#
# Status 2 exists because the previous version was fail-OPEN on setup failure:
# if `mktemp` failed, FILELIST and COUNTS were empty strings, the scan loop read
# nothing, `wc -l < ""` failed, and the verdict was decided by an unguarded
# integer comparison on an empty variable -- observed exiting both 0 and 1,
# which is itself proof the path was unhandled rather than deliberate. Every
# required command below is now checked and any failure is a hard 2.
#
# The working-tree mode exists so a candidate branch can be verified before it
# is merged; a gate that can only inspect the pinned baseline cannot protect
# the change that is actually being proposed.
set -uo pipefail

die() { echo "check_abs_paths: $*" >&2; exit 2; }

REF="origin/main"
MODE="ref"
REF_GIVEN=0
# The help text is printed by a pure-bash reader, not by `sed -n '2,30p'`. Two
# reasons, both defects of the form this file exists to prevent: a hardcoded
# line range silently prints the WRONG text the moment the header grows (it
# already had), and `sed`'s status was discarded, so `-h` exited 0 even when it
# printed nothing at all.
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
while [ $# -gt 0 ]; do
  case "$1" in
    --worktree) MODE="worktree" ;;
    -h|--help) usage || die "cannot read '$0' to print its help"; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    # A SECOND positional argument used to overwrite the first in silence, so
    # `check_abs_paths.sh main origin/main` scanned only the last one and the
    # operator was never told which ref was actually certified.
    *) [ "$REF_GIVEN" -eq 0 ] || die "at most one REF may be given (got '$REF' and '$1')"
       REF="$1"; REF_GIVEN=1 ;;
  esac
  shift
done
[ "$MODE" = "ref" ] || [ "$REF_GIVEN" -eq 0 ] \
  || die "--worktree and a REF are mutually exclusive (got REF '$REF')"

# --- SELF-REFERENCE EXCLUSION (owner decision K8) ----------------------------
#
# This gate and its test suite both have to SPELL the paths the gate detects --
# a detector cannot be written without naming what it detects, and a test cannot
# assert a violation is reported without containing one. Scanning them makes the
# gate permanently red on any tree that carries them, and a gate that can never
# be green gets switched off.
#
# The previous revision solved that by writing every root as a two-fragment
# concatenation -- `"/Users" "/"` -- in both files. That worked, and the owner
# has REJECTED it: the trick is implicit, invisible at the point of use, and a
# contributor adding a test case cannot be expected to know that a literal
# spelling will redden an unrelated gate. It is a booby trap for the next reader.
#
# The sanctioned mechanism is an EXPLICIT, DOCUMENTED exclusion of exactly two
# files, listed here by name and nowhere else:
#
#     scripts/maintenance/check_abs_paths.sh   -- this file
#     tests/test_maintenance_tooling.py        -- its test suite
#
# THE BLIND SPOT THIS ACCEPTS, stated plainly because an exclusion nobody has
# measured is indistinguishable from a bug: a REAL owner-machine path pasted
# into either of these two files is NOT reported. Nothing else in the tree gains
# that exemption -- it is two named files, not a directory, not a glob, and not
# a pattern that can drift onto a third file. Both are reviewed source in this
# program's own scope, and both already contain machine-path literals by
# construction, so a reviewer reading them cannot distinguish a fixture from a
# leak by eye either; the exclusion changes who is responsible, not whether the
# risk existed. Named as N6 in the header.
#
# It is deliberately NOT `:(exclude)scripts/maintenance/*` or a tests glob: a
# directory-shaped exclusion would silently swallow the next file added beside
# them, which is how N3's docs exclusions grew and why they are the coarsest
# thing in this file.
SELF_EXCLUDES=(
  ':(exclude)scripts/maintenance/check_abs_paths.sh'
  ':(exclude)tests/test_maintenance_tooling.py'
)

# Detection: the two home roots and the macOS private temp root. Written
# LITERALLY -- see SELF-REFERENCE EXCLUSION above for why that is now safe.
TMPROOT="/private/tmp"
USERS_ROOT="/Users/"
HOME_ROOT="/home/"
TMP_ROOT="$TMPROOT/"

# --- WHAT A TOKEN IS MADE OF, AND WHAT ENDS ONE ------------------------------
#
# A segment character is defined by EXCLUSION rather than by whitelist, so every
# byte a filesystem permits -- UTF-8 included -- is inside a token by default,
# and no future spelling of a home directory can silently fall outside the
# class. A token ends at the first character that cannot be part of a path as it
# is WRITTEN in source: whitespace, the quote characters that delimit a string
# literal or a Markdown code span, and the bracketing/shell metacharacters that
# can only sit AROUND a path in these files.
SQ="'"
# `]` immediately after `^`, and `[` immediately after that: both are then
# literal members of the bracket expression rather than delimiters. The
# `[:space:]` class covers tab as well as the plain space.
SEGCH="[^][/[:space:]\"\`<>|(){},;:*?=\$\\$SQ]"
# BOUNDCH is the EXACT COMPLEMENT of SEGCH -- the same characters, without the
# leading `^`. The two must be edited together; test_abs_paths_boundary_is_the_
# complement_of_the_segment_class asserts they are, character for character.
BOUNDCH="[][/[:space:]\"\`<>|(){},;:*?=\$\\$SQ]"

# --- A ROOT ONLY STARTS A PATH WHEN IT IS NOT THE TAIL OF A LONGER ONE -------
#
# `/search/home/` in a Senate eFD URL is not a home directory; it is a URL path
# whose LAST segment happens to be the word `home`. The distinguishing fact is
# structural: a home root is preceded by nothing, or by a character that cannot
# be part of the preceding path segment. In `/search/home/` it is preceded by
# `h`.
#
# NOTSEG is that rule, and it is the ONLY narrowing this file makes to
# detection. It was forced by measurement, not by taste: once the anomaly rule
# stopped consulting a character class, five real lines went red for this exact
# reason and NONE of them named a machine --
#
#     ARCHITECTURE.md:429, :973      `/search/home/` in the eFD handshake notes
#     HANDOFF-REVIEW.md:16           the same URL, quoted in a review table
#     tests/test_maintenance_tooling.py:648, :990   the same URL in docstrings
#
# All five bridged: `[^/]+` ran from the false root across prose to an unrelated
# later `/` on the same line. Two of those files are owned by other runs and
# cannot be edited here, so a content-keyed exemption would have pinned this gate
# to five long prose lines and gone red the next time anyone touched ARCHITECTURE.md.
#
# --- WHY IT IS NOT `[^A-Za-z0-9_]` ANY MORE (defect F27) ---------------------
#
# It was, and that was the SAME ASCII-character-class mistake the anomaly rule
# had just been rewritten to remove, relocated one layer down. An ASCII not-word
# class is not a statement about paths; it is a statement about English
# identifiers, and it is wrong in both directions. Measured on the previous
# revision, both modes:
#
#     cafe(acute)/Users/john/projects/x   exit 1   FALSE POSITIVE
#     cache-/Users/john/projects/x        exit 1   FALSE POSITIVE
#
# Both are ordinary RELATIVE strings -- a directory whose name ends in a
# non-ASCII letter, and one whose name ends in a hyphen. Neither names a
# machine, and both made the gate UNPASSABLE on legitimate content, which is
# the worst outcome a gate has: the way out is to switch it off.
#
# The right question is not "is the preceding byte a word character" but "could
# the preceding byte have been part of the preceding path segment". That
# question already has ONE answer in this file -- SEGCH -- so NOTSEG is its
# complement, and there is no second class to keep in step by hand:
#
#     a root starts a path iff it is at start of line, or the byte before it is
#     NOT a segment character.
#
# `e` with an acute accent and `-` are both segment characters, so both false
# positives are gone. `h` in `/search/home/` is a segment character, so the
# benign live cases stay green. `/` is NOT a segment character, so a `file:`
# URL's triple slash still opens a path. And because SEGCH is exclusion-based,
# EVERY non-ASCII byte is a segment character: the class can never again be
# wrong about an alphabet nobody thought of.
#
# What this does NOT do is recognise a root reached by concatenation or by an
# escape sequence -- see N4. `$PREFIX/Users/john/x` is byte-for-byte the same
# shape as `cache-/Users/john/x`, and no boundary rule can separate them
# without evaluating the source.
#
# The SAME rule has a cost in the other direction, and F32 is it: a root abutted
# onto prose punctuation -- `Owner path<em-dash>/Users/john/projects/x` -- is
# NOT detected either, because an em dash is a legal filename byte and therefore
# a segment character. That is family four of N4, and the measured reason the
# fix is not a fourth edit to this class is written out there.
#
# Pinned by test_abs_paths_root_inside_a_longer_path_is_not_detected,
# test_abs_paths_legitimate_relative_segment_before_a_root_is_clean, and by the
# unchanged 22-occurrence baseline ground truth.
NOTSEG="(^|$BOUNDCH)"

# DETECT_RE is the coarse file- and line-level prefilter; KEEP_RE is what
# actually qualifies an extracted occurrence as a violation. They differ on
# purpose, and the difference is what makes a bare root at end of line -- no
# terminated following segment -- correctly invisible to the scan.
#
# The segment is ANY non-slash run. An earlier `[a-z]+` version matched only
# all-lowercase-alpha names and therefore missed `JohnDoe`, `john-doe`, `john2`
# and `john_doe` -- four spellings a real home directory routinely has.
DETECT_RE="$NOTSEG($USERS_ROOT[^/]+/|$HOME_ROOT[^/]+/|$TMP_ROOT)"

# --- OCCURRENCE EXTRACTION (defect F24) -------------------------------------
# TOKEN_RE grabs the MAXIMAL path-shaped run starting at one of the three roots,
# so an occurrence can be compared against the allowlist as a whole path rather
# than as a truncated prefix.
#
# NOTE ON SPELLING BELOW. The examples in these comments write the root as `<R>`
# -- read it as any of the three roots DETECT_RE names. That is a READABILITY
# convention only: since the K8 exclusion this file is no longer scanned, so a
# literal spelling would be harmless. It is kept because `<R>` says "any of the
# three" in one character, which three separate examples would not.
#
# The previous TOKEN_RE spelled its segments as an ASCII whitelist,
# `(/[A-Za-z0-9._~%+@-]+)*`, which CONTRADICTED the contract stated a few lines
# up -- "the segment is ANY non-slash run" -- and made the gate fail OPEN.
# Measured in a throwaway repository, worktree mode:
#
#     <R>/John Doe/projects/Populus/data.db    -> exit 0   ESCAPED
#     <R>/Jose(-acute)/projects/Populus/data.db -> exit 0  ESCAPED, non-ASCII
#     <R>/johndoe/projects/Populus/data.db     -> exit 1   caught
#
# The line prefiltered IN through DETECT_RE (whose `[^/]+` was already correct),
# then the whitelist truncated the occurrence to `<R>/John`. That has no second
# slash, so KEEP_RE rejected it and the occurrence was never reported -- a
# violation detected at file level and then discarded at occurrence level. A
# space and a non-ASCII character are both ordinary in a macOS home directory
# name, so this was a real-world escape, not a theoretical one.
#
# WHAT TERMINATES A TOKEN NOW, AND WHY
#
# A segment character is defined by EXCLUSION rather than by whitelist, so every
# byte a filesystem permits -- UTF-8 included -- is inside a token by default,
# and no future spelling of a home directory can silently fall outside the
# class. A token ends at the first character that cannot be part of a path as it
# is WRITTEN in source, rather than as it exists on disk:
#
#   * whitespace (see the home-segment exception below);
#   * the quote characters that delimit a string literal or a Markdown code
#     span -- " ' ` -- so `P = "<R>/x/y"` and a backticked `<R>/x/y` both
#     extract to the bare path;
#   * the bracketing, punctuation and shell metacharacters that can only sit
#     AROUND a path in these files, never inside one:
#     < > | ( ) { } [ ] , ; : * ? = $ \
#     -- this is what makes a Markdown link `[db](<R>/x/y)` and a line-qualified
#     citation `<R>/x/y:12` extract sensibly rather than dragging the delimiter
#     or the line number into the token;
#   * end of line, which needs no rule of its own: grep is line-oriented.
#
# A SPACE is the one terminator that has to be relaxed, and it is relaxed for
# the HOME SEGMENT ONLY -- the single segment the contract above describes, and
# the one this defect is about. There, interior SINGLE spaces are allowed, with
# no leading and no trailing space, so `<R>/John Doe/` extracts whole. Every
# LATER segment still ends at a space. The asymmetry is deliberate: it is
# exactly what stops the relaxation from over-capturing prose.
#
#   * A home segment can never cross a `/`, and a later segment can never cross
#     a space. A SECOND machine path further along the same line is always
#     preceded by whitespace and begins with `/`, so it can never be absorbed
#     into the first token. That is what keeps the occurrence-level allowlist
#     honest, and it is pinned by the both-paths-on-one-line regression and by
#     the no-merge fixture.
#   * Prose that merely mentions `<R>/John` with no second slash DOES
#     over-capture into the sentence, and KEEP_RE then rejects the result for
#     having no TERMINATED home segment. On its own that line never enters the
#     scan at all -- DETECT_RE also requires a terminated segment. If some OTHER
#     root on the same line brought it in, the rejected occurrence is now an
#     UNCLASSIFIED one and the line is reported as an anomaly. Under the
#     previous revision it was silently dropped instead; reporting it is the
#     whole point of the count rule.
#   * A space inside a LATER segment (`<R>/johndoe/My Projects/db`) truncates
#     the token to `<R>/johndoe/My`, which KEEP_RE still MATCHES. Truncated in
#     the report, but REPORTED -- fail-closed. That is the property that
#     matters, and the one the home segment did not have.
#
# Detection is not weakened for anyone else: the new class is strictly wider
# than the whitelist it replaces, so every occurrence that used to be reported
# still is. Measured on the pinned baseline ref: 22 occurrences in 5 files both
# before and after.
# SEGCH and BOUNDCH are defined together, near NOTSEG above -- they are two
# halves of one decision and must not drift apart.
# The home segment: non-space runs joined by single spaces. Cannot begin or end
# with a space, so a path followed by ` /another/path` does not merge the two.
HOMESEG="$SEGCH+( $SEGCH+)*"
# TOKEN_RE carries the SAME NOTSEG rule as DETECT_RE. One definition of "a
# root starts a path here", applied at both layers -- not two. Without it,
# detection and extraction would disagree: a line containing BOTH a real machine
# path and a `/search/home/` URL would prefilter in on the real path, and the
# URL's false root would then extract as an unclassifiable bare-root occurrence
# and be reported as an anomaly. Pinned by
# test_abs_paths_false_root_beside_a_real_one_is_not_an_anomaly.
#
# NOTSEG's first alternative is empty (`^`) and its second consumes ONE
# character, so a token may carry a single BORROWED leading byte.
# `strip_boundary` gives it back.
TOKEN_RE="$NOTSEG/(Users|home|${TMPROOT#/})(/$HOMESEG)?(/$SEGCH+)*/?"
KEEP_RE="^($USERS_ROOT[^/]+/|$HOME_ROOT[^/]+/|$TMP_ROOT)"

# The old `strip_notword` decided by asking whether the token starts with `/`.
# That was correct only while `/` could not itself be a boundary character. It
# can -- a `file:` URL's triple slash -- and the raw token is then `//Users/...`,
# which the old rule kept verbatim; KEEP_RE rejects a doubled slash, so a real
# `file:///Users/...` path became an ANOMALY instead of a violation.
#
# The rule is now anchored on the ROOTS themselves, which is deterministic
# rather than a guess: a raw token already BEGINNING at a root was matched at
# start of line, and any other raw token carries exactly one borrowed byte. The
# two cannot be confused, because a borrowed `/` always produces a doubled
# slash and a root never contains one.
strip_boundary() {
  case "$1" in
    "$USERS_ROOT"*|"$HOME_ROOT"*|"$TMP_ROOT"*) printf '%s' "$1" ;;
    # The bare roots, which TOKEN_RE's trailing `/?` makes reachable.
    "/Users"|"/home"|"$TMPROOT") printf '%s' "$1" ;;
    *) printf '%s' "${1#?}" ;;
  esac
}

# --- DETECTED-BUT-UNCLASSIFIED IS AN ANOMALY (defect F24, third fix) ---------
#
# WHY THIS IS NOT ANOTHER PARSER IMPROVEMENT. F24 was fixed twice by widening
# the segment class -- first an `[a-z]+` whitelist, then an ASCII whitelist
# replaced by an exclusion list. Each round, review found another real spelling
# outside the new class. Measured on THIS revision's predecessor, worktree mode:
#
#     <R>/O(apostrophe)Neil/projects/Populus/db  -> exit 0   ESCAPED
#     <R>/John  Doe/projects/Populus/db (2 sp)   -> exit 0   ESCAPED
#     <R>/John(Doe)/projects/Populus/db          -> exit 0   ESCAPED
#
# All three are ordinary macOS home-directory spellings, and all three failed
# the same way: DETECT_RE prefiltered the line IN, TOKEN_RE truncated at the
# character it could not tokenise, KEEP_RE rejected the truncated remains for
# having no terminated home segment, and the line was then treated as CLEAN.
# "Classify arbitrary human prose correctly" has no terminus, so the class
# cannot be closed by a better SEGCH.
#
# WHY THE SECOND ROUND'S FIX WAS ALSO WRONG. That round had the right idea --
# invert the rule so failure to classify cannot hide -- but implemented it as
# `ANOM_RE`, a SECOND character-class check built from the same `SEGCH`: a line
# was an anomaly only when its residual still showed a root followed by a
# SEGMENT CHARACTER. That reintroduced exactly the dependency the inversion was
# meant to remove, and six more real spellings walked straight through it,
# measured at exit 0 in BOTH modes on the revision that shipped it:
#
#     <R>/"John Doe"/projects/x        exit 0   ESCAPED  (root then `"`)
#     <R>/(single-quoted John Doe)/x   exit 0   ESCAPED  (root then `'`)
#     <R>/(John)/projects/x            exit 0   ESCAPED  (root then `(`)
#     <R>/[John]/projects/x            exit 0   ESCAPED  (root then `[`)
#     <R>/(dollar)USER/projects/x      exit 0   ESCAPED  (root then `$`)
#     <H>/{ci}/build/x                 exit 0   ESCAPED  (root then `{`)
#
# Every one matched DETECT_RE, produced one REJECTED bare-root token, and then
# failed ANOM_RE because the character after the root is not in SEGCH. The
# character class was load-bearing again, and a class is exactly what has no
# terminus: `"`, `'`, `(`, `[`, `$` and `{` are all EXCLUDED from SEGCH on
# purpose, because they delimit paths in source -- so every one of them is
# simultaneously a legitimate terminator AND a real first character of a home
# directory as WRITTEN. No membership test can be right about both.
#
# THE RULE, AND IT CONSULTS NO CHARACTER CLASS AT ALL
#
#   A line that DETECT_RE matched is an ANOMALY unless EVERY occurrence
#   TOKEN_RE extracted from it was CLASSIFIED, and at least one was.
#
# It is a COUNT COMPARISON -- `classified -lt extracted`, plus `extracted -eq 0`
# -- over two integers the scan has already produced. There is no third regex,
# no residual re-scan, and nothing to widen. Proof that it consults no class:
# grep for the word `anomaly` in the code below and observe that the deciding
# expression names no pattern variable at all. That is mechanised by
# test_abs_paths_anomaly_rule_consults_no_character_class, which parses this
# file and asserts the decision references neither SEGCH, DETECT_RE, KEEP_RE nor
# TOKEN_RE, and that no `ANOM`-prefixed regex variable exists.
#
# "CLASSIFIED" means the occurrence was reported as a violation (it passed
# KEEP_RE) or it matched the service-account ALLOW below. Nothing else.
#
# THE RULE IS STRICTLY STRONGER THAN "ZERO CLASSIFIED". Counting per OCCURRENCE
# rather than per LINE is what keeps a MIXED line honest: on
# `cp <R>/O'Neil/x.plist <ALLOWED>` the allowlisted path classifies and the
# O'Neil path does not, so 1 < 2 and the line is reported. A per-line "something
# on this line was classified" flag would have certified the whole line off the
# strength of the allowlisted half -- which is the 2026 line-wide-`grep -v`
# regression, one level up. Pinned by
# test_abs_paths_allowlisted_path_does_not_mask_an_unparseable_one.
#
# THE THREE BENIGN LIVE CASES, and WHY each is green -- measured, not asserted:
#
#   * `src/populus/ingest/senate.py:77`, the Senate eFD URL `/search/home/`.
#     DETECT_RE NEVER MATCHES IT. Its `/home/` has no terminated following
#     segment, and DETECT_RE requires one. The line never enters the scan, so
#     no rule of any kind has to rescue it. (Verified by running DETECT_RE
#     against that exact line: no match, grep status 1.)
#   * `docs/runbooks/self-hosted-runner.md`, the service-account references that
#     trip the detector. Each one CLASSIFIES, against the exact-pair table in
#     the next block. See there.
#   * `dashboard/test/post/http-status.test.ts:188`, the bare `"/Users/"` and
#     `"/home/"` string literals. This one is NOT free, and the honest thing is
#     to say so rather than to bend a rule around it. See ANOMALY_ALLOW below.

# --- SERVICE-ACCOUNT EXEMPTIONS: EXACT PAIRS, NO PREFIXES (defect F26) -------
#
# This was a PREFIX classifier -- `case "$1" in "$ALLOW_HOME"|"$ALLOW_HOME"/*|
# "$ALLOW_HOME"' '*)`. A prefix test asks only what a value STARTS with, and the
# tokeniser's job is to stop early at any character it cannot read, so the two
# compose into a fail-open: TRUNCATE an arbitrary home directory down to the
# allowed prefix and the allowlist certifies it. Measured on the previous
# revision, both modes, extracted=classified=1 and exit 0 -- i.e. the gate read
# the line, understood it, and passed it:
#
#     /Users/populusrunner backup/secret   exit 0   ESCAPED (space arm)
#     /Users/populusrunner'Y/secret        exit 0   ESCAPED (exact arm, after
#                                                   the `'` truncated the token)
#     /Users/populusrunnerbackup/secret    exit 1   correctly reported
#
# Those are OTHER MACHINES' home directories being certified by the gate's own
# allowlist, and the previous pass declared it as accepted limitation N4. It was
# not acceptable: an allowlist that can be reached by truncation makes R3's
# final sweep unsound, and the third line proves the boundary was known to
# matter.
#
# THE MECHANISM NOW: an EXACT (occurrence, line) PAIR table. An occurrence is
# exempt only when the occurrence string matches an entry BYTE FOR BYTE **and**
# the whole line it was extracted from matches that entry's recorded line byte
# for byte. This is the same content-keying ANOMALY_ALLOW uses, tightened by one
# turn.
#
# WHY BOTH HALVES.
#   * The OCCURRENCE half is what makes truncation useless: a truncated token is
#     a different string from every entry, so it is reported.
#   * The LINE half is what keeps G2 literally true. An exemption granted to a
#     bare `/Users/populusrunner` would otherwise be granted everywhere that
#     token can be produced -- including from `/Users/populusrunner'Y/secret`,
#     which truncates to exactly it. Requiring the line as well means the escape
#     would have to reproduce an entire runbook command byte for byte to inherit
#     the exemption, at which point it is not an escape.
#   * Adding a real owner path TO one of these lines changes the line, so the
#     pair stops matching and BOTH occurrences on it are reported. Fail-CLOSED.
#
# WHAT IT COSTS. Editing any of these runbook lines reddens the gate until the
# table is updated. That is deliberate and it is cheap: four entries, each with
# the reason written beside it, and the failure is loud rather than silent.
#
# LOCATION-INDEPENDENT. Nothing here names a file or a line NUMBER, so the
# runbook's scheduled move from `docs/runbooks/` to `docs/operations/` cannot
# break or fail-open the exemption. Pinned by
# test_abs_paths_service_account_home_passes_but_an_owner_path_still_fails at
# BOTH locations, in both modes.
#
# The two arrays are PARALLEL and are checked for equal length at startup: a
# half-finished edit is a hard 2, never a silently shifted table.
SERVICE_ALLOW_OCC=(
  # `dscl . -read <account> UniqueID 2>/dev/null || echo ...` -- the account
  # name is fixed by a TRACKED launchd plist, and the command cannot be written
  # correctly without it. HOMESEG absorbs the interior spaces, so the occurrence
  # runs to the `>` of the redirection.
  '/Users/populusrunner UniqueID 2'
  # `sudo ls -la <account>/Library/LaunchAgents/` -- the one occurrence that
  # passes KEEP_RE; the other three are anomalies.
  '/Users/populusrunner/Library/LaunchAgents/'
  # `sudo find <account> -newer ...` -- the option word is absorbed by HOMESEG.
  '/Users/populusrunner -newer'
  # `sudo launchctl print gui/$(dscl . -read <account> UniqueID | awk ...)`
  '/Users/populusrunner UniqueID'
)
SERVICE_ALLOW_LINE=(
  'dscl . -read /Users/populusrunner UniqueID 2>/dev/null || echo "step 1 NOT done (no runner account)"'
  'sudo ls -la /Users/populusrunner/Library/LaunchAgents/ 2>/dev/null'
  'sudo find /Users/populusrunner -newer /usr/local/populus-runner/controller/runner-image.tar.gz \'
  'sudo launchctl print gui/$(dscl . -read /Users/populusrunner UniqueID | awk '"'"'{print $2}'"'"') 2>/dev/null | head -50'
)
[ "${#SERVICE_ALLOW_OCC[@]}" -eq "${#SERVICE_ALLOW_LINE[@]}" ] \
  || die "the service-account exemption table is malformed: ${#SERVICE_ALLOW_OCC[@]} occurrence(s) but ${#SERVICE_ALLOW_LINE[@]} line(s)"

# EXACT STRING EQUALITY on both halves. No `case` globbing, no prefix, no regex
# -- `[ "$a" = "$b" ]` and nothing else, so there is no pattern here for a
# future edit to widen by accident.
allowed_occurrence() {
  local occ="$1" line="$2" i=0 n=${#SERVICE_ALLOW_OCC[@]}
  while [ "$i" -lt "$n" ]; do
    if [ "$occ" = "${SERVICE_ALLOW_OCC[$i]}" ] \
       && [ "$line" = "${SERVICE_ALLOW_LINE[$i]}" ]; then
      return 0
    fi
    i=$((i + 1))
  done
  return 1
}

# Anomaly allowlist: EXACT LINE CONTENT, one per element, each with a reason.
#
# KEYED BY CONTENT, NEVER BY LINE NUMBER. The previous revision keyed this by
# `file:line`, which is a fail-OPEN waiting to happen inside a document that is
# scheduled to be edited: the numbered line drifts, the exemption lands on
# whatever text moved into its place, and a real escape inherits it. A content
# key cannot drift -- if the line changes at all, the exemption stops matching
# and the anomaly is reported again. Fail-CLOSED, and cheap.
#
# THE ONE ENTRY, and why it is not a disguised character class.
#
# `dashboard/test/post/http-status.test.ts:188` asserts that a published page
# body contains neither of the two bare roots. It writes them as string
# literals, and DETECT_RE MATCHES the line -- not because either literal names a
# machine, but because DETECT_RE's `[^/]+` BRIDGES from the first root, across
# `") && !text.includes("`, to the leading `/` of the second. TOKEN_RE then
# extracts two bare-root occurrences, neither of which KEEP_RE accepts, so zero
# of two classify and the line is an anomaly.
#
# Every structural alternative was measured and rejected:
#
#   * Narrow DETECT_RE so it cannot bridge. Impossible without also dropping a
#     required escape: after `<Users>/` the benign line reads `"` and so does
#     `<R>/"John Doe"/projects/x`. The two are byte-identical for as far as any
#     local test can see, so any class that rejects one rejects the other.
#   * Classify a BARE ROOT as benign. This is the trap. The occurrence TOKEN_RE
#     extracts from `<R>/"John Doe"/projects/x` is ALSO exactly the bare root --
#     the tokeniser stopped at the quote. Allowing bare roots re-opens all six
#     escapes above in one move.
#   * Exempt by file:line. That is the fail-open this table was just re-keyed to
#     avoid.
#
# So it is exempted by exact content, with the reason written down. The entry is
# spelled LITERALLY -- under the K8 exclusion this file is not scanned, so the
# two-fragment concatenation the previous revision used here is gone. bash 3.2
# has no empty-array expansion that is safe under `set -u`, so the loop below
# uses the `${x+"${x[@]}"}` guard, and
# test_abs_paths_anomaly_allowlist_actually_works exercises the array both empty
# and populated.
ANOMALY_ALLOW=(
  # dashboard/test/post/http-status.test.ts: a post-build assertion that the
  # published HTML leaks neither root. Two BARE roots in string literals, no
  # machine named; DETECT_RE matches only because it bridges between them.
  '      !text.includes("/Users/") && !text.includes("/home/"),'
)

# docs/build, docs/design and docs/maintenance are working documents for
# in-flight runs; they quote owner-machine paths by design.
# N3 plus the K8 self-reference exclusion. SELF_EXCLUDES is kept as a SEPARATE
# array, spliced in here, so the two kinds of exclusion cannot be confused: N3
# hides whole in-flight documentation directories, K8 hides exactly two named
# source files. Merging them into one literal is how a directory glob quietly
# acquires a third meaning.
EXCLUDES=(':(exclude)docs/build/*' ':(exclude)docs/design/*' ':(exclude)docs/maintenance/*'
          "${SELF_EXCLUDES[@]}")

# bash 3.2 is the system shell on this host, so `mapfile` does not exist; the
# candidate list goes through a temp file instead of an array builtin.
#
# NOTE the explicit template under $TMPDIR. `mktemp` with no template is NOT
# governed by TMPDIR on this host -- BSD mktemp resolves the darwin per-user
# temp dir via confstr() and ignores the variable -- so the setup-failure path
# was unreachable by the obvious test. TMPBASE is deliberately NOT named
# TMPROOT: that name is already taken above by the /private/tmp detection root.
TMPBASE="${TMPDIR:-/tmp}"
TMPBASE="${TMPBASE%/}"
FILELIST="$(mktemp "$TMPBASE/check_abs.files.XXXXXX")" \
  || die "cannot create a temp file under '$TMPBASE' -- refusing to certify an unscanned tree"
COUNTS="$(mktemp "$TMPBASE/check_abs.counts.XXXXXX")" \
  || { rm -f "$FILELIST"; die "cannot create a temp file under '$TMPBASE'"; }
trap 'rm -f "$FILELIST" "$COUNTS"' EXIT

git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a git work tree"

# `git grep -l` exits 1 when nothing matched -- that is a CLEAN tree, not an
# error. Only status >1 is a real failure, and it must not be swallowed by
# `2>/dev/null` the way it was before.
GREPERR="$(mktemp "$TMPBASE/check_abs.err.XXXXXX")" \
  || die "cannot create a temp file under '$TMPBASE'"
# RAWLIST holds `git grep`'s output BEFORE the ref-prefix normalisation, so the
# finder's status and the normaliser's status can be read independently. See the
# ref-mode branch below for why one status was not enough.
RAWLIST="$(mktemp "$TMPBASE/check_abs.raw.XXXXXX")" \
  || die "cannot create a temp file under '$TMPBASE'"
trap 'rm -f "$FILELIST" "$COUNTS" "$GREPERR" "$RAWLIST"' EXIT

if [ "$MODE" = "worktree" ]; then
  # `-c core.quotePath=false`: without it git renders a non-ASCII path as an
  # OCTAL-ESCAPED, double-quoted name. `read_file` would then fail on a file
  # that exists perfectly well, turning a scannable tree into a hard 2. With it
  # the byte sequence comes through literally and the file is actually scanned.
  git -c core.quotePath=false grep -I -l --untracked -E "$DETECT_RE" -- . "${EXCLUDES[@]}" \
    > "$FILELIST" 2>"$GREPERR"
  g=$?
  [ "$g" -le 1 ] || { cat "$GREPERR" >&2; die "git grep failed (status $g)"; }
  read_file() { cat -- "$1"; }
else
  git rev-parse --verify -q "$REF^{commit}" >/dev/null \
    || die "no such ref: $REF"
  # STAGE D: the ref-mode file finder and its ref-prefix normaliser. These were
  # one pipeline whose verdict came from `PIPESTATUS[0]` ALONE -- `git grep`'s
  # status. `sed`'s status was discarded, so a failing or missing `sed` left
  # FILELIST empty, the scan loop read nothing, the violation count was zero and
  # the gate returned 0: it certified an UNSCANNED ref as clean. Same fail-open
  # class as stages A/B/C above, and the last one left in this script.
  #
  # Materialise, then normalise, then guard each independently. `git grep`
  # status 1 means "no match" -- a clean ref, not an error; only >1 is a
  # failure. `sed` has no such convention: any non-zero status from it is an
  # error, including 127 for a `sed` that is not on PATH at all.
  git -c core.quotePath=false grep -I -l -E "$DETECT_RE" "$REF" -- . "${EXCLUDES[@]}" \
    > "$RAWLIST" 2>"$GREPERR"
  g=$?
  [ "$g" -le 1 ] || { cat "$GREPERR" >&2; die "git grep failed (status $g)"; }
  sed "s|^$REF:||" "$RAWLIST" > "$FILELIST"
  sst=$?
  [ "$sst" -eq 0 ] || die "ref-path normaliser (sed) failed with status $sst on ref '$REF' -- refusing to certify an unscanned ref"
  read_file() { git show "$REF:$1"; }
fi

# The per-file loop below runs in a pipeline-free `while ... done < file`, but
# the inner occurrence loop is fed by a pipe, so its counters would live in a
# subshell. Counts are accumulated in a file and summed at the end -- an
# in-subshell counter that silently resets to zero is the same class of defect
# as the inverted exit code this script replaces.
: > "$COUNTS" || die "cannot write to '$COUNTS'"
FBUF="$(mktemp "$TMPBASE/check_abs.buf.XXXXXX")" \
  || die "cannot create a temp file under '$TMPBASE'"
# LINEBUF and TOKBUF replace the process substitution and the command
# substitution that used to hide the inner scanners' exit statuses. BADFILES
# replaces a trailing `grep -c` over an accumulated string -- one fewer scanner
# whose status would have to be classified, and the count is a plain `wc -l`.
LINEBUF="$(mktemp "$TMPBASE/check_abs.lines.XXXXXX")" \
  || die "cannot create a temp file under '$TMPBASE'"
TOKBUF="$(mktemp "$TMPBASE/check_abs.toks.XXXXXX")" \
  || die "cannot create a temp file under '$TMPBASE'"
BADFILES="$(mktemp "$TMPBASE/check_abs.badf.XXXXXX")" \
  || die "cannot create a temp file under '$TMPBASE'"
# ANOMS counts detected-but-unparsed lines. Separate from COUNTS so the report
# can distinguish "the gate parsed a machine path" from "the gate could not
# parse a line it had already detected" -- two different operator actions.
ANOMS="$(mktemp "$TMPBASE/check_abs.anom.XXXXXX")" \
  || die "cannot create a temp file under '$TMPBASE'"
trap 'rm -f "$FILELIST" "$COUNTS" "$GREPERR" "$RAWLIST" "$FBUF" "$LINEBUF" "$TOKBUF" "$BADFILES" "$ANOMS"' EXIT
: > "$BADFILES" || die "cannot write to '$BADFILES'"
: > "$ANOMS" || die "cannot write to '$ANOMS'"

# A SECOND, INDEPENDENT guard on the same failure the FILELIST `mktemp` check
# covers, and it exists because mutation testing found that removing the mktemp
# guard alone left NOTHING to notice. An empty $FILELIST makes `> ""` fail with
# status 1, which the `git grep` guard legitimately reads as "no match"; the
# loop below then reads nothing, counts zero violations, and exits 0 over a tree
# that was never opened. One guard per failure is not enough when the failure
# mode is "certified something unscanned".
#
# Written as a PRE-loop test rather than as `done < "$FILELIST" || die`: a
# `while` returns the status of the last command its body ran, and this body
# legitimately ends in a false `[ "$found_in_file" -eq 1 ] && ...`, so the `||`
# form fires on every clean file. That mistake was made here first and caught by
# fourteen red tests.
#
# Pinned by test_abs_paths_a_single_failing_mktemp_still_exits_two.
{ [ -n "$FILELIST" ] && [ -r "$FILELIST" ]; } \
  || die "the file list is missing or unreadable -- refusing to certify a partial scan"
while IFS= read -r f; do
  # `git grep -l` never emits an empty path. One here means the list was
  # truncated or mangled, so the tree is only partly scanned -- a hard 2, never
  # a skipped file.
  [ -n "$f" ] || die "the file list contains an empty path -- refusing to certify a partial scan"
  # Materialise the file BEFORE the inner loop. Feeding `read_file` straight
  # into a process substitution put it in a subshell, where a read failure
  # could not stop the scan -- the gate would carry on and report "clean" for
  # content it never saw.
  read_file "$f" > "$FBUF" || die "cannot read '$f' (mode=$MODE)"
  found_in_file=0
  # STAGE C (was `< <(grep ...)`): the line prefilter. In a process substitution
  # its status was unreachable, so a broken grep looked exactly like a file with
  # no machine-specific path in it.
  grep -nE "$DETECT_RE" "$FBUF" > "$LINEBUF"
  lst=$?
  [ "$lst" -le 1 ] || die "line scanner (grep -n) failed with status $lst on '$f' -- refusing to certify an unevaluated file"
  while IFS=: read -r lineno text; do
    # `grep -n` emits `<lineno>:<text>`, so an empty $lineno means the line
    # scanner produced something this loop cannot parse. That is a scan failure,
    # not an empty line, and it must not be skipped in silence.
    case "$lineno" in
      ''|*[!0-9]*) die "line scanner emitted an unparseable record on '$f': '$lineno:$text'" ;;
    esac
    # An EMPTY $text cannot have matched DETECT_RE -- DETECT_RE requires at
    # least seven characters -- so grep can never emit one here. Reaching this
    # branch means the record was mangled between the scanner and this loop.
    [ -n "$text" ] || die "line scanner emitted an empty line $lineno of '$f' as a DETECT_RE match"
    # STAGE A (was `for tok in $(... | grep -oE ...)`): token extraction. A
    # command substitution discards the status, so a scanner error produced an
    # empty token list, indistinguishable from a line with nothing to report.
    printf '%s\n' "$text" | grep -oE "$TOKEN_RE" > "$TOKBUF"
    tst=$?
    [ "$tst" -le 1 ] || die "token scanner (grep -o) failed with status $tst on '$f' line $lineno -- refusing to certify an unevaluated line"
    # NOT `[ "$tst" -eq 0 ] || continue` any more. Status 1 -- "DETECT_RE
    # matched this line but TOKEN_RE extracted nothing from it" -- is precisely
    # the F24 escape, so the line must still reach the anomaly test below. Only
    # the token loop is skipped, and `extracted` stays 0, which is itself an
    # anomaly.
    #
    # THE TWO COUNTERS ARE THE ANOMALY RULE. `extracted` is how many
    # occurrences TOKEN_RE found on this line; `classified` is how many of them
    # were accounted for -- reported as a violation, or matched by the
    # service-account allowlist. Nothing else contributes to either. They live
    # in this shell, not in a subshell: the token loop is fed by `< "$TOKBUF"`,
    # never by a pipe, precisely so `classified` survives the loop. An
    # in-subshell counter that silently resets to zero is the same defect class
    # as the inverted exit code this script replaces.
    extracted=0
    classified=0
    if [ "$tst" -eq 0 ]; then
      while IFS= read -r rawtok; do
        # `grep -o` never emits an empty match for TOKEN_RE (it always consumes
        # a root), so an empty record here is a mangled scanner output, not a
        # token to skip.
        [ -n "$rawtok" ] || die "token scanner emitted an empty occurrence on '$f' line $lineno"
        # Give back the one character NOTSEG borrowed, if it borrowed one.
        tok="$(strip_boundary "$rawtok")" \
          || die "cannot normalise the occurrence '$rawtok' on '$f' line $lineno"
        [ -n "$tok" ] || die "occurrence '$rawtok' on '$f' line $lineno normalised to nothing"
        extracted=$((extracted + 1))
        # BOTH halves of the pair: the occurrence AND the line it came from.
        if allowed_occurrence "$tok" "$text"; then
          classified=$((classified + 1))
          continue
        fi
        # STAGE B (was `grep -qE ... || continue`): the keep filter. `||`
        # collapsed status 1 (correctly rejected) and status >1 (scanner error)
        # into the same silent skip.
        printf '%s\n' "$tok" | grep -qE "$KEEP_RE"
        kst=$?
        case "$kst" in
          # Accepted: a real violation. Reported, and CLASSIFIED -- the line has
          # accounted for this occurrence.
          0) ;;
          # Rejected by KEEP_RE: the tokeniser produced something that is not a
          # machine path as far as it can tell. NOT classified. This is the F24
          # escape, and leaving `classified` unincremented is what reports it.
          1) continue ;;
          *) die "keep filter (grep -q) failed with status $kst on '$f' line $lineno -- refusing to certify an unevaluated occurrence" ;;
        esac
        echo "ABS PATH: $f:$lineno: $tok"
        echo x >> "$COUNTS" || die "cannot append to '$COUNTS'"
        classified=$((classified + 1))
        found_in_file=1
      done < "$TOKBUF" || die "cannot read the token scanner output for '$f'"
    fi
    # STAGE E: the ANOMALY test. A COUNT COMPARISON, and deliberately nothing
    # else -- no regex, no character class, no residual re-scan. See the
    # DETECTED-BUT-UNCLASSIFIED block above for why the previous revision's
    # `ANOM_RE` was the defect rather than the fix.
    #
    # `extracted -eq 0` is the "DETECT_RE matched but TOKEN_RE found nothing"
    # case; `classified -lt extracted` is the "some occurrence on this line was
    # not accounted for" case, which is what keeps a mixed line honest.
    if [ "$extracted" -gt 0 ] && [ "$classified" -ge "$extracted" ]; then
      continue
    fi
    # Content-keyed exemption. Compared against the WHOLE line, never against a
    # file:line pair -- see ANOMALY_ALLOW above.
    anom_skip=0
    for aa in ${ANOMALY_ALLOW+"${ANOMALY_ALLOW[@]}"}; do
      [ "$aa" = "$text" ] && anom_skip=1
    done
    [ "$anom_skip" -eq 1 ] && continue
    # Report the WHOLE LINE, not a token: the entire point is that the parser
    # could not say where the path begins or ends, so quoting a token here
    # would be inventing the very certainty the anomaly denies.
    echo "ABS PATH ANOMALY: $f:$lineno: $text"
    echo x >> "$ANOMS" || die "cannot append to '$ANOMS'"
    found_in_file=1
  done < "$LINEBUF" || die "cannot read the line scanner output for '$f'"
  [ "$found_in_file" -eq 1 ] && { echo "$f" >> "$BADFILES" || die "cannot append to '$BADFILES'"; }
done < "$FILELIST"

# `wc -l`, not `grep -c`: grep exits 1 on an empty file, and `$(grep -c x f ||
# echo 0)` then yields the two-line string "0\n0", which breaks every later
# numeric test.
violations=$(wc -l < "$COUNTS" | tr -d ' ')
anomalies=$(wc -l < "$ANOMS" | tr -d ' ')
bad_files=$(wc -l < "$BADFILES" | tr -d ' ')

# An EMPTY count is a setup failure, never a pass. Without this guard the
# comparison below emits "integer expression expected" and the exit status is
# whatever the last command happened to leave behind.
case "$violations" in
  ''|*[!0-9]*) die "could not count violations (got '$violations') -- the scan did not complete" ;;
esac
case "$anomalies" in
  ''|*[!0-9]*) die "could not count anomalies (got '$anomalies') -- the scan did not complete" ;;
esac
# Guarded too, even though it only decorates the summary: an unguarded count is
# how the original fail-open decided a VERDICT on an empty string, and leaving
# one of the three unchecked invites the next reader to copy the wrong one.
case "$bad_files" in
  ''|*[!0-9]*) die "could not count affected files (got '$bad_files') -- the scan did not complete" ;;
esac

if [ "$violations" -gt 0 ] || [ "$anomalies" -gt 0 ]; then
  echo "check_abs_paths: $violations occurrence(s), $anomalies anomaly(ies) in $bad_files file(s)" >&2
  exit 1
fi
exit 0
