# Populus canonical gate chain (ARCHITECTURE.md §17 standing gates).
#
# The full declared gate set is a single repository-owned entrypoint so the
# deterministic QA gate runner executes and records EVERY gate, not only
# pytest:
#   - `make test`     → frozen-lockfile install + the full PYTHON suite AND the
#                       dashboard gate chain (astro check + node --test unit
#                       suites + static build + the post-build suite). Both
#                       toolchains install from their committed lockfiles first
#                       (`uv sync --frozen`, `npm ci`), so the gate proves the
#                       frozen environment on both sides.
#   - `make security` → the §19 paid-SDK dependency guard (G1 denylist)
#   - `make check`    → both, for local use
#
# The orchestration gate runner maps `make test` to the required "test" gate
# and `make security` to the required "security" gate, so `uv sync --frozen`,
# `uv run pytest -q`, `npm ci` + `npm run gates`
# (check → test → build → test:post), and `uv run python scripts/dep_guard.py`
# are ALL authoritatively executed with recorded exit status under one
# canonical entrypoint. The dashboard suite (RUN P3-2, R19) is therefore no
# longer green only in a separate, unrecorded invocation — it runs inside the
# recorded `test` gate.
#
# Environment: the dashboard build reads ONE published data build. Locally it
# falls back to the newest `builds/<id>` under `../populus-data`; in CI set
# `POPULUS_BUILD_DIR` + `POPULUS_DB` explicitly (data.ts refuses the dev
# fallback when `CI` is set) and, for the institutional preview paths,
# `POPULUS_TICKER_MAP`.

.PHONY: sync test test-python dashboard-gates security check accept-m2-5 accept-m2-6 accept-m1-b

sync:
	uv sync --frozen

# The test gate runs the full tree — the Python suite THEN the dashboard gate
# chain (make evaluates prerequisites left-to-right in the default, non-parallel
# mode the gate runner uses). No declared gate is left to a separate,
# unrecorded command.
test: test-python dashboard-gates

# The Python side installs from the committed lockfile first (proving the
# frozen environment satisfies the suite) and then runs the full pytest tree.
test-python: sync
	uv run pytest -q

# The dashboard's own declared gate chain (dashboard/package.json `gates` =
# check && test && build && test:post): astro check (tsc) + node --test unit
# suites + static build + the post-build suite (served HTTP-status contract,
# forced-cut orchestration harness over real dist bytes, institutional
# fixture-preview). `npm ci` installs from the committed package-lock, mirroring
# `uv sync --frozen` for the JS toolchain.
dashboard-gates:
	cd dashboard && npm ci && npm run gates

# dep_guard is a supply-chain gate (the §19 paid-vendor denylist over
# pyproject, the lockfile, and every owned import root) — the "security"
# gate kind.
security:
	uv run python scripts/dep_guard.py

# RUN M2-5 acceptance (R5/R9/R10): the mandatory synchronous DEV gate. It ERRORS
# (never skips) when the full 13(f)-list files or the tracked Berkshire corpus
# are absent, runs the full-file R5 cross-format identity, and prints the exact
# per-period coverage measured on the real corpus on both rollout paths.
accept-m2-5:
	uv run python scripts/accept_m2_5.py

# RUN M2-6 acceptance (R8/R10): the mandatory synchronous DEV gate. Fully
# hermetic (committed fixtures, zero sockets, autouse no-network guard), it
# drives the whole chain — discover → rank → drive the extended seam → measure →
# build-admission → install → serve — over a _FakeSecTransport behind a real
# SecClient, and NEVER skips. Exits nonzero on any failure.
#
# Depends on `sync` (approved implementation task 7): the acceptance gate must
# run in the same frozen-lockfile environment as `make test`, or a standalone
# `make accept-m2-6` could pass against an environment the committed lockfile
# does not describe.
accept-m2-6: sync
	uv run python scripts/accept_m2_6.py

# RUN M1-B Phase A acceptance (R11/R16): the mandatory synchronous DEV gate.
# Fully hermetic (committed tests/fixtures/ bytes, zero sockets, autouse
# no-network guard) and it NEVER skips. It drives the whole historical chain —
# discover → verified-settled + resumable fetch → evaluate → load → member join
# → cross-year amendment pair → per-era gate → gate-miss surfacing → stats
# render/validate → build → publish → verify → consumer + budget assertions —
# over fake transports behind the real ingest paths.
#
# It asserts the CHAIN and the gate BEHAVIOUR (above the gate, below it, and
# unmeasurable), NOT that the fixtures meet >=97%: a below-gate era is a
# decision surfaced for the owner, never a build failure. That is the
# deliberate difference from accept-m2-6.
#
# Depends on `sync` for the same reason accept-m2-6 does: the gate must run in
# the same frozen-lockfile environment as `make test`.
accept-m1-b: sync
	uv run python scripts/accept_m1_b.py

check: test security
