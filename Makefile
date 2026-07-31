# Populus canonical gate chain (ARCHITECTURE.md §17 standing gates).
#
# The full declared gate set is a single repository-owned entrypoint so the
# deterministic QA gate runner executes and records EVERY gate, not only
# pytest:
#   - `make test`     → frozen-lockfile install + the full test suite
#   - `make security` → the §19 paid-SDK dependency guard (G1 denylist)
#   - `make check`    → both, for local use
#
# The orchestration gate runner maps `make test` to the required "test" gate
# and `make security` to the required "security" gate, so `uv sync --frozen`,
# `uv run pytest -q`, and `uv run python scripts/dep_guard.py` are all
# authoritatively executed with recorded exit status.

.PHONY: sync test security check accept-m2-5 accept-m2-6

sync:
	uv sync --frozen

# The test gate installs from the committed lockfile first (proving the
# frozen environment satisfies the suite) and then runs the full tree.
test: sync
	uv run pytest -q

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

check: test security
