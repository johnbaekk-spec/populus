# RUN PUBLIC-SECURITY-HARDENING — newly public production repository (plan-v1)

## Plan Metadata

- **Transport:** `interactive-disk`
- **Revision:** 3
- **Prepared:** 2026-08-14 America/Los_Angeles (revision 1 began 2026-08-13)
- **Repository:** `johnbaekk-spec/populus` (`PUBLIC`)
- **Review base:** `origin/main` at
  `4fd2987857b24045dc9c82ae368343df35ea9a22`
- **Implementation branch:** a new `codex/public-security-hardening` worktree
  created from a freshly fetched `origin/main`; never the currently dirty
  `feat/run-m2-8-holdings-substrate` worktree
- **Source audit:** the 2026-08-13 newly-public repository security/exposure
  audit. That audit found no committed bearer secret in the current tree or any
  reachable local/remote Git ref, and no anonymous or fork-to-self-hosted
  execution path. This plan addresses the real findings without treating
  public government URLs, the intentional SEC contact address, or documented
  security architecture as secrets.

### Revision history

- **Revision 1:** drafted against
  `7967b560ae87f7d6e5405ae672f783bacf81589a`; independent plan review returned
  `CHANGES_REQUESTED` with 11 blockers and 3 nits.
- **Revision 2:** rebased to `4fd2987857b24045dc9c82ae368343df35ea9a22`.
  The intervening PR #35 added the one-settle/full-reverify path for production
  propagation-shaped inventory 404s in `deploy/orchestrator.py`. Revision 2
  adds that producer/consumer/test surface to PR 5; specifies inventory v2
  and rollback expectations exactly; switches Wrangler to its direct locked
  binary; makes Python fail on any advisory; includes Senate bodies; locks a
  DOCTYPE-rejecting XML helper; pins trusted/redacted Gitleaks execution; moves
  all production dispatches after ingest hardening; defines disposable-branch
  ruleset probes; carries existing deployment residuals; locks CLI path inputs;
  removes `includeSubDomains`; and splits the work into five reversible PRs.
- **Revision 3:** resolves round-2 deployment-boundary review. It separates
  full v2 validation from internal entry sweeping, locks count semantics and
  record control evidence, reuses raw provider deployment reads, defines a
  single-response pre-upload rollback observer and comparison protocol,
  enumerates every new implementation unit, and removes the conditional digest
  change wording. No application or setting change was made during planning.

### Independent review resolution

| Round-1 item | Revision-2 resolution |
|---|---|
| F1 — stale base omitted PR #35 | Rebased to `4fd2987`; the new 404-settle classifier and orchestrator tests are in Scope, Task 10, verification, and DoD. |
| F2 — inventory v2 was underspecified | LD12 now fixes the exact schema, sorting, uniqueness, counts, control kind, digest framing, and new-artifact anti-downgrade behavior. |
| F3 — rollback verified the attempted inventory | LD12a captures prior provider/body/marker/header expectations before preview and verifies those after rollback, including v1-to-v2 tests. |
| F4 — `npm exec` could fetch remotely | LD9/Task 7 invoke the exact lock-installed executable directly and fail before secrets if it is absent or wrong-version. |
| F5 — unsupported Python severity threshold | LD8/Task 6 fail on any Python advisory and on npm high/critical findings using supported tool semantics. |
| F6 — Senate bodies were not bounded | R9/Task 8 cover real Senate GET and POST, including multi-value `Set-Cookie` preservation and sibling inventory. |
| F7 — parser flags did not reject DOCTYPE | LD11/Task 9 define one byte-in/root-out helper that parses an `ElementTree` and rejects non-empty `docinfo.doctype`. |
| F8 — Gitleaks trust/history/redaction was incomplete | Task 1 pins the OCI digest, fetches full history, materializes policy from the trusted base SHA, redacts fully, and emits no raw report. |
| F9 — production proof preceded ingest hardening | Publishing stays disarmed through PRs 1-4; production proof is allowed only after PR 3 and the PR 4 cutover are on protected `main`. |
| F10 — ruleset negative testing risked `main` | Task 3 validates exact checks and rules on a disposable branch before changing only the target ref to `main`. |
| F11 — existing provider/point-in-time debt disappeared | R15 and Tech Debt explicitly carry the pre-existing verification, provider, preview, production-window, and toolchain credential residuals. |
| N1 — QA path inputs remained ambiguous | R11/Task 4 fix four required CLI flags, one frozen config object, and no environment fallback. |
| N2 — HSTS subdomain readiness was unproven | LD13/R12 omit `includeSubDomains` and `preload`; the exact reversible policy is verified live. |
| N3 — first rollout unit was too broad | LD1 and Scope split the work into five ordered, independently reversible PRs. |
| F15 — strict v2 conflicted with the domain marker sweep | LD12b validates a complete v2 document once, passes typed served entries to an internal sweep, forbids partial envelopes at external seams, and separates artifact, served-file, and control-effect counts. |
| F16 — rollback evidence had no producer | LD12c reuses raw production payloads and defines one cache-busted, redirect-disabled root observation before freeze/upload; capture failure causes zero provider mutation. |
| F17 — Simplicity Audit omitted security units | The audit now names the path config, inventory types/validator, explicit no-v1-parser decision, entry sweep, header multimap, rollback dataclasses/protocol/producer, and their owning tests. |
| F18 — digest contract had conditional wording | Scope and Task 10 make `digests.py` test-only unless a separately reviewed plan amendment changes the fixed v1 framing. |

Line citations below name the review base, not the current feature worktree.
Before implementation, Task 0 re-resolves every anchor against the new base.
If `origin/main` has advanced, rebase this plan's file inventory and tests
before changing code; a stale line number is not authority to edit a similar
looking function.

## Goal and Success Criteria

Keep the repository safely public while preserving the live site's static,
no-account architecture and the existing separation between data publishing,
Cloudflare deployment, and attestation. Success means:

1. untrusted fork code can run only in credential-free GitHub-hosted PR checks;
2. `main` cannot change without passing required checks and an independent
   review, and production secrets are available only to main-restricted job
   environments;
3. GitHub push protection plus a repository-owned scanner prevent a future
   secret from entering either the working tree or Git history;
4. every inline JSON data block is safe against `</script>` breakout before the
   currently-disabled ticker-holder routes are ever enabled;
5. the Python, npm, and Wrangler dependency graphs have no known high/critical
   advisory and are reproducibly installed from committed lockfiles;
6. fixed-government-host House, Senate, and SEC fetches plus House ZIP/XML
   parsing have explicit,
   tested memory/decompression ceilings and hardened XML parsers;
7. CSP and HSTS are deployed as an explicitly attested Cloudflare Pages control,
   without weakening the site's existing expected-path verification; and
8. each remote setting and operator-only action has an API-observable
   postcondition and a rollback.

The implementation is complete only after all five PRs and the external
settings operations pass. Governance/scanning is the immediate public-repository
blocker. Application/dependency hygiene and ingest hardening land while
publishing remains disarmed. The environment/Wrangler cutover is the first point
at which a supervised production run is allowed. CSP/HSTS is the final,
separately reversible defense-in-depth PR and is not silently dropped.

## Requirements

- **R1 — Fresh, isolated implementation base.** Implement from a clean worktree
  based on the fetched `origin/main`; record the exact base/head and reconcile
  the final changed-file list. No existing dirty-worktree file is adopted by
  accident.
- **R2 — Fork-safe CI without self-hosted exposure.** `pull_request` checks run
  the existing Python and dashboard suites on GitHub-hosted runners with
  `contents: read`, no secret/environment access, and no reusable production
  workflow. `pull_request_target` and comment-driven execution remain banned.
  `publish.yml` and `record-sign.yml` remain schedule/manual-or-called only, and
  the sole self-hosted job remains `publish.yml:publish`.
- **R3 — Enforced main review boundary.** An active `main` ruleset has no bypass
  actors; requires a pull request, one approving review from someone other than
  the author, dismissal of stale approval, CODEOWNER review, conversation
  resolution, and the strict GitHub-Actions checks `python (pytest)`, `dashboard
  (typecheck + unit)`, `gitleaks (all history)`, and `dependency review`; the
  CodeQL rule blocks high-or-higher alerts. Force-push and deletion are blocked.
  A second trusted GitHub account with write access is a hard activation
  prerequisite; a solo author cannot approve their own change.
- **R4 — Job-scoped production environments.** Repository-level production
  secrets are re-entered into three selected-branch environments and then
  deleted from repository scope: `production-data-publish` (`DATA_REPO_PAT`),
  `production-pages-deploy` (`CLOUDFLARE_PAGES_EDIT_TOKEN`), and
  `production-record-sign` (`DATA_REPO_PAT`,
  `CLOUDFLARE_PAGES_READ_TOKEN`). Only `main` may deploy. The existing
  no-job-holds-Pages-Write-plus-GitHub-write/attestation invariant remains true.
- **R5 — Secret prevention and history response.** `.gitignore` covers dotenv,
  key/certificate, credential, local-database, tool-worktree, and review-output
  classes without ignoring committed examples. GitHub secret scanning, push
  protection, non-provider patterns, and validity checks are enabled. A
  full-history Gitleaks 8.30.1 container is pinned by OCI digest, checks out full
  history, uses the trusted base branch's exact `.gitleaks.toml` and
  `.gitleaksignore`, redacts 100%, and emits no raw report/summary/artifact. Only
  narrowly fingerprinted false-positive exclusions are allowed. A real hit
  stops the run and triggers rotation
  before any history rewrite; the already-clean audit does not justify a
  destructive rewrite.
- **R6 — Inline JSON cannot become executable markup.** One shared serializer
  replaces every literal `<` in `JSON.stringify` output with `\u003c`. The
  holders, filer, holdings-table, and institutional-index embeds use it, and
  render tests prove adversarial upstream names cannot close the data script or
  create an executable `<script>` element.
- **R7 — Audited dependency locks.** The known vulnerable locked versions
  (`cryptography 49.0.0`, `pypdf 6.14.2`, and npm transitives `fast-uri 3.1.4`,
  `js-yaml 4.3.0`, `nanoid 3.3.16`) are moved to the smallest compatible patched
  graph. `make security` retains the paid-vendor guard and adds deterministic
  Python-lock and npm advisory gates. Python fails on any known advisory because
  `pip-audit` exposes no supported severity threshold; npm fails at
  high/critical via `--audit-level=high`.
- **R8 — Wrangler comes only from the committed npm lock.** Wrangler is an
  exact dashboard development dependency; deploy performs `npm ci` before the
  token-bearing step and invokes `dashboard/node_modules/.bin/wrangler`
  directly (no `npm exec`, `npx --yes`, remote install, moving tag, or package
  override). The executable's presence and version are asserted before the
  secret is exposed; a missing local binary fails closed.
