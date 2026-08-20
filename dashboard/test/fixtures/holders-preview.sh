#!/usr/bin/env bash
# Renders the holders route locally, end to end.
#
# Code review (cycle 5, F2) noted that the fixture command produced an aggregate
# but never connected it to a browser session — the env wiring lived only in
# prose, so "reproducible" was half a recipe. This is the whole recipe.
#
#   bash test/fixtures/holders-preview.sh [OUTDIR] [PORT]
#   # then open http://localhost:PORT/institutional/tickers/AAPL/holders/
set -euo pipefail
OUT="${1:-/tmp/holders-preview}"
PORT="${2:-4415}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # dashboard/
# Derive from the MAIN checkout, not a guessed directory depth: this file runs
# from a worktree as often as from the main tree, and counting "../" is exactly
# how the post-build fixture generator ends up looking for a data repo that
# does not exist.
MAIN="$(git -C "$HERE" rev-parse --path-format=absolute --git-common-dir)"
MAIN="$(dirname "$MAIN")"
DATA="${POPULUS_DATA_REPO:-$(dirname "$MAIN")/populus-data}"

if [ ! -d "$DATA/builds" ]; then
  echo "ERROR: no data repo at $DATA (set POPULUS_DATA_REPO)" >&2; exit 1
fi
BUILD="$DATA/builds/$(ls -1t "$DATA/builds" | head -1)"
CONGRESS="$(ls -1t "$DATA"/releases/*/congress.db 2>/dev/null | head -1)"
[ -n "$CONGRESS" ] || { echo "ERROR: no congress.db under $DATA/releases" >&2; exit 1; }

# Producer-backed aggregate: it emits the entity-keyed issuer the route requires.
( cd "$HERE/.." && uv run python dashboard/test/fixtures/make-inst-preview.py \
    "$OUT" --agg-only --data-repo "$DATA" >/dev/null )

echo "aggregate: $OUT/inst_agg.db"
echo "serving:   http://localhost:$PORT/institutional/tickers/AAPL/holders/"
cd "$HERE"
# Astro 7's dev server daemonizes when stdout is not a TTY (it prints "pid …,
# background" and the CLI exits), which made this script useless as a Playwright
# `webServer` command: the runner saw an early exit and the daemon leaked.
# Start it as an explicit daemon, BLOCK on its logs, and stop it on the way out.
# The trap alone is NOT enough: Playwright tears the webServer down by killing
# the whole process GROUP, which a bash trap never sees, so the daemon survived
# and the NEXT run failed its port-free precheck (proven, not hypothetical).
# A session-detached watchdog outlives the group kill and reaps the daemon.
cleanup() { npx astro dev stop >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
npx astro dev stop >/dev/null 2>&1 || true   # a stale daemon holds the project lock
POPULUS_BUILD_DIR="$BUILD" \
POPULUS_DB="$CONGRESS" \
POPULUS_INST_DB="$OUT/inst_agg.db" \
POPULUS_TICKER_MAP="$HERE/../tests/fixtures/inst/mcp/company_tickers.json" \
  npx astro dev --port "$PORT" --background
DAEMON_PID="$(npx astro dev status 2>&1 | sed -n 's/.*pid \([0-9][0-9]*\).*/\1/p' | head -1)"
if [ -n "$DAEMON_PID" ]; then
  python3 - "$$" "$DAEMON_PID" <<'PY' || true
import os, signal, sys, time
if os.fork() == 0:                      # detach: survive the group kill
    os.setsid()
    parent, daemon = int(sys.argv[1]), int(sys.argv[2])
    while True:
        try:
            os.kill(parent, 0)
        except OSError:                 # wrapper is gone, however it died
            try:
                os.kill(daemon, signal.SIGTERM)
            except OSError:
                pass
            sys.exit(0)
        time.sleep(1)
PY
fi
npx astro dev logs --follow
