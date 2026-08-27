# GitHub security runbook

RUN PUBLIC-SECURITY-HARDENING, Task 3 step 5 + Task 4 step 5. This is the
single location for the operator-only GitHub setting procedures, the
API-observable postconditions (`gh api` + `jq -e` predicates), the quarterly
verification sweep (R13), the full-history secret-scan command, and the
secret-incident response order.

Everything here is **operator-run** against live GitHub/Cloudflare state.
Nothing in this file is executed by CI. No command below ever prints or
accepts a secret value.

Repository: `johnbaekk-spec/populus` (public). Related runbooks:
`deploy.md`, `rollback.md`, `attestation.md`, `self-hosted-runner.md`.

---

## 1. Required check contexts

The four exact GitHub Actions check contexts required by the `main` ruleset
(R3), produced by `.github/workflows/checks.yml`:

1. `python (pytest)`
2. `dashboard (typecheck + unit)`
3. `gitleaks (all history)`
4. `dependency review`

These are job `name:` values; renaming a job silently unbinds its required
check. `tests/test_workflow_governance.py` pins all four names.

CodeQL threshold: the ruleset's code-scanning rule blocks alerts of severity
**high or higher**, for Python and JavaScript/TypeScript, using CodeQL
default setup. Enable that rule only after CodeQL has produced results for
both languages.

## 2. Ruleset activation procedure (operator-only, Task 3)

Prerequisite (R3): a second trusted GitHub account has accepted write access
and its handle has been added to `.github/CODEOWNERS`. Without it, do NOT
activate the ruleset — report R3 BLOCKED rather than weakening the approval
count to zero.

1. Create a disposable base branch `security-ruleset-probe` (plus a probe
   topic branch) from `main`.
2. Author the ruleset JSON with: target `refs/heads/security-ruleset-probe`,
   **empty bypass actors**, required pull request, 1 approving review from a
   non-author, dismiss stale approvals, require CODEOWNER review, require
   conversation resolution, required status checks (the four contexts above,
   strict/up-to-date, bound to the GitHub Actions app), block force pushes,
   block deletions.
3. Apply it to the probe branch only:
   `gh api -X POST repos/johnbaekk-spec/populus/rulesets --input ruleset.json`
4. Negative-test on the probe branch (never on `main` first):
   - attempt a direct push → must be rejected;
   - open a PR with one deliberately failing required check → merge blocked;
   - prove missing CODEOWNER approval blocks;
   - approve, push a new commit, prove stale-approval dismissal;
   - obtain fresh approval and merge.
5. Export the validated JSON
   (`gh api repos/johnbaekk-spec/populus/rulesets/<id>`), change **only** the
   target ref to `refs/heads/main`, apply, then verify every predicate in §4.
6. Delete the probe branches and the probe ruleset.

## 3. Environments (operator-only, Task 2 — executed with PR 4, not PR 1)

Create exactly three environments, each restricted to selected branch `main`
only (no tag pattern, no wildcard, no required reviewers — LD4):

| Environment | Secrets |
|---|---|
| `production-data-publish` | `DATA_REPO_PAT` |
| `production-pages-deploy` | `CLOUDFLARE_PAGES_EDIT_TOKEN` |
| `production-record-sign` | `DATA_REPO_PAT`, `CLOUDFLARE_PAGES_READ_TOKEN` |

Enter secrets with `gh secret set <NAME> --env <ENV> --repo
johnbaekk-spec/populus` reading the value from protected stdin or the
interactive prompt — **never in argv**, shell history, a patch, a
screenshot, or a review artifact. Repository-scope copies of the three
secrets are deleted only after the first supervised environment-based
dispatch succeeds; a second supervised dispatch with repository scope empty
proves there is no fallback. Publishing (the `POPULUS_PUBLISH_ARMED` switch)
stays disarmed until both hardened runs pass.

The Task 2 order, end to end:

1. Disarm publishing (`POPULUS_PUBLISH_ARMED` unset or not `'true'`).
2. Create the three environments; restrict each to selected branch `main`.
3. Enter the three secret values from their authoritative provider/keychain
   sources (GitHub cannot reveal the repository-scope values for migration).
4. Merge PR 4 (the workflow-side `environment:` binding). **Merging PR 4
   before steps 2–3 makes the publish/deploy/record jobs fail closed on empty
   secrets — intended while disarmed; never weaken the binding to avoid it.**
5. Supervised `workflow_dispatch` on `main`; inspect the job list and the
   signed deployment generation.
6. Delete the three repository-scope secrets
   (`gh secret delete <NAME> --repo johnbaekk-spec/populus`).
7. A second supervised dispatch with repository scope empty — the no-fallback
   proof.
8. Re-arm scheduling only after both supervised runs succeed.

## 4. API postconditions (`gh api` + `jq -e`)

Each command exits 0 only when the required state holds.

### R3 — ruleset

```bash
# Exactly one active ruleset targets main with zero bypass actors.
gh api repos/johnbaekk-spec/populus/rulesets --jq '.' | jq -e '
  [ .[] | select(.enforcement == "active" and .target == "branch") ] as $rs
  | ($rs | length) >= 1'

# Inspect the main ruleset in full (find <id> from the list above):
gh api repos/johnbaekk-spec/populus/rulesets/<id> | jq -e '
  .enforcement == "active"
  and (.conditions.ref_name.include | index("refs/heads/main"))
  and ((.bypass_actors // []) | length == 0)
  and ([.rules[].type] | (index("pull_request") and index("required_status_checks")
       and index("non_fast_forward") and index("deletion")))
  and ([.rules[] | select(.type == "pull_request")][0].parameters
        | .required_approving_review_count >= 1
          and .dismiss_stale_reviews_on_push == true
          and .require_code_owner_review == true
          and .required_review_thread_resolution == true)
  and ([.rules[] | select(.type == "required_status_checks")][0]
        .parameters.required_status_checks
        | [.[].context] | sort
          == (["dashboard (typecheck + unit)","dependency review",
               "gitleaks (all history)","python (pytest)"] | sort))'
```