- **R9 — Bounded response and archive handling.** The real House, Senate GET/POST,
  and SEC httpx transports stream into a shared 128 MiB ceiling and reject an oversized
  `Content-Length` before reading or an oversized streamed body while reading.
  House discovery additionally caps the compressed index ZIP at 16 MiB, requires
  exactly one regular XML member, caps it at 64 MiB uncompressed and a 100:1
  compression ratio, and rejects the archive before extraction on any breach.
- **R10 — Hardened XML everywhere in scope.** House index parsing, member hint
  parsing, and 13F parsing call one byte-in/root-out `parse_untrusted_xml`
  helper. It creates a fresh lxml parser with entity resolution, DTD loading,
  network access, recovery, and huge-tree mode disabled, parses an
  `ElementTree`, rejects any non-empty `docinfo.doctype`, then returns the root.
  XXE/DTD and
  malformed-input tests fail closed without reading local files or making
  sockets.
- **R11 — Public-tree hygiene without security theater.** Remove the tracked
  user-specific `.claude/launch.json`; replace active M2-11 QA evidence roots
  with required CLI flags `--expected-root`, `--orchestrate`,
  `--evidence-root`, and `--snapshot`, collected once into a configuration
  object at command entry; ignore any local convenience wrapper. Remove
  `/Users/johnbaek/...` from active code/tests without environment fallbacks;
  replacements. Do not rewrite history for benign path strings, remove the
  intentional SEC contact identity, or obscure documented runner controls.
- **R12 — Attested CSP/HSTS provider control.** Every new site artifact uses the
  exact anti-downgrade inventory-v2 schema in LD12. The built `_headers` policy
  is copied and hashed in the sealed deployment snapshot, represented separately
  from served files, and verified through exact observed header values on
  preview and production. New upload/sign paths reject v1 and a missing control;
  pre-v2 signed records remain immutable archival bytes, but no v1 inventory
  parser is added to production code and rollback never consumes their inventory.
  A partial one-file envelope cannot enter an external verifier: the complete v2
  document is validated into typed entries first, and only an internal entry
  sweep may reuse one already-validated marker. Artifact counts include files
  plus controls; served-file sweep counts and separately named control-effect
  counts never masquerade as one another. Before any preview upload, rollback
  evidence is captured from a raw production payload and one coherent,
  cache-busted, redirect-disabled custom-domain root response; capture failure
  causes zero upload/provider mutation.
  `_redirects`, `_worker.js`, and Functions remain prohibited. The policy has
  `script-src 'self'` with no `unsafe-inline`; the pre-paint theme code becomes a
  same-origin external script. Existing generated inline style attributes are
  the documented reason for the narrower `style-src 'self' 'unsafe-inline'`.
  HSTS is `max-age=31536000` without `includeSubDomains` or `preload`.
- **R13 — GitHub security maintenance is present and observable.** Add
  `SECURITY.md`, CODEOWNERS, weekly Dependabot entries for `uv`, `npm`, and
  `github-actions`, enable Dependabot security updates and CodeQL default setup
  for Python and JavaScript/TypeScript, preserve SHA-pinned Actions and default
  read-only workflow tokens, and document quarterly verification commands.
- **R14 — Unknown Cloudflare user token gets an owner disposition, not a blind
  revoke.** Enumerate the non-expiring, user-owned `Cloudflare Agent
  (auto-generated)` token's actual consumers. Revoke it if unused; otherwise
  replace it with the narrowest read-only, expiring credential its identified
  consumer supports, verify that consumer, then revoke the old token. Record no
  bearer value in the repository.
- **R15 — Closure evidence is honest.** Re-run current-tree, all-ref/history,
  workflow, dependency, and live-header checks; record commands, tool versions,
  base SHA, results, false-positive dispositions, GitHub-setting JSON, and the
  Cloudflare token decision in the implementation notes. R12 closes integrity
  for the declared `_headers` artifact only; existing point-in-time verification,
  unexpected-route/provider-rule/zone-configuration, preview-window,
  production-verification-window, and token-bearing npm-toolchain residuals stay
  explicit. CUSIP redistribution
  counsel review remains a separate non-AppSec launch gate and is not falsely
  declared solved here.

## Scope

### PR 1 — governance, scanning, and public security metadata

- `.github/workflows/checks.yml`
- `.github/CODEOWNERS` (new)
- `.github/dependabot.yml` (new)
- `.gitleaks.toml` and `.gitleaksignore` (new; both authoritative; exact
  fingerprints only)
- `.gitignore`
- `SECURITY.md` (new)
- workflow-governance tests
- `docs/runbooks/github-security.md` (new)
- GitHub ruleset/security settings (external, operator-run)

### PR 2 — application, dependency, and tracked-path hygiene

- `Makefile`, `pyproject.toml`, `uv.lock`
- `dashboard/package.json`, `dashboard/package-lock.json`
- `dashboard/src/lib/inline-json.ts` (new)
- `dashboard/src/components/HoldingsTable.astro`
- `dashboard/src/pages/institutional/index.astro`
- `dashboard/src/pages/institutional/filers/[cik].astro`
- `dashboard/src/pages/institutional/tickers/[t]/holders.astro`
- dashboard render/unit tests
- `.claude/launch.json` (delete)
- `scripts/build_m2_11_qa_bundle.py`
- `tests/test_m2_11_qa_bundle.py`
- `ARCHITECTURE.md`, `README.md`, `STATUS.md`, relevant deploy runbooks

### PR 3 — production-ingest hardening

- `src/populus/net/bounded_http.py` (new)
- `src/populus/net/sec_client.py`
- `src/populus/ingest/house.py`
- `src/populus/ingest/senate.py`
- `src/populus/parse/xml.py` (new)
- `src/populus/parse/inst13f.py`
- `src/populus/members.py`
- focused SEC-client, House/Senate-ingest, member, and 13F parser tests
- `ARCHITECTURE.md` and ingest documentation

### PR 4 — production environments and locked Wrangler cutover

- `.github/workflows/publish.yml`
- `.github/workflows/record-sign.yml`
- `src/populus/deploy/upload.py`
- `dashboard/package.json`, `dashboard/package-lock.json`
- workflow and deployment-upload/orchestrator tests
- environment secrets/settings (external, operator-run)
- `ARCHITECTURE.md` and deploy runbooks

### PR 5 — response-header defense in depth and evidence v2

- `dashboard/public/_headers` (new)
- `dashboard/public/theme-init.js` (new)
- `dashboard/src/layouts/Base.astro`
- `src/populus/publish/inventory.py`
- `src/populus/publish/digests.py` (verification/tests only: tree digest stays
  version `1` with unchanged framing and continues to include controls; any
  code change requires a separately reviewed plan amendment)
- `src/populus/deploy/snapshot.py`
- `src/populus/deploy/verify.py`
- `src/populus/deploy/record.py`
- `src/populus/deploy/orchestrator.py`
- `src/populus/cli.py`
- any closed-world inventory validators that enumerate the exact v1 keys
- deploy snapshot/verify/upload/record/orchestrator, digest/CLI, and dashboard
  render tests
- `ARCHITECTURE.md`, `dashboard/README.md`, deploy/rollback/attestation runbooks

Only current operational documentation that instructs use of embedded owner
paths changes in PR 2; historical approved review artifacts remain historical
records.

## Non-goals

- No authentication, account, cookie, admin panel, server route, database, or
  CORS redesign: the production dashboard is static and intentionally public.
- No change to the data-attestation trust chain, publishing semantics, public
  government source URLs, publicfilings.org, the SEC-required contact email, or
  public filing content.
- No migration of the self-hosted runner's 21 GB source workload to hosted CI;
  its non-admin/read-only/ephemeral-root controls are preserved.
- No blanket sanitization of all `set:html` uses. Existing HTML render helpers
  already escape their values; R6 addresses the distinct raw-text JSON-script
  breakout sink and adds a regression test at that boundary.
- No automatic revocation of an unknown external token and no rotation based
  solely on a token name. R14 first establishes consumers.
- No Git history rewrite unless R5 finds a real bearer secret. Benign absolute
  paths and known test strings are not credentials.
- No claim that repository rules defeat compromise of the sole repository
  administrator, who can edit repository rules. Moving production authority to
  a separately administered private automation repository is recorded as
  residual debt, not smuggled into this run.
- No licensing opinion. `DATA-LICENSE.md` and the 13F-list provenance counsel
  flag remain the source of truth for the separate legal gate.

## Constraints and Operator Prerequisites

1. **Independent reviewer prerequisite (R3).** Before the ruleset is activated,
   the owner supplies a trusted GitHub handle, grants it write access, and has
   that person accept the invitation. The remediation PR and subsequent
   workflow/security-sensitive PRs require that account's approval. If this
   prerequisite is unavailable, implementation may land fork-safe CI and secret
   scanning but must report R3 and the public-promotion gate as BLOCKED; it must
   not weaken the approval count to zero and call the boundary complete.
2. **Secret source prerequisite (R4).** The owner must be able to re-enter the
   three existing secret values from their authoritative provider/keychain
   source. GitHub cannot reveal repository secret values for migration.
3. **Live production safety.** Set `POPULUS_PUBLISH_ARMED=false` (or remove it)
   before PR 1. Keep it disarmed through PRs 1–4. No supervised or scheduled
   production dispatch may occur until PR 3's R9/R10 hardening and PR 4's
   environment/Wrangler code are both on protected `main`; re-arm only after the
   two supervised post-cutover proofs.
4. **No credential in commands or evidence.** Use `gh secret set --env` from
   protected stdin or its interactive prompt; never pass a value in argv, shell
   history, a patch, a screenshot, or a review artifact.
5. **Current-platform facts validated 2026-08-13.** GitHub public repositories
   support rulesets and deployment branch restrictions; environment secrets in
   a reusable workflow must be selected by `environment:` on the called job,
   not passed by `workflow_call`; Dependabot's current ecosystem key for
   `uv.lock` is `uv`. Re-verify the linked GitHub documentation at execution:
   [rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets),
   [environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments),
   [reusable workflow secrets](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows),
   and [Dependabot ecosystems](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories).
6. **Cloudflare rollback response validated 2026-08-14.** The current Pages API
   documents rollback as returning the rolled-back deployment object, including
   `id`, `environment`, and `uses_functions`. LD12c therefore compares those raw
   fields and never reconstructs them from the typed object. Re-verify the
   [rollback API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/rollback/)
   before implementation if the provider contract has changed.

