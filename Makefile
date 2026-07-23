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

.PHONY: sync test security check

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

check: test security