### R4 — environments (post-PR 4)

```bash
gh api repos/johnbaekk-spec/populus/environments | jq -e '
  [.environments[].name] | sort
  == (["production-data-publish","production-pages-deploy",
       "production-record-sign"] | sort)'

# Each environment restricted to branch main via a deployment branch policy:
for e in production-data-publish production-pages-deploy production-record-sign; do
  gh api "repos/johnbaekk-spec/populus/environments/$e/deployment-branch-policies" \
    | jq -e '[.branch_policies[].name] == ["main"]'
done

# The three secret names no longer exist at repository scope:
gh secret list --repo johnbaekk-spec/populus --json name | jq -e '
  [.[].name] | (index("DATA_REPO_PAT") == null
    and index("CLOUDFLARE_PAGES_EDIT_TOKEN") == null
    and index("CLOUDFLARE_PAGES_READ_TOKEN") == null)'
```

### R5 — secret scanning and push protection

```bash
gh api repos/johnbaekk-spec/populus \
  --jq '.security_and_analysis' | jq -e '
  .secret_scanning.status == "enabled"
  and .secret_scanning_push_protection.status == "enabled"
  and (.secret_scanning_non_provider_patterns.status // "disabled") == "enabled"
  and (.secret_scanning_validity_checks.status // "disabled") == "enabled"'
```

### R13 — Dependabot, CodeQL, private reporting, workflow defaults

```bash
# Dependabot security updates:
gh api repos/johnbaekk-spec/populus/automated-security-fixes \
  | jq -e '.enabled == true'

# Private vulnerability reporting:
gh api repos/johnbaekk-spec/populus/private-vulnerability-reporting \
  | jq -e '.enabled == true'

# CodeQL default setup covers both languages:
gh api repos/johnbaekk-spec/populus/code-scanning/default-setup | jq -e '
  .state == "configured"
  and (.languages | (index("python")
       and (index("javascript-typescript") or index("javascript"))))'

# Default workflow token stays read-only and cannot approve PRs:
gh api repos/johnbaekk-spec/populus/actions/permissions/workflow | jq -e '
  .default_workflow_permissions == "read"
  and .can_approve_pull_request_reviews == false'
```

## 5. Quarterly verification sweep (R13)

Run every quarter, record output (structure, never secret values) in the
maintenance log:

```bash
gh api repos/johnbaekk-spec/populus/rulesets
gh api repos/johnbaekk-spec/populus/environments
gh api repos/johnbaekk-spec/populus/actions/permissions/workflow
gh api repos/johnbaekk-spec/populus --jq '{visibility,security_and_analysis}'
gh secret list --repo johnbaekk-spec/populus
gh api repos/johnbaekk-spec/populus/code-scanning/default-setup
# Action pinning: every third-party action referenced by a full 40-hex SHA.
grep -RInE 'uses:\s' .github/workflows/ | grep -vE '@[0-9a-f]{40}( |$|#)' || true
# Live site headers:
curl -sSI http://publicfilings.org/
curl -sSI https://publicfilings.org/
curl -sSI https://publicfilings.org/stats.json
# Dependency advisories (PR 2, R7/LD8): dep_guard, then pip-audit over the
# frozen no-dev uv export (--require-hashes --disable-pip; ANY Python advisory
# is red), then `npm ci && npm audit --audit-level=high` in dashboard/.
make security
```

Plus every `jq -e` predicate in §4; any non-zero exit is a finding.

The advisory halves of `make security` are network-dependent (PyPI/OSV and the
npm advisory service). An advisory-service outage fails the gate with the
tool's own named error — treat it as a red result to re-run, never as "no
vulnerabilities" (ARCHITECTURE/plan TD-PSH-4).

## 6. Full-history secret scan (local, on demand)

Pinned Gitleaks 8.30.1 container, repository mounted read-only, all refs,
full redaction, no report file:

```bash
docker run --rm \
  -v "/path/to/populus:/repo:ro" \
  ghcr.io/gitleaks/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f \
  git /repo \
  --config /repo/.gitleaks.toml \
  --gitleaks-ignore-path /repo/.gitleaksignore \
  --redact=100 --no-banner --log-opts="--all"
```

Run it against the **main checkout** (a linked worktree's `.git` file points
outside the mount and yields a vacuous "0 commits scanned" — a zero-commit
result is a failure, not a pass; the log line `N commits scanned` must show
a non-zero N). False positives get **only** an exact fingerprint in
`.gitleaksignore` (`commit:file:rule-id:line`) or one rule + exact path +
exact regex allowlist in `.gitleaks.toml`. A directory-wide or `tests/`-wide
allowlist is forbidden (R5).

## 7. Secret incident response — the order is mandatory (LD6)

If a real secret is found in the tree or history:

1. **Rotate/revoke first.** Invalidate the credential at its provider before
   anything else. History rewriting does not un-leak a value.
2. **Inspect logs.** Provider access/audit logs and GitHub logs for use of
   the credential during the exposure window.
3. **Remove from the current tree** via a normal reviewed PR.
4. **Then, separately planned:** a coordinated `git filter-repo` history
   rewrite with fork/clone invalidation — only for a real bearer secret,
   never for benign paths or fixture strings, and never before rotation.

GitHub push protection plus the `gitleaks (all history)` required check are
the prevention layer; this section is the response layer.