## Current-State Evidence

- GitHub reports the repository public, `main` unprotected, zero rulesets, zero
  environments, one direct administrator, and one online self-hosted runner
  labelled `self-hosted, macOS, ARM64, populus-ops` (API read 2026-08-13).
- GitHub's default workflow token is already read-only and cannot approve PRs.
  Preserve that setting.
- Secret scanning, push protection, non-provider patterns, validity checks, and
  Dependabot security updates are disabled. Repository-scope Actions secrets are
  `CLOUDFLARE_PAGES_EDIT_TOKEN`, `CLOUDFLARE_PAGES_READ_TOKEN`, and
  `DATA_REPO_PAT`; their values were not readable and are not in Git.
- `.github/workflows/checks.yml:30-41` deliberately bans `pull_request`, while
  its jobs at `:47-185` are already hosted, read-only, frozen-install checks.
  `tests/test_workflow_governance.py:41-100` currently bans every PR-like trigger
  and must be narrowed without weakening self-hosted isolation.
- `.github/workflows/publish.yml:13-16,48-88` has only schedule/manual triggers,
  a main/arming guard, the sole self-hosted job, and job-scoped permissions.
  Secret uses are step-scoped at `:188-190,376-389,477-495`; the reusable signer
  receives repository secrets at `:501-522`.
- `.github/workflows/record-sign.yml:49-67` declares caller-passed secrets and a
  hosted signer job; `:94-119` scopes the Cloudflare read token to its verifying
  step. R4 moves secret lookup to an environment on this called job.
- `.gitignore:1-9` covers build/cache basics but not dotenv, key/cert,
  credentials, local databases, `.claude/settings.local.json`,
  `.claude/worktrees`, `.codex-review`, or `planned-files.json`.
- The real stored-XSS sink is
  `dashboard/src/pages/institutional/tickers/[t]/holders.astro:62-73,94`, where
  upstream filer/issuer names can enter raw `set:html` JSON. The ticker map is
  intentionally absent in production (`.github/workflows/publish.yml:315-325`;
  `dashboard/src/lib/inst.ts:316-346`), so the route is not currently generated.
  The same unsafe convention exists at
  `dashboard/src/pages/institutional/filers/[cik].astro:71-84,99`. The correct
  mechanism already exists locally at
  `dashboard/src/components/HoldingsTable.astro:238-250`; the institutional
  index has a narrower close-tag escape at
  `dashboard/src/pages/institutional/index.astro:92`.
- `Makefile:55-59` names `security` but runs only the paid-vendor denylist.
  `pyproject.toml:10-21` leaves security-sensitive libraries unbounded and
  `dashboard/package.json:20-29` carries the Astro build graph. The committed
  locks contain the R7 versions named above.
- `src/populus/deploy/upload.py:84-89,266-287` invokes
  `npx --yes wrangler@4.42.0`; it is version-named but downloaded at deployment
  time outside the committed npm lock while the Cloudflare token is in scope.
- `src/populus/ingest/house.py:88-99` and
  `src/populus/net/sec_client.py:159-177` buffer remote bodies. House discovery
  then writes and expands the first XML member without size/ratio checks at
  `src/populus/ingest/house.py:315-334`.
- `src/populus/ingest/senate.py:111-159` performs the same full-body conversion
  for real GET and POST responses, and `_obtain_page` archives those bytes at
  `:1043-1070`. It is part of R9, not a deferred sibling.
- Hardened lxml settings already exist at
  `src/populus/parse/inst13f.py:38-42,97`; bare parsers remain at
  `src/populus/ingest/house.py:222-224` and `src/populus/members.py:556-567`.
- `.claude/launch.json:1-11` publishes a stale user-specific temp path, and
  active M2-11 QA code/tests publish owner paths at
  `scripts/build_m2_11_qa_bundle.py:28-38` and
  `tests/test_m2_11_qa_bundle.py:19-35`. These are low-impact disclosure, not
  credentials.
- The live site redirects HTTP to HTTPS and already sends `nosniff` and a
  referrer policy, but not CSP or HSTS. `src/populus/deploy/verify.py:135-145`
  treats `_headers` as a prohibited, non-served control, and
  `ARCHITECTURE.md:873` records the resulting CSP foreclosure. R12 changes the
  attested envelope instead of bypassing that check.
- Since revision 1, `origin/main` added
  `src/populus/deploy/orchestrator.py:343-379,448-500`: only a rejected result
  whose every finding is an inventoried-path 404 gets one 45-second settle and
  full-inventory re-verification. Header/control/marker/hash findings and every
  unavailable result roll back immediately. R12 preserves and mutation-tests
  that classification; a missing/weakened `_headers` can never enter the settle
  loop.
- `src/populus/deploy/record.py:852-904` currently confirms the custom domain by
  constructing a v1-shaped one-file envelope and passing it to
  `sweep_inventory`; `deploy/verify.py:536-562` validates that partial mapping.
  Strict v2 cannot reuse this shape. LD12b retains the I/O loop only below a
  complete-v2 typed validation boundary and fixes every count's meaning.
- `src/populus/deploy/orchestrator.py:217-246,420-423,569-605` currently captures
  only a typed prior deployment id and re-verifies rollback against the attempted
  inventory. Its `PagesDeploySurface` already exposes raw production listings
  and raw rollback payloads. LD12c reuses those reads and adds the missing
  single-response custom-domain observer before any snapshot/upload.
- `ARCHITECTURE.md:797-799,923` accurately distinguishes the scoped, expiring
  Populus Cloudflare tokens from the unrelated user-owned, non-expiring read
  token. R14 is an owner operation because unknown consumers make blind revoke
  unsafe.

## Detected Stack

- Python 3.12+, uv/`uv.lock`, Click, httpx, lxml, SQLite, pytest.
- Node 24, npm/`dashboard/package-lock.json`, Astro 7 static output, Node test
  runner.
- GitHub Actions with SHA-pinned third-party actions; one macOS ARM64
  self-hosted publish job and hosted deploy/sign jobs.
- Cloudflare Pages Direct Upload via Wrangler; custom domain
  `publicfilings.org`; repository code and production data repository are
  separate.
- Canonical repository gates are `make test`, `make security`, and `make check`
  (`Makefile:30-59,138`).

## Reuse Map

| Need | Existing mechanism to reuse | Decision |
|---|---|---|
| JSON-script escaping | `HoldingsTable.astro:238-240` replaces `<` with `\u003c` | Extract exactly this boundary into one shared TypeScript helper; do not invent an HTML sanitizer. |
| Hosted frozen CI | `checks.yml:47-185` | Add `pull_request` and security jobs to the same hosted workflow; keep production workflows untouched by PR triggers. |
| Workflow governance | `tests/test_workflow_governance.py:41-100` | Replace the blanket PR ban with an allowlist that proves every PR-triggered job is hosted, read-only, secretless, and environmentless; retain equality over the self-hosted allowlist. |
| Dependency install | `uv sync --frozen`, `npm ci` in Make/workflows | Add audit steps after the same frozen installs; Wrangler joins the existing dashboard lock. |
| XML hardening | `_HARDENED_PARSER_KWARGS` in `src/populus/parse/inst13f.py` | Move the settings into the exact shared `parse_untrusted_xml` helper and make all three callers use it. |
| Injected transports | `Transport`/`SecTransport` protocols and fake transports | Bound only the real httpx implementations; preserve hermetic fake-driven ingest tests. |
| Canonical inventory JSON | `src/populus/canonical.py::canonical_json` and committed `rfc8785` | Reuse it for inventory v2 and digests; no second encoder. Raw provider objects are inspected transiently, not serialized into evidence. |
| Sealed deployment | `deploy/snapshot.py` copy/hash/seal and `publish/inventory.py` | Add an explicit provider-control section to the same envelope; do not create a second deployment artifact. |
| Header verification | `verify.py` control probes and exact response-header allowlist | Teach it one declared `_headers` policy and exact expected values; retain refusal of undeclared controls. |
| Domain marker confirmation | `record.py::_confirm_domain` currently sends a synthetic one-file envelope through `sweep_inventory` | Validate the complete v2 document at record entry, then pass its typed marker to internal `_sweep_entries`; never make the public validator accept a partial envelope. |
| Rollback provider read | `PagesDeploySurface.raw_deployments(environment="production")` and `rollback_payload` | Capture the complete raw prior payload before preview and reuse the raw rollback response; do not reconstruct from the typed deployment. |
| Secret separation | Existing job split and step-scoped `env` blocks | Add job environments without widening any token or co-locating Pages Write with GitHub write/attestation. |
| Operator documentation | Existing `docs/runbooks/deploy.md`, rollback, attestation, self-hosted runner | Add one GitHub-security runbook and cross-link; do not duplicate runner provisioning. |

## Architecture and Locked Decisions

1. **LD1 — Five independently reversible PRs, ordered.** PR 1 lands hosted
   governance/scanning/metadata and activates the ruleset/security settings.
   PR 2 lands XSS/dependency/path hygiene. PR 3 lands House/Senate/SEC and XML
   hardening. PR 4 migrates environments and the direct locked Wrangler binary,
   then and only then runs production proof. PR 5 changes the CSP/header evidence
   envelope. Each PR runs the full standing gate set; publishing stays disarmed
   through PR 4.
2. **LD2 — Independent human review is the release boundary.** The ruleset
   requires one non-author approval and has no bypass actors. Codex review is
   useful evidence but is not a GitHub identity and does not replace R3.
3. **LD3 — Hosted fork CI is allowed narrowly.** Only `checks.yml` may use
   `pull_request`; it may never call a reusable workflow, use an environment,
   reference `secrets`, request write permission, or select a self-hosted runner.
   `pull_request_target`, `issue_comment`, and similar privileged/content-driven
   triggers remain banned repo-wide.
4. **LD4 — Environments are branch gates, not nightly manual approvals.** Each
   production environment allows selected branch `main` only. Required
   environment reviewers are not enabled because the documented nightly is
   unattended; merge review is the human gate. This limitation is stated rather
   than pretending a same-account approval protects against account compromise.
5. **LD5 — Preserve three privilege domains.** Publish gets the data PAT and no
   Cloudflare token; deploy gets Pages Write and `contents: read`; record-sign
   gets the data PAT, Pages Read, and GitHub attestation/write. Environment
   migration must not combine them.
6. **LD6 — No destructive history action on a clean repository.** Gitleaks and
   GitHub secret scanning establish prevention and recheck history. If a real
   secret appears: stop, revoke/rotate, assess access logs, then separately plan
   `git filter-repo` plus fork/clone coordination. A path or fake fixture is not
   a reason to invalidate every clone.
