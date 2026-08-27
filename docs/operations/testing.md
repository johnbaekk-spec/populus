# Testing: the two-tier gate model

This is the full description of the repository's test tiers, the hosted CI
that runs the contributor tier, and — just as importantly — what a green run
does **not** prove. The short version lives in the
[README gate section](../../README.md#the-two-tier-gate-model); this document
is the authority when they disagree in detail.

Two tiers, honestly separated. Neither claims the other's coverage.

## Contributor tier

Runs on a fresh clone with no private data, and on GitHub-hosted CI runners.
Exact commands:

```bash
uv run pytest -q                 # Python suite + golden-corpus checks
make security                    # dep_guard + pip-audit + npm audit (network!)

cd dashboard
npm ci
npx astro check                  # types
npm test                         # unit suites (node --test)
```

Notes on each:

- `uv run pytest -q` needs no network and no data checkout. Two host-bound
  suites declare their own preconditions and skip where their subject does
  not exist: `tests/test_runner_controller.py` (executes a macOS-only script
  using BSD `stat -f`; skips off Darwin) and `tests/test_m2_11_qa_bundle.py`
  (drives a builder pinned to owner-machine paths; skips when absent). On a
  hosted Linux runner these skips are expected and correct — the suites can
  only be authoritative where their subject lives.
- The dashboard unit suite is **not pure JS**: `test/inst.test.ts` spawns
  `uv run python …/make-inst-preview.py` to build its institutional fixture
  from the real producer. `uv sync` (or a resolvable `uv`) must precede
  `npm test`, or it dies at `spawnSync uv ENOENT`.
- `make security` — see the dedicated section below. It is the one
  contributor-tier gate that requires the network.

### `make security` is network-dependent — never call it hermetic

`make security` runs three gates:

1. `scripts/maintenance/dependency_guard.py` — offline, deterministic.
2. `pip-audit --require-hashes --disable-pip` over the frozen production
   export — **calls remote advisory services** (PyPI/OSV).
3. `npm ci && npm audit --audit-level=high` in `dashboard/` — **calls the
   npm advisory service**.

Consequences contributors must know:

- It can go **red with no local edit**, purely because an advisory database
  changed overnight. A red `make security` is therefore not necessarily your
  diff — check whether the finding names one of your dependency changes.
- `pip-audit` exposes **no severity threshold**: any known advisory on a
  pinned production dependency fails the gate, regardless of severity.
- A network or advisory-service outage is a **named failure, not a pass**.
  The gate never silently passes when it cannot reach its services.
- Do not describe this target as hermetic or offline anywhere; only its
  `dep_guard` third is.

## Hosted CI: `.github/workflows/checks.yml`

`checks.yml` is the **only** contributor-gating workflow. Its trigger set,
exactly as landed by RUN PUBLIC-SECURITY-HARDENING:

- `pull_request` — fork-safe by construction: GitHub-hosted runners only,
  `permissions: contents: read`, no environment, no secrets-context
  interpolation, `persist-credentials: false` on every checkout; on a
  `pull_request` event GitHub additionally hands the job a read-only token
  and no secrets.
- `push` to `main`.
- `workflow_dispatch`.

`pull_request_target` and `issue_comment` (comment-driven execution) remain
**banned repo-wide**; `tests/test_workflow_governance.py` structurally
enforces this and the fork-safety properties above, with killing mutations.
The sole self-hosted job remains `publish.yml:publish`, unreachable from any
PR-like trigger.

The four hosted jobs, and what each proves:

| Job | What it runs | What a green result proves |
| --- | --- | --- |
| `python (pytest)` | `uv sync --frozen` then `uv run pytest -q`, full tree, unfiltered | The Python suite passes on a clean hosted Linux runner with pinned deps. Host-bound suites self-skip, so this proves *less* than `make test` on the owner machine. |
| `dashboard (typecheck + unit)` | `npm ci`, `npx astro check`, `npm test` (with `uv` synced for the fixture-producing tests) | The dashboard typechecks and its unit suites pass with no data build present. |
| `gitleaks (all history)` | Gitleaks 8.30.1 from an OCI-digest-pinned container over every ref (`--log-opts="--all"`), repo mounted read-only, 100% redaction; on a PR the scanner policy is materialized from the trusted base SHA so a fork cannot edit the policy in the same PR that hides a secret | No known-pattern secret exists anywhere in the repository's history under the trusted policy. |
| `dependency review` | `actions/dependency-review-action` (pull_request events only — it diffs base..head manifests) | The PR's dependency changes introduce no known-vulnerable or disallowed dependency. Skips on push/dispatch by design. |

### What a green checks run does NOT prove

- **The post-build gates are deliberately excluded.** `npm run test:post`
  and the site build require a real `POPULUS_BUILD_DIR` and release
  databases from the **private** `populus-data` checkout; they stay with
  the publisher-side workflow that has them. A green `checks` run says
  nothing about them.
- The Playwright/Chromium browser-geometry lane never runs here.
- The two host-bound Python suites self-skipped; their subjects were not
  exercised.
- `make security` is not among the jobs — the advisory gates run locally
  and in the security-run-owned surfaces, not in `checks.yml`.

## Owner tier

`make test` / `make check` run the full tree including `npm run gates`.
Its host requirements are why it is owner-only:

- **32 GiB physical memory** (the static site build runs a 24 GiB Node
  heap).
- **Chromium** for the Playwright browser-geometry lane.
- A real **`POPULUS_BUILD_DIR`** and release databases (**`POPULUS_DB`**)
  from the **private** `populus-data` checkout, for the site build and the
  post-build suite (`npm run test:post`).

A green contributor tier does not prove the owner tier, and CI never runs
the owner tier. Do not ask hosted CI to run `make test`. Note also that the
owner tier inherits the `make security` caveat above: after the security
gates run, the overall `make` chain is no longer hermetic either.

## History (why this exists)

On 2026-08-12 three PRs merged with zero checks; one turned
`tests/test_licenses.py` red on `main`, and that red gate survived a merge
and a production deploy because nothing ran it. `checks.yml` exists so the
contributor tier is asked on every PR and push — with the honest caveat,
stated in the workflow itself, that a hosted runner proves less than
`make test` does where the host-bound subjects actually live.