7. **LD7 — One inline-JSON primitive.** `serializeInlineJson(value)` returns
   `JSON.stringify(value).replaceAll("<", "\\u003c")`. Empty/no-payload handling
   remains at the caller. No second escape spelling remains.
8. **LD8 — Advisory gates use supported semantics.** PR 2 must close all
   currently known advisories. `make security` fails on any Python advisory from
   `pip-audit` and on high/critical npm findings. No unplanned severity parser or
   unknown-severity policy is introduced.
9. **LD9 — Wrangler is local and exact.** `dashboard/package.json` declares an
   exact version (no range), `npm ci` occurs with no Cloudflare token in scope,
   and `dashboard/node_modules/.bin/wrangler --version` is asserted before the
   token-bearing deploy step. Python invokes that path directly with an argv
   list. Missing/non-executable/wrong-version local state fails before the
   secret; runtime remote installation and CLI package overrides are removed.
10. **LD10 — Resource ceilings are generous availability controls.** Shared HTTP
    body cap 128 MiB for House, Senate GET/POST, and SEC; House ZIP cap 16 MiB;
    XML member cap 64 MiB; ratio cap 100:1; exactly one regular `.xml` member.
    Breaches are named ingest failures and write neither archive nor extracted
    bytes.
11. **LD11 — One strict byte-in/root-out XML helper.**
    `parse_untrusted_xml(xml_bytes)` builds a fresh `XMLParser` with
    `resolve_entities=False`, `load_dtd=False`, `no_network=True`,
    `dtd_validation=False`, `huge_tree=False`, `recover=False`; parses via
    `etree.parse(BytesIO(xml_bytes), parser)`; rejects non-empty
    `tree.docinfo.doctype`; returns `tree.getroot()`. Each caller maps its raised
    `UnsafeXmlError` into its existing failure/report contract. Parser objects
    are never reused.
12. **LD12 — Exact inventory-v2, anti-downgrade contract.** New site artifacts
    canonicalize exactly this RFC 8785 object (keys are shown semantically;
    canonical JSON orders them):

    ```json
    {
      "inventory_version": "2",
      "dist_digest_version": "1",
      "dist_digest": "<sha256 of every uploaded regular file using existing v1 framing>",
      "files": [{"path":"<served path>","bytes":0,"sha256":"<hex>"}],
      "controls": [{"path":"_headers","kind":"cloudflare-pages-headers","bytes":0,"sha256":"<hex>"}]
    }
    ```

    The top-level key set and each entry's shown key set are exact. Versions,
    paths, kinds, and digests are strings; every digest is lowercase 64-hex;
    `bytes` is a non-boolean integer at least zero. Paths are normalized relative
    POSIX paths: non-empty, with no leading slash, backslash/alternate separator,
    empty/dot/dot-dot segment, or control character. `files` and `controls` are
    independently UTF-8-bytewise path sorted; paths are unique across both
    arrays. New builds require exactly one control, the
    regular root `_headers` with the exact kind above; `_redirects`,
    `_worker.js`, Functions, another control, a missing control, or `_headers`
    in `files` is malformed. Existing `dist_digest_version="1"` and its framing
    do not change and include `_headers` because it hashes every uploaded regular
    file. `inventory_digest` remains SHA-256 of the full canonical inventory JSON
    and therefore binds controls without a second digest. `file_count` and the
    Cloudflare budget count are `len(files)+len(controls)`. New snapshot, upload,
    verifier, signer, record, CLI, and artifact-facts paths require
    `inventory_version="2"`; they never reinterpret a missing control as v1.
    No v1 inventory parser is added to production code. Existing pre-v2 signed
    record bytes and attestations remain untouched; rollback compatibility is
    LD12a's observed prior-site contract, not inventory auto-detection.
    The verifier does not fetch `_headers` as an asset, still requires
    `/_headers` to answer 404, and proves its exact effect on representative
    served paths.
13. **LD12a — Rollback uses captured prior expectations, never the failed
    artifact's inventory.** A frozen `RollbackExpectation` contains the prior
    provider deployment id/environment and explicit no-Functions result derived
    directly from the raw provider mapping (preserving a present/absent
    `uses_functions` signal), plus one
    `RollbackSiteObservation`: custom-domain root body hash/length, exactly one
    non-empty `populus:build_id` and `populus:code_sha`, and a normalized
    multi-value snapshot of CSP/HSTS/nosniff/referrer with explicit absence.
    After provider rollback, require its raw response id to equal the captured
    target, `environment="production"`, and `uses_functions is False`; make the
    same single root observation and require exact body/marker/header equality.
    This is honest point-in-time identity/marker/header restoration, not a
    prior-tree inventory proof. Tests cover first v2 failure rolling back to
    observed v1, v2→v2, marker/header/body drift, wrong provider id/environment,
    missing `uses_functions`, and failed restoration.
14. **LD12b — Full validation and entry sweeping are separate trust
    boundaries.** `inventory.py` reuses
    `populus.canonical.canonical_json` and owns `InventoryFile`,
    `InventoryControl`, `ValidatedInventoryV2`, `InventoryError`, and
    `validate_inventory_v2(document)`. The validator alone accepts an external
    mapping and raises `InventoryError` before I/O on any exact-key/type/digest-
    syntax/path/order/uniqueness violation, then returns immutable typed tuples.
    Tree/artifact entry points separately recompute each size/hash and the v1
    dist digest against bytes; structural validation never claims to prove bytes
    it was not given. Public callers map that one
    error into their existing `VerifyInputError`, `RecordRefused`, or
    `DeployAborted` contracts. Every new build/snapshot/upload/verify/sign/
    record/CLI/artifact-facts entry point calls
    it; none accepts a generic v1/v2 union. `verify.py` owns package-internal
    `_sweep_entries`, which accepts only `Sequence[InventoryFile]` from a
    `ValidatedInventoryV2` and never parses an inventory-shaped mapping.
    `_confirm_domain` receives that validated object, selects its one marker
    entry, and calls `_sweep_entries`; it never constructs a partial envelope.
    No `HistoricalInventoryV1`, v1 parser, or generic union is introduced.
    Killing tests pass v1-shaped and one-file partial mappings to every external
    seam and require refusal before network or signing.

    Count semantics are fixed: `UploadSnapshot.file_count`,
    `DeployOutcome.file_count`, CLI `file_count`, and the Cloudflare upload
    budget retain their historical meaning of every regular uploaded artifact,
    now `len(files)+len(controls)`. `SweepResult.files_total`,
    `VerificationResult.files_total`, signed `files_total`, and
    `domain_files_total` mean served entries only, `len(files)`. Verification
    and the signed record add separately named `controls_total=1` and
    `control_effects_verified=1` for a successful origin sweep, plus
    `domain_controls_total=1` and `domain_control_effects_verified=1` for the
    custom-domain marker/header leg. A successful sign requires all four control
    fields to be exactly one and carries the exact canonical `controls` identity.
15. **LD12c — Rollback evidence has one pre-upload producer.** Reuse the current
    `PagesDeploySurface.raw_deployments(environment="production")`; the first raw
    result is the prior deployment and an empty list is the existing first-run
    uncompensated case. `capture_rollback_expectation(pages, observer,
    domain_url)` validates a non-empty id, production environment, and explicit
    `uses_functions is False`, calls one injected `RollbackObserver`, then
    re-reads the raw production list and requires the same first id/environment/
    no-Functions signal before constructing the expectation. The complete raw
    mappings remain ephemeral and are never logged, signed, or written to the
    evidence bundle. A concurrent provider change therefore
    aborts before `freeze_tree` or either upload. Its production adapter,
    `observe_rollback_root`, performs exactly one
    custom-domain root GET with a UUID query, `Cache-Control: no-cache`,
    `Pragma: no-cache`, and `follow_redirects=False`; it requires HTTP 200 and
    derives all body, marker, and security-header evidence from that response.
    The `HeaderMultimap` response-header protocol exposes
    occurrence-preserving `multi_items()`; security-header names are lower-cased,
    optional whitespace is stripped,
    absence is an empty tuple, and more than one occurrence is refused rather
    than collapsed. Transport failure, 429/5xx, non-200, duplicate/missing/empty
    markers, ambiguous headers, provider-id drift, or malformed provider payload
    raises the existing `DeployAborted` before snapshot/upload. Order tests require zero uploader,
    rollback, or other provider mutation calls after capture failure. Post-
    rollback observation uses a fresh UUID and the same adapter; mismatch or
    unavailability sets `rollback_verified=False` and retains the existing loud
    `ProductionVerificationFailed`/operator-runbook path.
16. **LD13 — CSP is strict on script, pragmatic on generated style.** Policy:
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
    img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none';
    base-uri 'none'; frame-ancestors 'none'; form-action 'self';
    upgrade-insecure-requests`. No `unsafe-eval`, remote scripts, or inline
    executable script. Existing per-row style attributes explain the style
    exception and are not expanded.
17. **LD14 — Do not hide intentional infrastructure documentation.** Public
    runner labels, generic `/usr/local` layout, GitHub/Cloudflare project names,
    government endpoints, and security control explanations stay public. Remove
    stale owner temp/evidence paths only.
18. **LD15 — Residual administrator risk is declared.** A compromised repository
    admin can edit repo-level rules/settings. The stronger future boundary is a
    separately administered private deployment repository or organization-level
    rules. Owner: repository owner; removal condition: production credentials
    and runner registration authority move outside the public repo's admin
    boundary. This does not block R2-R4, which close the public/fork and ordinary
    workflow-write paths found by the audit.

## Implementation Tasks

### Task 0 — Rebaseline and preserve the user's worktree (**R1, R15**)

1. Fetch `origin`; create a new worktree/branch from `origin/main`; copy this
   approved plan into that branch. Record `git rev-parse origin/main`, branch,
   and clean status.
2. Re-run the reuse scan and `git grep` every Current-State anchor. Update line
   citations, Scope, and tests if main advanced. Do not transplant the current
   dirty branch's files.
3. Confirm the revision-1→revision-2 base diff includes PR #35's
   propagation-shaped inventory-404 settle/full-reverify path. Capture baselines:
   `make check` (record any pre-existing known failure
   exactly), hosted-workflow governance tests, `npm audit --json`, a pinned
   Python audit export, and Gitleaks over `--all` refs. A baseline failure is
   fixed in a separate prerequisite commit or explicitly blocks the affected PR; it
   is never hidden by broad exclusions.

### Task 1 — Make PR CI fork-safe and governance-test the boundary (**R2, R3, R13**)

1. Change `checks.yml` triggers to `pull_request`, push to `main`, and
   `workflow_dispatch`; keep `permissions: contents: read` and all existing jobs
   hosted. Set checkout `persist-credentials: false` for PR jobs.
2. Add uniquely named hosted jobs `gitleaks (all history)` and `dependency
   review`. Every Gitleaks checkout uses `fetch-depth: 0`. Run Gitleaks 8.30.1
   from the immutable multi-platform image
   `ghcr.io/gitleaks/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f`
   with the repository mounted read-only, `--redact=100`, `--no-banner`, no
   report path, and `--log-opts="--all"`. On PRs, materialize both policy files
   from `github.event.pull_request.base.sha` into read-only runner-temp files and
   pass them explicitly with `--config` and `--gitleaks-ignore-path`; candidate
   policy is never used. On main/schedule/manual, use policy at the checked-out
   trusted main SHA. The bootstrap PR is independently reviewed because no base
   policy exists yet. Pin dependency-review and all actions to full commit SHAs.
   No security job references a secret/environment or uploads, comments, or
   summarizes a raw finding.
3. Rewrite the governance test so only `checks.yml` may carry `pull_request` and
   it structurally proves: hosted `runs-on`, no `uses` at job level, no
   environment, no `${{ secrets.* }}`, no write permission, no
   `pull_request_target`/`issue_comment`, and the exact one-entry self-hosted job
   allowlist. Pin exact required check names `python (pytest)`, `dashboard
   (typecheck + unit)`, `gitleaks (all history)`, and `dependency review`. Add
   killing mutations for shallow checkout, candidate-policy substitution,
   removed redaction, report/summary upload, broad ignore, a PR job moved to
   `self-hosted`, a secret reference, `contents: write`, and a reusable-workflow
   call.
4. Add CODEOWNERS with both the owner and the accepted independent reviewer as
   owners of the whole tree, plus explicit entries for `.github/`, `ops/runner/`,
   deployment/network/parser code, lockfiles, security configuration, and
   licensing conditions. Verify both handles are accepted collaborators before
   ruleset activation.

### Task 2 — Move production secrets into branch-restricted environments (**R4, R13**)

1. Disarm publishing. Create the three exact environments from R4 and restrict
   each to selected branch `main`; no tag pattern, wildcard, or required reviewer.
2. Re-enter secrets from authoritative sources. In workflow YAML, add the matching
   environment to `publish`, `deploy`, and `record-sign.yml:record`. Remove the
   sign caller's `secrets:` mapping and the called workflow's `workflow_call`
   secret declarations; the called job resolves its environment secrets itself.
3. Extend structural tests to assert exact job-to-environment and
   secret-to-job mappings, the absence of job-level token env blocks, and the
   Pages-Write/GitHub-write separation.
4. Merge only after PR 3 has landed R9/R10. Then run a supervised main
   `workflow_dispatch`, inspect its job list and signed deployment generation,
   and delete all three repository-level secrets. Run a second supervised
   dispatch with repository scope empty to prove there is no fallback. Re-arm
   scheduling only after both hardened runs succeed.

### Task 3 — Activate repository and GitHub security settings (**R3, R5, R13**)

1. After Task 1 produces the four exact check names, create a disposable
   `security-ruleset-probe` base branch and apply the intended active ruleset JSON
   to that branch only, with empty bypass actors and the exact R3 protections.
   Bind all four checks to the GitHub Actions app, strict/up-to-date. Enable the
   code-scanning rule only after CodeQL has produced Python and
   JavaScript/TypeScript results; high-or-higher alerts block.
2. Enable secret scanning, push protection, non-provider patterns, validity
   checks, Dependabot alerts/security updates, private vulnerability reporting,
   and CodeQL default setup for Python and JavaScript/TypeScript. Preserve
   `default_workflow_permissions=read` and
   `can_approve_pull_request_reviews=false`.
3. Add `dependabot.yml`: weekly `uv` at `/`, `npm` at `/dashboard`, and
   `github-actions` at `/`; group non-major development updates by ecosystem,
   keep security updates unignored, and cap open PRs to a reviewable number.
4. On the disposable branch, attempt a direct push (a misconfigured rule can
   mutate only the probe), open a PR with one deliberately failing required
   check, prove missing CODEOWNER approval blocks, approve, push a new commit and
   prove stale dismissal, then obtain fresh approval and merge. Export that
   validated JSON, change only the target ref to `refs/heads/main`, apply it,
   verify every API predicate, and delete the probe branches. Never use `main`
   as the first negative-test target.
5. Document exact `gh api` GETs and expected `jq` predicates in the GitHub
   security runbook, including the four check contexts and CodeQL threshold.

### Task 4 — Add secret-safe repository hygiene and history response (**R5, R11, R15**)

1. Extend `.gitignore` for `.env`, `.env.*` except an explicitly committed
   `!.env.example` if one ever exists, `*.pem`, `*.key`, `*.p12`, `*.pfx`,
   `*.jks`, credential files, local `*.db`/SQLite sidecars outside committed
   fixtures, `.claude/settings.local.json`, `.claude/worktrees/`,
   `.codex-review/`, and `planned-files.json`. Use anchored exceptions for any
   committed fixture database; never globally ignore test fixtures.
2. Configure exactly `.gitleaks.toml` (rules/config) and `.gitleaksignore`
   (fingerprints) for the pinned image. Reproduce the two audit false positives
   and allow only their fingerprints; if a fingerprint cannot be stable, use one
   rule plus exact fixture path plus exact safe regex in `.gitleaks.toml`.
   A whole `tests/` or documentation allowlist is forbidden.
3. Remove `.claude/launch.json`. Add required argparse flags
   `--expected-root`, `--orchestrate`, `--evidence-root`, and `--snapshot` to the
   QA-bundle entry point; collect them once into a frozen `QaBundlePaths` object
   and pass it instead of reading module path globals. No environment fallback.
   Tests construct it from temporary paths; an ignored local wrapper may supply
   convenience flags. Do not edit archived
   approved review evidence merely to erase a username.
4. Add `SECURITY.md`: supported branch, private vulnerability reporting URL,
   no-public-issue request, expected response window, scope distinction between
   public filings and private security data, and instructions never to send a
   live credential as proof.
5. Put current-tree and full-history scan/incident commands in the runbook. The
   incident order is rotate/revoke, inspect provider/GitHub logs, remove current
   tree, then coordinate any `git filter-repo` rewrite and fork invalidation.

### Task 5 — Close the inline-JSON stored-XSS seam (**R6**)

1. Add `dashboard/src/lib/inline-json.ts` with the single LD7 serializer and no
   DOM/HTML responsibility.
2. Replace local serializers in HoldingsTable, institutional index, filer, and
   holders pages. Preserve the empty-payload behavior and JSON byte semantics
   except for `<` escaping.
3. Add unit cases for strings containing `</script><script>globalThis.pwned=1`,
   mixed case, repeated `<`, ampersands, quotes, U+2028/U+2029, and ordinary
   non-ASCII. Parse the escaped text with `JSON.parse` and require deep equality.
4. Build adversarial issuer/filer fixtures through the real page render. Assert
   exactly one data-script element with the expected id, no executable injected
   script node/text, no literal `</script><script`, and successful client JSON
   parsing. Cover the currently ungenerated holder route directly so enabling a
   ticker map cannot activate the latent sink.

### Task 6 — Repair dependency locks and make advisory gates real (**R7, R13**)

1. Add exact `pip-audit==2.10.1` as a development tool, update only the minimum direct
   constraints needed, run `uv lock --upgrade-package ...` for the affected
   graph, and review every transitive diff. Do not broad-upgrade unrelated
   packages merely because the lock is old.
2. Run `uv export --frozen --no-dev --no-emit-project` to a private `mktemp -d`
   requirements file and audit that hashed export. Clean the temp directory via
   trap. This audits the production lock rather than the developer environment.
3. Run `npm audit --audit-level=high` after `npm ci`; update the smallest direct
   Astro/tooling constraints that resolve the three named transitives, then
   inspect the lock diff and rebuild the static site.
4. Expand `make security` to run dep_guard, `pip-audit --require-hashes` over the
   production export (any known advisory is red), and
   `npm audit --audit-level=high`. A network/advisory-service outage is a named unavailable
   result and a red CI check, not “no vulnerabilities.” Document the command to
   re-run; do not silently ignore it.

### Task 7 — Put Wrangler under the existing lock (**R8**)

1. Add exact `wrangler: "4.42.0"` to dashboard devDependencies and regenerate
   `dashboard/package-lock.json` with the pinned Node/npm toolchain.
2. Replace `DEFAULT_WRANGLER_PACKAGE` and `npx --yes` with the repository-relative
   executable `dashboard/node_modules/.bin/wrangler`; resolve it from the checked
   out repository root, require an executable file, and pass that path as
   argv[0]. Remove every remote-package/command override from CLI and tests.
   Retain argv-list subprocess execution and the no-shell invariant.
3. In the hosted deploy job, run `npm ci` without Cloudflare credentials, assert
   `dashboard/node_modules/.bin/wrangler --version` equals `4.42.0`, then run
   the existing token-bearing deploy step. Tests pin install/version/deploy
   ordering and prove the secret appears only on the final step.
4. Add a negative test/mutation that removes or renames the local binary and
   proves execution stops before the token-bearing step with no registry fetch.
   Run the fake preview→verify→production→record chain. The real proof is Task 2
   after PR 3, never before ingest hardening.

### Task 8 — Bound real HTTP bodies and House archives (**R9**)

1. Add one `bounded_http_request(method, url, *, headers, data=None, ...)` helper
   used by the real House, Senate GET/POST, and SEC httpx transports. It rejects
   declared oversize before iteration, counts decoded streamed bytes, aborts at
   `limit + 1`, closes the response, preserves Senate's multiple Set-Cookie
   values, and returns the existing `TransportResponse` on success. Keep
   redirects disabled and preserve existing timeouts/header/form behavior.
2. Define a typed `ResponseTooLarge` carrying URL, configured cap, declared size
   when present, and observed lower bound; exception strings never include
   response bodies or request headers.
3. House discovery validates the compressed body before writing, validates ZIP
   central-directory metadata before `archive.open`, requires exactly one
   regular XML member with a non-traversing basename, and streams that member
   through the uncompressed and ratio limits. Only after all checks pass are the
   ZIP/XML atomically archived.
4. Tests cover House, SEC, and Senate GET/POST; missing/lying `Content-Length`,
   chunk crossing the cap, exact
   boundary, close-on-error, duplicate/no XML, directory/symlink-ish member,
   traversal name, declared oversize, ratio bomb, corrupt ZIP, and no partial
   cache/meta writes. Existing fake transport tests remain byte-identical.
5. Run a repository-wide `response.content`/`read_bytes`/`archive.read` sibling
   inventory. Record each remaining full-body consumer as: covered transitively
   by SecClient; bounded by an authenticated manifest/file-size contract;
   local-only; or a separately owned remote path with its own explicit cap. Any
   unauthenticated remote consumer in the House/Senate/SEC ingest risk class
   joins this helper and tests; no unexplained match remains.

### Task 9 — Share and enforce the hardened XML helper (**R10**)

1. Move the existing 13F settings into `src/populus/parse/xml.py` and implement
   exactly LD11's `parse_untrusted_xml(xml_bytes) -> Element`: fresh parser,
   `ElementTree` parse, explicit non-empty `docinfo.doctype` rejection, then
   root return. Update 13F, House discovery, and member hints; remove duplicate
   or bare parser creation and map `UnsafeXmlError` into each current failure
   surface.
2. Tests feed external file entities, external HTTP entities under the no-socket
   fixture, internal DTD/entity expansion, malformed XML, and deep/huge trees.
   Require no local-file content in output, zero socket attempts, and a named
   parse failure. Preserve valid fixture output exactly.
3. Mutation-check each security flag by temporarily enabling entity resolution,
   DTD/network, recovery, or huge-tree behavior and proving at least one test
   fails for each meaningful mutation.

### Task 10 — Make CSP/HSTS an attested deployment control (**R12, R15**)

1. Move the Base-layout pre-paint theme IIFE to
   `dashboard/public/theme-init.js` and load it synchronously from the head.
   Prove no executable inline script remains in built HTML; application/json
   data blocks remain inert and use R6.
2. Add `_headers` with LD13 CSP, HSTS, nosniff, and the existing referrer policy.
   Do not add CORS restrictions to public JSON assets and do not add cookies.
3. Implement LD12/LD12b literally across every producer/consumer:
   `publish/inventory.py`, `deploy/snapshot.py`, `deploy/verify.py`,
   `deploy/record.py`, `deploy/orchestrator.py`, `cli.py`, artifact-facts, and all
   exact-key validators. Reuse `canonical_json`; validate the full mapping into
   `ValidatedInventoryV2` before any network/signing operation. Split the current
   `sweep_inventory` into that external full validation and internal
   `_sweep_entries`; make `_confirm_domain` accept the validated object, select
   one `InventoryFile`, and apply the same exact marker-header and control-path
   effect checks without constructing a synthetic envelope. Add no historical-v1
   parser or live-path union/fallback. Pass partial, v1-shaped, missing-control,
   and unknown-control mappings to every external
   seam and prove failure before network/signing. `publish/digests.py` receives
   only verification/tests: overall dist digest remains version 1 with unchanged
   framing and covers every uploaded byte; changing it requires a new reviewed
   plan amendment.
4. Extend preview and production verification to require `/_headers` 404 plus
   exact normalized CSP/HSTS/nosniff/referrer values on representative HTML,
   JS, CSS, and JSON paths. Add the expected header names to the allowlist only
   together with exact-value checks. A missing, weakened, duplicated/conflicting,
   or unexpected header fails verification and prevents/rolls back production
   under the existing protocol. Extend PR #35's classifier tests: a header or
   control finding always has findings beyond divergences and therefore never
   qualifies for the one 404 settle; a pure file-404 v2 result still gets
   exactly one full-inventory retry. Upgrade the HTTP response-header protocol to
   occurrence-preserving `multi_items()` and use one shared normalization helper
   so duplicated/conflicting policy headers cannot be collapsed before either
   ordinary verification or rollback capture.
5. Implement LD12a/LD12c before changing production. Replace the orchestrator's
   typed prior-deployment lookup with the current raw
   `raw_deployments(environment="production")` seam. Invoke
   `capture_rollback_expectation` after branch/domain preconditions but before
   `freeze_tree`; one observer response must produce prior body, exact markers,
   and header snapshot, and raw provider reads bracketing that response must
   retain the same production id. After rollback, require the raw rollback result to name
   the captured id/production/no-Functions and a fresh observation to match.
   Add v1→v2, v2→v2, wrong-id/environment/body/marker/header/Functions,
   unavailable/malformed/concurrently-changed capture, and call-order tests; any capture failure must
   show zero snapshot, upload, or provider-mutation calls.
6. Apply LD12b count semantics to snapshot, CLI, verification result, deploy
   outcome, and signed record. The signed generation names
   `inventory_version="2"`, `inventory_digest`, the exact controls identity,
   served-file counts, and separately named origin/domain control-effect counts;
   a successful sign requires each control total/verified value to equal one.
   No redundant unauthenticated “control digest” field exists. Run render tests against
   exact `_headers` bytes, inventory/digest/CLI/artifact-facts tests, the full
   fake deploy/record/orchestrator suite, preview verification, then a supervised
   production deploy and live `curl` checks on HTTPS and the HTTP redirect.

### Task 11 — Dispose of the unrelated Cloudflare token safely (**R14**)

1. Outside CI, enumerate both account-owned and user-owned tokens plus authorized
   applications/account memberships. Record only token id/name, scope summary,
   expiry, last-use/consumer evidence, and disposition; never the bearer value.
2. Search owner-controlled automation/keychain/config references for the exact
   token id/name. If no consumer is found after provider last-use and local
   inventory review, revoke it and verify Populus deploy/sign/monitor plus any
   identified Cloudflare Agent consumer.
3. If used, mint an expiring least-read replacement scoped to the identified
   resource, migrate and verify that consumer, then revoke the non-expiring
   token. Update `ARCHITECTURE.md` debt item 11 with date/evidence and close it
   only after revocation.

### Task 12 — Documentation, proof, and promotion gate (**R1–R15**)

1. Update architecture/runbooks/status claims only after their code/settings
   exist. Specifically correct the current false claims that Dependabot already
   watches pins and Wrangler is already in the lock.
2. Reconcile `git status --short`, `git diff --name-status <base>...HEAD`, and
   this plan's Scope. Declare every deviation and any remaining debt.
3. Run the Verification Matrix and full gate set per PR. Capture command,
   tool version, base/head, exit code, and concise output; redact values, not
   evidence structure.
4. Keep publishing disarmed through PRs 1–4. Do not run production or mark the
   public-promotion gate complete until R2-R10 and R13 are live on protected
   main and both supervised environment-secret deployments succeed. R12 closes
   only declared `_headers` integrity in PR 5; R14 disposes of the unrelated
   token. Neither may be represented as closing the carried provider/point-in-
   time/credential-window residuals.

## Verification Matrix

| R-id | Primary verification | Required success evidence |
|---|---|---|
| R1 | fresh worktree commands; final changed-file reconciliation | base is fetched `origin/main`; initial/final status recorded; no dirty-branch adoption |
| R2 | workflow governance tests; fork PR | only `checks.yml` responds; all jobs hosted/read-only/secretless; self-hosted job count exactly one; fork checks pass |
| R3 | disposable-branch negative tests; `gh api repos/.../rulesets`; CodeQL result | active main target, empty bypass, one non-author/CODEOWNER approval, stale dismissal, exact four check contexts bound to GitHub Actions, high-or-higher CodeQL block, no force/delete/direct merge |
| R4 | environment API JSON; workflow structural tests; supervised dispatch; repo secret list | three main-only environments with exact secret names; production succeeds; repository secret count for the three names is zero |
| R5 | ignore tests; digest-pinned Gitleaks with full checkout/`--all`; trusted-base-policy mutations; GitHub settings JSON | no real hit; candidate policy cannot suppress findings; exact false-positive dispositions only; 100% redaction and no raw report; scanning/push protection/non-provider/validity enabled |
| R6 | serializer unit + adversarial real render/client parse | round-trip equality; no literal closing-script injection; exactly one inert data script; no executable injected node |
| R7 | Python hashed-export audit; `npm audit --audit-level=high`; lock diffs; `make security` | zero Python advisories and zero npm high/critical advisories; named vulnerable versions absent; dep_guard still green |
| R8 | package/lock assertions; direct-argv/order tests; missing-binary mutation; Wrangler version check | exact locked 4.42.0; only `dashboard/node_modules/.bin/wrangler` executes; no registry fetch; install and version check precede secret step |
| R9 | House/Senate GET+POST/SEC bounded-stream tests; ZIP bomb tests; sibling-consumer inventory; valid fixture parity | every declared/observed boundary and overrun fails as specified; Senate cookies survive; no partial writes or unexplained same-risk full-body consumer; valid outputs unchanged |
| R10 | XXE/DOCTYPE/entity/network/huge/malformed tests and flag mutations | every caller uses a fresh `parse_untrusted_xml`; any DOCTYPE is rejected; zero entity/file/network disclosure; valid outputs remain equivalent |
| R11 | required-CLI/config-object tests; `git grep` active config/code; ignore tests | launch file gone; four explicit path flags are required, no environment fallback exists, active owner roots are parameterized, intentional public docs/contact retained |
| R12 | exact full-v2/partial-envelope/count tests; internal-entry-sweep tests; pre-upload observer order tests; v1-to-v2 and v2-to-v2 rollback tests; PR #35 classifier mutations; fake deploy/record; built HTML scan; live `curl -sSI` | existing `canonical_json` binds exact control; all external paths reject v1/partial/missing/unknown controls before I/O; artifact/file/control counts keep fixed meanings; one coherent prior observation precedes freeze/upload and restores exactly; header findings never settle; exact live CSP/HSTS and HTTP redirect |
| R13 | Dependabot file validation; GitHub security API; CodeQL check; action-pin scan | all three ecosystems configured; security updates/private reporting/CodeQL active; every action full-SHA; workflow default read-only |
| R14 | owner-attested provider inventory and consumer smoke tests | old token revoked after unused/replacement proof; no bearer value stored; architecture debt accurately updated |
| R15 | evidence bundle + requirement/DoD/debt audit | every R-id has command/result; no false closure; legal, admin, expected-path/provider, preview/production-window, rollback-scope, and token-bearing-toolchain residuals explicitly remain |

### Exact standing and focused gate set

Run per PR, from the clean implementation worktree:

```bash
make check
uv run pytest -q tests/test_workflow_governance.py tests/test_publish.py \
  tests/test_deploy_cloudflare.py tests/test_deploy_upload.py tests/test_deploy_snapshot.py \
  tests/test_deploy_verify.py tests/test_deploy_record.py \
  tests/test_deploy_orchestrator.py tests/test_digests.py
uv run pytest -q tests/test_house_ingest.py tests/test_sec_client.py \
  tests/test_senate_ingest.py tests/test_inst_ingest.py tests/test_members.py
cd dashboard && npm ci && npm run check && npm test && npm run build:bounded && npm run test:post
```

The final `make check` is authoritative and must include the expanded security
gate. Focused commands improve diagnosis; they do not replace the full chain.
The implementation notes record the exact test filenames if the current suite
uses a different member-parser filename after rebaseline.

### Remote/public postconditions

Use authenticated `gh api` reads (never secret values) to prove repository
settings, and unauthenticated/live reads for the public site:

```bash
gh api repos/johnbaekk-spec/populus/rulesets
gh api repos/johnbaekk-spec/populus/environments
gh api repos/johnbaekk-spec/populus/actions/permissions/workflow
gh api repos/johnbaekk-spec/populus \
  --jq '{visibility,security_and_analysis}'
gh secret list --repo johnbaekk-spec/populus
curl -sSI http://publicfilings.org/
curl -sSI https://publicfilings.org/
curl -sSI https://publicfilings.org/stats.json
```

The runbook supplies `jq -e` predicates for the exact R3/R4/R5/R13 state. Raw
API responses that include unrelated account data are not committed.

## Rollout and Rollback

### Global safety order

1. Before PR 1, disarm publishing and confirm that no production job is running.
   Keep it disarmed through the PR 4 merge and first supervised proof.
2. Merge only independently reviewed PRs in the fixed PR 1→PR 5 order. Run the
   full standing gate and the PR's focused tests before every merge.
3. Never use a production dispatch as a PR 1 or PR 2 proof. The first production
   dispatch is permitted only after PR 3's ingest hardening and PR 4's
   environment/Wrangler cutover are both on protected `main`.

### PR 1 — governance, scanning, metadata

Merge the hosted checks and metadata, validate the ruleset on the disposable
probe branch, then activate that validated JSON for `main` and enable the R5/R13
security settings. Re-read every setting through the API. Publishing remains
disarmed.

Rollback: revert a faulty workflow/config change through the protected process.
If a required context is misnamed, correct that exact context in the ruleset;
do not remove PR review, force-push/deletion protection, or all required checks.
A scanner false positive receives only the reviewed fingerprint/rule+exact-path
exception defined in R5.

### PR 2 — application, dependencies, paths

Merge after render, lock, advisory, and CLI-path tests pass. No production
dispatch occurs. Static preview/build output may be inspected without a
Cloudflare credential.

Rollback: revert only the failing PR 2 slice. Do not restore a vulnerable lock
or unsafe JSON serializer to recover availability; fix compatibility at the
smallest caller/dependency boundary while publishing stays disarmed.

### PR 3 — ingest hardening

Merge after hermetic limit/parser tests, then run one credential-free supervised
ingest against the fixed government hosts without publishing its output. Record
largest observed sizes and failure classifications, never response bodies.

Rollback: if a legitimate response exceeds a cap, leave publishing disarmed and
revert PR 3 only if needed to restore non-production ingest. Measure the
legitimate artifact, review a narrow plan amendment, add a boundary fixture,
then change the constant; never raise a cap during a live failing job.

### PR 4 — environments and locked Wrangler

Before merge, create the three branch-restricted environments and populate their
secrets from authoritative sources. Merge the workflow/direct-binary cutover,
run one supervised main dispatch, verify the signed deployment generation, then
delete the three repository-scope secrets. Run a second supervised dispatch with
repository scope empty. Re-arm scheduling only after both hardened runs pass.

Rollback: disarm first. If environment lookup fails, keep repository secrets
deleted and repair the environment; never add a repository-secret fallback. If
deployment changed, use the dashboard rollback runbook and verify the captured
prior generation. Revert PR 4 only through the protected process, restoring no
runtime Wrangler download.

### PR 5 — inventory v2 and response headers

Capture and validate the raw prior deployment plus one coherent custom-domain
root observation before freezing or uploading anything. Deploy preview with
inventory v2, verify all existing expected paths plus the exact control effects,
and only then deploy production through the compensating rollback. Do not
preload HSTS. A one-year policy without `preload` or `includeSubDomains` remains
reversible by serving `max-age=0` over HTTPS.

Rollback: use LD12a's captured prior deployment identity, root body, markers,
and header expectations—never the attempted v2 inventory—to verify restoration.
For a bad policy, ship a reviewed `_headers` correction and require preview
verification before another production attempt. Never special-case the verifier
to accept missing or weakened CSP/HSTS on the affected build.

## Simplicity Audit

Every new implementation unit is enumerated here:

1. `.github/CODEOWNERS` — ownership metadata; no executable logic.
2. `.github/dependabot.yml` — three ecosystem entries; no custom updater.
3. `.gitleaks.toml`/`.gitleaksignore` — scanner configuration with exact
   exclusions only; no homegrown secret regex engine.
4. `SECURITY.md` — disclosure policy.
5. `docs/runbooks/github-security.md` — the single location for remote-setting,
   history-response, and quarterly audit commands.
6. `dashboard/src/lib/inline-json.ts` — one pure serializer; it replaces three
   local variants and reuses the existing HoldingsTable mechanism.
7. `src/populus/net/bounded_http.py` — one `bounded_http_request` helper and one
   `ResponseTooLarge` error; House, Senate GET/POST, and SEC real transports
   reuse them without changing fake protocols.
8. `src/populus/parse/xml.py` — one exact byte-in/root-out helper; it moves
   existing hardened settings, adds only `UnsafeXmlError`, rejects DOCTYPE, and
   deletes bare parser calls.
9. `dashboard/public/theme-init.js` — existing inline code moved byte-for-byte
   to satisfy `script-src 'self'`; no new behavior.
10. `dashboard/public/_headers` — one provider policy file.
11. `scripts/build_m2_11_qa_bundle.py::QaBundlePaths` — one frozen configuration
    dataclass at the existing CLI boundary; it replaces four owner-path globals
    and creates no second config loader or environment seam.
12. `src/populus/publish/inventory.py` — `InventoryFile`, `InventoryControl`,
    `ValidatedInventoryV2`, `InventoryError`, and `validate_inventory_v2`;
    these promote the existing verifier entry shape into the one exact typed
    envelope and reuse
    `populus.canonical.canonical_json`. No second RFC 8785 implementation exists.
13. Inventory compatibility boundary — no `HistoricalInventoryV1`, v1 parser,
    live-path union, or auto-detect is introduced. Pre-v2 signed records remain
    immutable archival bytes; LD12a observes the prior site for rollback.
14. `src/populus/deploy/verify.py` — package-internal `_sweep_entries`, shared
    `normalize_security_header_multimap`, and the occurrence-preserving
    `HeaderMultimap` protocol added to the existing `HttpResponse` boundary.
    These split trusted typed-entry I/O from untrusted envelope validation and
    make duplicate policy headers observable; no second HTTP client or verifier
    is introduced.
15. `src/populus/deploy/orchestrator.py` — frozen `RollbackSiteObservation` and
    `RollbackExpectation`, injected `RollbackObserver`, the sole producer
    `capture_rollback_expectation`, and production adapter
    `observe_rollback_root`. They reuse current raw deployment reads,
    marker parsing, header normalization, `HttpGetter`, and the
    existing deployment exceptions; no new provider client or exception family
    is added.
16. `src/populus/deploy/record.py::_confirm_domain` — a modified shared boundary,
    not a new verifier: it receives `ValidatedInventoryV2`, calls the internal
    entry sweep for the marker, and records separately named served-file and
    control-effect evidence without constructing a partial inventory.

No new service, framework, datastore, runtime daemon, sanitizer, workflow
language, deployment artifact, or package tree is introduced. Wrangler reuses
the dashboard lock. GitHub native rules/scanning/CodeQL/Dependabot are preferred
over a custom settings daemon. The only schema evolution is site-inventory v2,
required because a Cloudflare provider control is uploaded but not served;
pre-v2 records remain unchanged but no production v1 inventory parser exists. The
units above are the complete new file/dataclass/exception/helper/validator/
parser/protocol and modified shared-boundary set authorized by this plan;
discovering another requires updating this audit before implementation review.

## Tech Debt Introduced

1. **TD-PSH-1 — Repository-admin settings bypass remains.** Even a no-bypass
   repository ruleset can be edited by the repository administrator. Owner:
   repository owner. Removal condition: move production secrets, runner
   registration, and release workflows to a separately administered private
   automation repository or enforce immutable organization/enterprise rules.
   This is pre-existing trust concentration made explicit, not created by code.
2. **TD-PSH-2 — Scheduled deploys cannot require per-run human environment
   approval.** Environments restrict to reviewed `main`, but do not require
   reviewers because nightlies are unattended. Owner: repository owner. Removal
   condition: replace nightlies with an approved promotion model or a custom
   protection rule that can attest reviewed artifacts without a human wake-up.
3. **TD-PSH-3 — CSP retains inline styles.** `style-src 'unsafe-inline'` remains
   because generated bar/band geometry uses inline style attributes
   (`dashboard/src/lib/format.ts:682`, `dashboard/src/lib/ui.ts:126-139,1199-1200`,
   `dashboard/src/pages/congress/index.astro:205-208`). Owner: dashboard owner.
   Removal condition: replace dynamic style attributes with a bounded class/CSS
   custom-property design and remove `unsafe-inline` from `style-src`. Script
   execution remains strict in this run.
4. **TD-PSH-4 — Advisory availability is network-dependent.** PyPI/GitHub/npm
   advisory services can be unavailable; the gate fails closed, potentially
   delaying a release. Owner: release owner. Removal condition: a reviewed,
   mirrored advisory database with freshness attestations. “Skip on outage” is
   not a removal condition.
5. **TD-PSH-5 — Deployment verification remains expected-path and point-in-time.**
   R12 binds and observes the declared `_headers` control, but it does not prove
   the absence of every unexpected provider route, transform, zone rule, or
   later provider-side change. Owner: deployment owner. Removal condition: add
   a separately attested provider/zone configuration snapshot and a closed-world
   route/control inventory that the provider can actually prove.
6. **TD-PSH-6 — Preview and production verification windows remain.** The
   preview URL is provider-accessible before verification completes, and the
   production deployment exists briefly before post-upload verification can
   trigger rollback. Owner: deployment owner. Removal condition: provider-side
   atomic promotion of a preverified immutable artifact or equivalent traffic
   switch. This is pre-existing provider behavior, not closed by R12.
7. **TD-PSH-7 — Token-bearing npm toolchain remains in the deploy boundary.**
   Direct execution of an exact locked Wrangler removes runtime package
   resolution, but its committed npm dependency graph still processes a Pages
   credential during deploy. Owner: deployment owner. Removal condition: a
   verified minimal uploader or separately isolated deployment service with a
   smaller dependency/credential boundary.
8. **TD-PSH-8 — Rollback does not prove the prior full tree.** LD12a proves the
   captured prior provider id, root bytes, build/code markers, exact headers,
   and absence of Functions; it cannot reconstruct a v1 inventory that was
   never retained. Owner: deployment owner. Removal condition: all retained
   generations have a signed v2 inventory/control record and the provider
   exposes immutable restoration by that identity.

These pre-existing residuals are deliberately carried forward alongside debt
introduced or retained by this run. Implementation must add any newly discovered
debt here before review. Broad Gitleaks path ignores, repository-secret
fallbacks, `unsafe-inline` script, remote Wrangler installation, unbounded
“temporary” fetches, or a general v1 auto-downgrade are forbidden shortcuts,
not accepted debt.

## Memory Touch-Points

The plan consulted the repository workflow memory index and the ten highest-hit
planning/review records for public-repository security, dependencies, anchors,
and review convergence:

- `feedback_plan_development_vs_execution.md` — separates this approved plan
  from later code/settings mutation and makes operator steps explicit.
- `feedback_dependency_gate_landed_code.md` — R7/R8 require lock and gate wiring,
  not a prose-only dependency recommendation.
- `feedback_explicit_plan_contracts.md` — exact ceilings, environment names,
  trigger allowlist, CSP, and failure behavior are locked.
- `feedback_plan_anchor_verification.md` — Task 0 re-resolves base/path/line
  anchors before edits.
- `feedback_plan_decision_lock.md` — the independent reviewer, nightly approval
  tradeoff, limits, inventory v2, and history policy are decided rather than
  left as implementation questions.
- `feedback_plan_rebaseline.md` and
  `feedback_stale_review_snapshot_detection.md` — the plan is SHA-pinned and
  requires rebaseline if main advances.
- `feedback_plan_review_discipline.md` — this plan is sent to an independent
  plan-review agent and revised on all blockers before implementation.
- `feedback_executable_plan_wiring.md` — every remediation appears in
  requirements, tasks, verification, rollout, and DoD.
- `feedback_feature_branch_plan_tracking.md` — the approved plan is copied onto
  the clean implementation branch, not left only in the dirty planning tree.

The shared deterministic failure-mode catalog was also loaded; the relevant
sweep follows.

## Failure-Mode Sweep

| Failure mode | Prevention/detection |
|---|---|
| Plan applied to stale or dirty tree | SHA pin, clean worktree, Task 0 anchor and changed-file reconciliation |
| Fork PR reaches self-hosted runner | trigger/job structural allowlist with equality and killing mutations |
| Fork PR steals secrets on hosted runner | read-only permission, no environment/secret/reusable workflow, fork test |
| Required check can be spoofed | bind ruleset checks to GitHub Actions app; independent review; no bypass actors |
| Solo maintainer self-approves | hard second-account prerequisite; non-author approval and stale dismissal |
| Ruleset negative test damages `main` | prove direct-push/check/CODEOWNER/stale-review behavior on disposable `security-ruleset-probe`; retarget validated JSON only afterward |
| Environment migration creates outage | disarm, provision first, merge, supervised dispatch, delete repo fallback last |
| Reusable signer silently sees repository secret | remove caller mapping/declaration; job environment exact-structure test |
| Scanner misses history after shallow checkout | `fetch-depth: 0`, pinned container, `--log-opts="--all"`, and killing mutation |
| Fork edits scanner policy to hide a secret | materialize config/ignore from trusted base SHA into read-only temp files; candidate-policy mutation must fail |
| Scanner leaks a found secret into logs/artifacts | `--redact=100`, no report/summary/upload, redaction/removal mutations |
| Scanner is green through broad allowlist | exact fingerprint/rule+path exclusions only; blanket-ignore mutation is killed |
| Secret found and history rewritten before revoke | incident ordering in R5/Task 4; rewrite is a separately coordinated operation |
| `</script>` survives alternate casing/data | escape every `<`; real rendered DOM and JSON round-trip adversarial tests |
| Audit scans developer env, not shipped lock | uv frozen production export with hashes; npm audit after `npm ci` |
| Python advisory survives an unsupported threshold parser | any `pip-audit` advisory is red; npm alone uses supported `--audit-level=high` |
| Deploy downloads a new CLI while token is live | invoke exact local Wrangler path directly; install/version before secret; missing-binary test proves no registry fetch |
| Production proof runs before ingest hardening | publishing disarmed through PR 4; first dispatch requires PR 3 and PR 4 on protected main |
| Server lies about body length | precheck plus streamed observed-byte counter and close-on-overrun |
| Senate POST/GET bypasses the shared cap or loses cookies | both real methods use the helper; boundary tests plus multi-value `Set-Cookie` parity |
| ZIP central directory understates expansion | streamed extraction counter plus ratio and uncompressed-size checks |
| XXE hardening applied to one parser only | one shared helper, grep absence of bare lxml parser, mutation tests |
| DTD slips through despite parser flags | parse an `ElementTree`, reject non-empty `docinfo.doctype`, and test internal/external doctypes |
| New artifact silently downgrades to v1 | new producer/upload/sign/verify paths require exact v2; no production v1 parser or auto-detect exists |
| Domain marker reuse weakens the full-v2 validator | validate the full document into `ValidatedInventoryV2`; `_confirm_domain` passes one typed entry to internal `_sweep_entries`; partial-envelope killing tests cover every external seam |
| Artifact, sweep, and control counts silently change meaning | LD12b fixes each existing count; separately named control-effect fields and record-schema tests prevent mixed denominators |
| `_headers` disappears from served inventory and becomes unattested | dist digest includes it; canonical full-inventory digest binds the exact v2 control; exact observed effect; 404 probe remains |
| Header/control failure is mistaken for propagation | PR #35 mutations prove only pure inventoried-file 404 divergence gets one settle/full retry |
| Rollback verifies the failed artifact instead of the prior site | immutable prior provider/body/marker/header expectation captured before preview; v1-to-v2 and v2-to-v2 tests |
| Prior observation is unavailable, internally mixed, or races a deploy | one cache-busted, redirect-disabled root response supplies body, both markers, and header multimap; bracketing raw reads require a stable production id; failure precedes freeze/upload and has a zero-mutation order test |
| Raw provider signal is laundered through a typed object | use existing raw production list and raw rollback result; require exact id/environment and explicit `uses_functions is False` |
| CSP breaks theme/app | external pre-paint script; built-page browser/render tests; preview before production |
| Header allowlist is widened without policy proof | header name addition paired with exact-value verification and negative tests |
| HSTS makes rollback difficult | no preload; documented HTTPS `max-age=0` emergency rollback |
| Unknown Cloudflare token revoked while in use | consumer/last-use inventory, replacement smoke test, revoke last |
| Documentation claims settings landed when only YAML changed | live API postconditions and status update only after settings proof |
| New debt hidden in implementation | final Scope/status reconciliation and Tech Debt section review; undeclared debt blocks approval |

## Definition of Done

- **R1** — clean implementation worktree/base/head and final changed-file
  reconciliation are recorded; no current dirty-worktree changes were absorbed.
- **R2** — a real fork PR runs only hosted, read-only, secretless checks; the
  governance mutation suite kills self-hosted, secret, write, and reusable-call
  regressions; production workflows have no PR-like trigger.
- **R3** — an independent accepted collaborator approves the remediation; the
  disposable-branch probe proves negative behavior; the active main ruleset API
  proves every exact R3 control, empty bypass actors, the four literal GitHub
  Actions contexts, and the high-or-higher CodeQL threshold.
- **R4** — all three exact main-only environments work in a supervised deploy;
  the three production secret names no longer exist at repository scope; job
  privilege separation tests pass.
- **R5** — ignore rules, GitHub scanning/push protection/non-provider/validity,
  and digest-pinned full-history Gitleaks are active; trusted-base policy,
  redaction/no-raw-output, full-fetch, and narrow-ignore mutations pass; zero
  real secrets; exact false positives documented; incident order committed
  without a history rewrite.
- **R6** — one serializer is used by all four data embeds; adversarial rendered
  pages cannot create executable markup and JSON round-trips exactly.
- **R7** — named vulnerable versions are absent; Python production-lock and npm
  audits report zero Python advisories and zero npm high/critical advisories;
  expanded `make security` and dep_guard pass.
- **R8** — Wrangler 4.42.0 is exact in package and lock; deploy uses only the
  direct installed binary; no `npm exec`, `npx --yes`, package override, or
  remote fallback; missing-binary, order, version, and supervised proofs pass.
- **R9** — House, Senate GET/POST, and SEC real transports plus House ZIP
  extraction enforce every exact ceiling; Senate cookie parity, sibling
  inventory, boundary/bomb/partial-write tests pass; valid fixtures are unchanged.
- **R10** — every in-scope XML path uses the exact fresh
  `parse_untrusted_xml` helper; any DOCTYPE, XXE/entity, network, malformed, and
  huge-tree tests plus mutations pass.
- **R11** — tracked launch config is gone; the four path flags are required and
  collected into one frozen object with no environment fallback; local wrappers
  are ignored; intentional public contact/control docs are retained; no
  benign-path history rewrite occurred.
- **R12** — new artifact/upload/sign/verify paths require the exact canonical v2
  schema and control through `ValidatedInventoryV2`; no production v1 parser or
  auto-detect exists; partial/malformed/downgrade cases fail before I/O;
  `_confirm_domain` uses only a typed entry; artifact, served-file, and
  control-effect counts match LD12b; PR #35 header/control failures never settle;
  capture failure/provider-id drift produces zero mutation; v1-to-v2 and v2-to-v2
  rollback prove one stable raw prior identity plus coherent body/markers/header multimap;
  built pages have no executable inline JS; exact preview/production CSP/HSTS
  and live curl proof pass; the signed generation records inventory/control
  identity and separate control evidence.
- **R13** — SECURITY, CODEOWNERS, all three Dependabot ecosystems, security
  updates, private reporting, CodeQL, SHA action pins, and read-only workflow
  defaults are present and API-observable.
- **R14** — the user-owned non-expiring Cloudflare token is revoked after an
  unused or migrated-consumer proof; no bearer value is stored; architecture
  debt is updated honestly.
- **R15** — evidence maps every R-id to commands/results and names remaining
  admin/nightly/CSP-style, expected-path/provider, preview/production-window,
  rollback-scope, and token-bearing-toolchain debt plus the separate counsel
  gate; docs make no unearned closure claim.
- Each PR's focused tests and full `make check` are green. The final run contains
  no skipped security test whose precondition should exist in CI, no Python
  advisory, no npm high/critical finding, and no unresolved independent-review
  blocker.
