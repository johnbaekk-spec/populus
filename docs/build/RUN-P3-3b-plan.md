# RUN P3-3b — Deploy the dashboard, and sign what went live

> ## ✅ UNBLOCKED — the domain is Active with zero deployments
>
> **Revision 5** — the round-3 blocker is resolved by measurement, and it resolved
> *against* the reviewer's inference. **Revision 3's first-run and domain design
> stands as written** — scoped precisely: revisions 4–6 changed eight other
> requirements, and this banner speaks only to the activation question.
>
> Owner drove the domain to Active without creating any deployment. Verified on the
> Cloudflare side (`/pages/projects/publicfilings/domains`): `status: "active"`,
> `verification_data.status: "active"`,
> `validation_data: {status: "active", method: "http"}`,
> `certificate_authority: "google"`, and the project `domains` array now reads
> `["publicfilings.pages.dev", "publicfilings.org"]` — while `latest_deployment` is
> still **null**. Independently confirmed from outside the account:
>
> ```
> $ curl -sv https://publicfilings.org/
> subject: CN=publicfilings.org
> issuer:  C=US; O=Google Trust Services; CN=WE1
> SSL certificate verify ok.        expire date: Nov 1 2026
> ```
>
> **Round 3's 522 measurement was real; the inference from it was wrong.** The
> reviewer read "522 on `/.well-known/acme-challenge/`" as *validation is blocked*.
> It only ever meant *nothing is serving yet* — which is true and will stay true
> until the first deployment. Three things make the inference a mistake:
> Cloudflare validated through the zone it already controls (`publicfilings.org` is
> an active zone in this same account, apex CNAME → `publicfilings.pages.dev`,
> proxied), so no origin content was needed; the certificate came from **Google
> Trust Services**, not Let's Encrypt, so an ACME-path probe was not exercising the
> mechanism actually in use; and most directly, **an HTTPS 522 is itself proof the
> certificate works** — TLS terminated successfully before the origin lookup failed.
> The evidence was in the original measurement and was read backwards.
>
> The correction that matters for method: **probing beats arguing from
> documentation silence, but only when the probe measures the mechanism in use.**
> Revisions 2 and 3 argued from silence in opposite directions; round 3 probed and
> was still wrong, because it probed the wrong path and misread the status code it
> got. See `probe-dont-argue-from-silence`.
>
> **Consequences for the plan, all simplifying:**
> - **Rollout prerequisite 4 is SATISFIED**, not merely satisfiable. Domain
>   activation stays an owner provisioning step that never touches the per-deploy
>   path — which is exactly the property that made it survivable.
> - **The `*.pages.dev`-first fallback is dropped.** It is not needed, and it is
>   not carried as an alternative.
> - **R11's precondition assertion gains a real pollable surface.** The
>   `/pages/projects/{project}/domains` subresource returns `status`,
>   `verification_data` and `validation_data`, so the per-run check is programmatic
>   rather than by eye. (The *project* endpoint's bare string array remains
>   unusable for status — that finding stands.)
> - **Two Cloudflare claims are corrected:** the CA here is Google Trust Services,
>   so this plan's earlier Let's Encrypt rate-limiting citation was wrong twice
>   over — wrong as documentation, and wrong as the applicable CA.
>
> **Revision 7 — round 5 caught my own fix reproducing the defect it fixed.**
> R27 was written to replace an untestable §17(h) fixture with a testable property
> — and shipped with **no mutant and no seam**: the plan named "the signer path"
> while `src/populus/deploy/` contained no signer module at all. Fifth consecutive
> round to find a fix that reads as done. Now: `record.py` + `tests/test_deploy_record.py`
> are in Planned Files, R27 is scoped to that module's call surface (the deploy job
> legitimately POSTs), and its mutant is named.
>
> **The ticker map is now a decision, not a mechanism.** Round 5 proved revision 6's
> "stage a real `company_tickers.json`" was a branch CI can never take — no source
> exists on a runner, `populus-data` carries no copy, `build.py` emits none. Staging
> one would also have published an SEC file as congress-module data under congress
> licenses, inflated every recovery journal by ~1 MB, and made the manifest artifact
> set environment-dependent. **The site ships the honest no-map state (TD-7)** —
> worse than a real map, far better than fixture data served as production truth.
>
> Also: two more undeclared guard collisions (`env` must be step-scoped; the
> journal path can't appear in a `run` body), four stale citations including one the
> last sweep **over-corrected**, and the TD list renumbered.
>
> **Revision 6 — the confirmation round landed and found four more.** Round 4
> checked the six round-3 remediations: B4, B6 and B7 held; **B2 and B3 were
> text-only** (the sentence asserting the fix was present, the task/test/DoD wiring
> that would make it true was not), and **B5's fix moved the defect one step later**
> rather than closing it. That is the third consecutive round to catch a claim that
> merely *reads* as fixed. All four are now remediated with mechanism, not prose —
> §12.1 step 4 and §17(h) join §14's two as **recorded spec amendments** (T13), and
> the ticker map becomes a staged, manifest-listed artifact instead of a refusal
> whose only escape hatch was the forbidden fixture.
>
> **State: 27 requirements, 13 tasks, four spec amendments, six declared TD items.**
> No implementation exists — `src/populus/deploy/` is still absent. Round 4's
> remediations have not themselves been re-reviewed.
>
> ---
>
> **Revision 3** — addressed plan-review round 2 (7 blockers, 9 nits).
> Revision 2's failed mechanism is recorded here rather than quietly replaced —
> three successive first-run designs have now been rejected, and the record of
> *why* is the most useful thing this section carries.
>
> **The first-run design is rebuilt for the third time, and this time the
> mechanism is provisioning, not code.** Revision 2 replaced the `bootstrap` input
> with domain-activation polling. Round 2 falsified that on three independent
> counts, each verified against Cloudflare's own documentation:
>
> 1. **The field does not exist.** `GET /pages/projects/{project}` returns
>    `domains` as an **array of strings**. Per-domain `status` lives only on the
>    `…/projects/{project}/domains` subresource. Revision 2 polled a status that
>    the endpoint it pinned does not return.
> 2. **The claim was never documented.** Nothing in Cloudflare's docs says a
>    custom domain leaves `Initializing` because a production deployment exists.
>    Cloudflare's *actual* documented causes are **blocked HTTP validation**
>    (Access rules, redirects or Workers intercepting `/.well-known/acme-challenge/`),
>    **missing CAA records**, **zone holds**, proxy/grey-cloud state, and
>    "Cache Everything" page rules. *(Revisions 2 and 3 both cited Let's Encrypt
>    rate-limiting; that is community lore, not Cloudflare documentation — round 3
>    corrected it.)*
> 3. **The compensation is an operation the provider refuses.** Cloudflare's
>    known-issues page states deletion "will not delete the active production
>    deployment if one exists." Revision 2's "delete the deployment, restoring no
>    live site" is not a thing that can happen.
>
> So revision 2's tech-debt deletion was **wrong**: revision 1 had honestly
> declared a one-time unverified-deployment exposure, and revision 2 removed the
> declaration on the strength of a mechanism that does not exist. **It is
> restored** (TD-4), correctly scoped and with a real removal condition.
>
> **Domain activation becomes owner prerequisite #4** — confirmed via the domains
> subresource reporting `status: active` *before arming*. This is the same kind of
> one-time provisioning check as the three token prerequisites beside it, and it
> is why it survives the objections that killed three human-in-the-loop *deploy*
> designs: it never touches the per-deploy path.
>
> **Preserved from revision 2 — the site build was impossible as specified.**
> `dashboard/src/lib/data.ts:435` reads `manifest.json` unconditionally and `:86`
> derives which surfaces exist from `manifest.modules`, while revision 1's seam
> moved manifest assembly *after* the site build. Round 2 found the fix incomplete
> in two more places: **nothing in the tree emits `dist/stats.json`** at all (R24),
> and the provisional manifest would **self-list** through `build.py:1849`'s
> `rglob` (R2). Both are addressed here.

## Goal and Success Criteria

Put the built dashboard on `https://publicfilings.org` through the §12.1
protocol, and record a signed, independently-verifiable receipt of what went live.

**Success** = a run that builds the site from the staged verified data build,
publishes and attests the data, deploys to a **preview** and verifies it, deploys
the **same bytes** to production, verifies the live custom domain, and produces an
**attested deployment generation** — with every gate failure after the first
successful deploy leaving production serving the prior build.

**The single exception, declared not hidden (TD-4):** on the *first* production
deploy there is no prior deployment to roll back to, and Cloudflare will not
delete an active production deployment. A first run that passes preview
verification but fails production verification therefore leaves an unverified
deployment serving, remediable only by owner action (R23's runbook). This
exposure exists exactly once and is gone permanently after the first success.

## Requirements

### The site build, and the manifest it depends on

- **R1** — **`publish.yml` builds the site** from the staged verified data build.
  No `npm`/`astro`/`dashboard` step exists today. Node comes from
  **`dashboard/.node-version`** (not the repo root — there is none), deps from
  `npm ci`, and **Wrangler pinned to an exact version** in `dashboard/package.json`
  + lockfile, where it is currently absent. The CI path must supply
  `POPULUS_BUILD_DIR`, `POPULUS_DB`, `POPULUS_TICKER_MAP` and `SITE_CODE_SHA`.

  **The env contract is not what revision 3 claimed, and the gap ships bad data.**
  `data.ts:113-118` refuses its dev fallback under `CI` for **only the first two**.
  `POPULUS_TICKER_MAP` is read in `dashboard/src/lib/inst.ts:311-315` and, when
  unset, **silently falls back to the committed test fixture**
  `tests/fixtures/inst/mcp/company_tickers.json`. A CI build that omits it would
  deploy **fixture-derived ticker mappings as production data** — and R15's sweep
  cannot detect it, because the served bytes would faithfully equal the built
  bytes. This is a live hazard in the existing dashboard, not only a plan defect.
  **Refusing an unset variable is not enough — the runner has no other file to
  point at.** `company_tickers.json` lives only in `data-cache/inst/registry`
  (`cli.py:428,527`); `build.py` emits none; `publish.yml:62-73` ingests congress
  only. So on the runner the *only* path satisfying `POPULUS_TICKER_MAP` is the
  forbidden fixture, and a refusal-on-unset converts a silent hazard into a hard
  failure whose one available remedy is to point at the fixture — the same defect
  moved one step later. And the exposure is not inst-only: `data.ts:530` calls
  `readTickerMapJson` **unconditionally**, feeding the search index (`:544`) and
  `resolveTicker` (`:612`), so a congress-only nightly ships it too.

  **Fix — and it is a decision, not a mechanism, because no mechanism exists.**
  Round 5 established there is **no source for a real ticker map on a CI runner**:
  the file reaches this tree only via `populus identity bootstrap --from-cache
  data-cache/inst/registry` (`cli.py:428,527`), `data-cache/` is not in git,
  `populus-data` carries no copy (checked), `build.py` emits none, and no fetch path
  exists outside that flag. Revision 6 proposed staging "a real
  `company_tickers.json`" — a branch CI could never take. So:

  **(a) The production site ships the honest no-map state.**
  `POPULUS_TICKER_MAP` is set to an explicitly absent path; `inst.ts:316` already
  returns `null` for that, `resolveTicker` is null-safe, and the ticker surfaces
  render `no-map` rather than inventing names. This is a real degradation —
  search-index ticker names become `""` (`data.ts:544`) and ticker pages show the
  no-map state (`:612`) — and it is **declared as TD-7**, not hidden. It is
  strictly better than the alternative it replaces: fixture-derived mappings
  presented as production data, which R15's sweep cannot detect because the served
  bytes would faithfully match the built bytes.
  **(b) The CI refusal rejects the fixture path itself**, not merely an unset
  variable, so the escape hatch is closed by construction. The workflow lint
  asserts the full env contract.

  **Staging the map into `build_dir` is explicitly rejected**, because round 5
  showed it collides with three invariants the provisional-manifest analysis (R2)
  had already surfaced and nobody re-ran for this file: `build.py:1849-1865` would
  publish an SEC file as **congress-module data under congress ingestible
  licenses** (`manifest.py:33` `LICENSING_ARTIFACTS`); `build_journal` (`:685-689`)
  inlines every build-dir file verbatim, growing every recovery journal by ~1 MB;
  and because the file exists only when a registry copy does, the **manifest
  artifact set would become environment-dependent** — the same build id producing
  different artifacts locally and in CI, which `tests/test_publish.py:329-341`
  cannot catch because line `:339` is a **subset** assertion (`} <= names`), not the
  exact-set check revision 2 claimed.
  (`SITE_CODE_SHA` has no CI refusal either, but R19's exact marker comparison makes
  that one fail closed.)

  **T5 collides with a SECOND guard in the same file, and it is not optional.**
  `tests/test_publish.py:1998` asserts `len(pat_steps) == 2` and `:2001` requires
  every PAT-bearing step's `run` to contain `"populus build"` or `"populus publish"`.
  T5 splits `populus build` (`publish.yml:67-73`) into `stage-build` +
  `finalize-build` around the site build — they **cannot** share a step, and
  `"populus build" not in "populus stage-build"`. Resolution, on the record: the
  substring set becomes `{"populus stage-build", "populus finalize-build",
  "populus publish"}` and the count becomes **3** if both phases need the PAT, or
  stays 2 if `finalize-build` writes only inside the runner workspace — T5 must
  determine which and state it. R21 declares the analogous break at
  `test_attestation_structure.py:245`; revision 4 declared this one nowhere.

  **Two further guards, declared here rather than discovered during
  implementation.** `tests/test_publish.py:1962` asserts `"env" not in workflow`
  and `:1966` asserts `"env" not in job` — so **all four env vars must be
  step-scoped**; a workflow-level or job-level `env:` block fails immediately.
  And `:1979` asserts `"journal" not in run` for every publish-job step, which
  constrains T5's `finalize-build` CLI surface (it writes the journal) exactly as
  `:1978`'s `.staging` guard constrains T8 — same declare-don't-relax obligation,
  resolved the same way: the journal path is derived inside the command, never
  named in the `run` body.

  **T8 collides with a further guard that must be declared, not quietly
  relaxed.** `tests/test_publish.py:1978` asserts no publish-job step's `run` body
  contains `.staging`, while R1 requires building from
  `populus-data/.staging/<id>/build`. Resolution: **derive the staged path in a
  helper** so the literal never appears in a `run` body, leaving the guard intact
  and unamended. If that proves impossible the guard is amended **on the record**
  with its reason — never edited to make a change pass.
- **R2** — **A two-phase build seam, specified for all three of `run_build`'s
  outcomes.** `run_build` returns three ways: a **preserved** staged build
  (`build.py:1541`, journal-backed, "preserved verbatim, never re-produced"), an
  **already-reconciled completed** build (`:1557`), and only past `:1569` a
  **fresh** assembly. The seam is:
  `stage_build()` → writes the data artifacts **and a provisional manifest** (the
  site needs it, R19) → site builds →
  `finalize_build(staged, *, site_file_count, dist_dir)` — **`dist_dir` is in the
  signature because R24 requires this same writer to patch `dist/stats.json`, and a
  function that cannot see `dist/` cannot be the single writer**
  → patches `stats.json` with the count, **re-assembles the manifest**, writes the
  journal. `run_build` is retained as a wrapper for its **49 call sites across 8
  files — of which exactly 4 are production** (`src/populus/cli.py:791`,
  `scripts/accept_m1_b.py:749`, `scripts/accept_m2_5.py:124`,
  `scripts/accept_m2_6.py:112`); the other 45 are tests, 40 in
  `tests/test_publish.py`. *(Revision 2 said "~180", a figure lifted from
  `test_attestation_structure.py:18`, which counts calls to the whole
  attestation-taking set. The wrapper is still justified — by 4 production callers
  and one CLI surface, not 180.)*
  **The provisional manifest must not self-list.** `build.py:1849` does
  `sorted(build_dir.rglob("*"))` and hashes every file into a manifest entry, and
  `:1903` writes `manifest.json` *after* that walk — which is precisely why the
  manifest is never currently self-listed. A provisional manifest sitting in the
  build dir at `:1849` would therefore acquire a self-entry whose digest goes stale
  the moment finalize re-assembles, breaking `tests/test_publish.py:329-341`'s
  exact artifact-name set and `validate_manifest` at `:1896-1902`. **`finalize_build`
  deletes the provisional manifest before re-assembly**, so the walk sees the same
  file set it sees today. Downstream, `build_journal` (`:664-706`) inlines every
  build-dir file as text (`:686-690`) and `tests/test_publish.py:673` anchors
  recovery on `committed_manifest == journal["artifacts"]["manifest.json"]`;
  `materialize_from_journal` (`:853-875`) must still reproduce it byte-for-byte.
  **Non-fresh outcomes do not deploy**: a preserved or reconciled build is already
  published, so the workflow skips the deploy leg rather than re-producing a sealed
  journal — and **says so visibly**, in the job summary rather than only in logs, so
  an operator who dispatched a redeploy is not shown a green run that deployed
  nothing (R23 records this). Fixtures required for all three outcomes, plus one
  asserting the final manifest does not list itself and that journal-materialized
  recovery is byte-identical.
- **R3** — **`stats.json` byte-equal** in the canonical artifact and `dist/`, and
  the **schema carries the new field without breaking the gates**.
  `tests/schemas/stats.schema.json` is `additionalProperties: false` with a
  `stats_version` const, and it is validated across **three files and 10 call
  sites**, not the two revision 2 claimed: `tests/test_stats.py:19-21` alone holds
  **7** and runs unconditionally under `make test`; `scripts/accept_m1_b.py:709`
  runs under `make accept-m1-b`; and `tests/test_members.py:817` — the one revision
  2 leaned on — sits behind a `skipif` on a local data cache
  (`tests/test_members.py:690-696`) and **normally does not execute at all**.
  Therefore: `compute_stats` emits `site_file_count: null`; the schema **requires**
  the key with type `["integer","null"]`; and a **publish-time assertion, not a
  schema rule**, rejects a null or zero count on the deploying path. A schema-only
  rule would either break the unconditional `test_stats.py` validators or fail to
  distinguish "the workflow wrote the count" from "the wrapper wrote nothing".
  Byte-equality is a *separate* obligation and nullability does not discharge it —
  see **R24**, without which there is no `dist/` copy to be equal to.
- **R24** — **Something must emit `dist/stats.json`, and nothing currently does.**
  ARCHITECTURE `:689` requires the count written "into the one `stats.json` in
  *both* places identically … assert the two copies are byte-equal", and `:686`
  and `:856` make the served copy a per-deploy gate. In this tree
  `dashboard/public/` contains only `favicon.svg`, `dashboard/astro.config.mjs` has
  no copy step, and `dashboard/src/lib/data.ts:433-434` only **reads** the file.
  Add an emitter (an Astro endpoint route, `dashboard/src/pages/stats.json.ts`,
  following the existing `congress/data/feed.v1.json.ts` precedent; `astro.config.mjs`
  is `output: "static"` with no adapter, so it prerenders).

  **Byte-equality needs a named mechanism, and re-serialization is not one.** The
  canonical copy is rendered by `src/populus/stats.py:326-328` as
  `json.dumps(..., ensure_ascii=False, indent=2, sort_keys=True) + "\n"`. An
  endpoint that parses and re-serializes will not reproduce those bytes, and
  `data.ts:433-434` **discards the raw text on parse**, so the exact bytes are not
  currently reachable from the dashboard at all. The emitter must therefore
  **pass through the raw canonical bytes** — `data.ts` exposes them unparsed — and
  **both copies must be patched by the same writer** (`render_stats`) after dist
  enumeration, so neither is re-serialized independently.
  **Ordering is load-bearing:** the count is patched into the canonical
  `stats.json` **before** `build.py:1849`'s rglob, and into `dist/stats.json`
  **after** site enumeration — safe only because patching an existing file adds no
  files to the walk.

### Bytes that cannot change under the deploy

- **R4** — **A frozen upload snapshot**: (1) enumerate the source recording
  `(path, size, mtime_ns, inode)`; (2) fresh private destination (`mkdtemp`,
  `0700`) on the same filesystem; (3) **one-pass copy-and-hash**, each file read
  once and hashed as written; (4) re-enumerate the source and require the identity
  set unchanged — a **detector** of an unstable source, not the binding; (5) seal
  (`0400`/`0500`, advisory only); (6) compute `dist_digest` and `build_inventory`
  **from the destination**; (7) the uploader receives only the sealed path. The
  binding is (6)+(7): uploaded bytes ≡ hashed bytes regardless of the source.
- **R5** — **`dist_digest` asserted at five boundaries** — artifact creation,
  after each independent download, immediately before each of the two uploads, and
  independently in the signer — reusing `publish/digests.py` verbatim.
  **What anchors the signer's copy must be named, because the workflow artifact
  does not.** The signer recomputes `inventory_digest` from the artifact it
  downloads (ARCHITECTURE `:693`), which is self-consistent against a wholesale
  artifact replacement. The anchor is the **served tree**: R15's inventory-wide
  sweep compares the signer's recomputed digests against what the live domain
  actually returns. `dist_digest` alone has no attested external anchor and must
  not be described as if it did.
- **R6** — **`site/**` plus a sibling `inventory.json` outside `site/`**, RFC 8785
  canonical, from the same snapshot, reusing `publish/inventory.py`.

### The deploy job

- **R7** — **Isolated deploy job**: the Cloudflare token step-scoped, **no GitHub
  write scopes**. §14's headline states the invariant as "no *workflow* holds
  both" while its own elaboration and §12.1 step 3 are per-**job**; the deploy job
  living in `publish.yml` alongside an `attestations: write` job satisfies the
  real invariant and violates the headline. **The spec is wrong, not the design** —
  but the justification must be stated completely, because "per-job permissions on
  isolated runners are the boundary" is **not sufficient on its own**: workflow
  artifacts are a shared, cross-job, writable channel that the `permissions:` block
  does not govern (artifact upload uses the runtime token, not `GITHUB_TOKEN`
  scopes). The amendment holds for a different reason — **a job with `Pages Write`
  and no `id-token: write` cannot mint an attestation at all**, which is the
  authority §14 is actually separating. The artifact channel is covered by R5's
  named anchor and R15's served-tree sweep, not by the permission block. §14's
  headline is amended with **both** halves of this reasoning (T13).
- **R8** — **Production identity asserted before any upload**: the workflow-locked
  branch must equal the project's configured `production_branch`. Mismatch aborts
  **before** uploading. Live: project `publicfilings`, branch `main`.
- **R9** — **Preview first, verified INVENTORY-WIDE before production is touched.**
  §12.1 step 4 currently specifies preview verification as **markers plus a
  `stats.json` hash** (ARCHITECTURE `:691`) — while `ARCHITECTURE.md:320` states in
  terms that marker checks alone are **not** sufficient, because a marker-preserving
  tamper is exactly what the inventory sweep exists to catch. **§12.1 step 4 is
  therefore amended** (T13) to require the same inventory-wide sweep R15 specifies
  for the signer. This is not a nicety: **TD-4's entire bound depends on it.** TD-4
  accepts one unverified-serving window on the strength of "the identical bytes
  already passed the preview sweep" — if the preview only checks markers, that
  sentence is vacuous and TD-4 becomes a write-off. Revision 4 asserted the
  amendment inside TD-4's own prose and put it in no task, no test and no DoD line;
  round 4 correctly called that text-only.
- **R10** — **Production is a second upload of provably the same bytes**, digest
  re-checked immediately before.
- **R11** — **Production is verified on the live custom domain — always, with no
  exemption and no polling.** The domain is `status: active` **before the workflow
  is ever armed** (Rollout prerequisite 4), so there is no activation race to wait
  out. The run asserts the domain is active as a **precondition**, using
  `GET /accounts/{id}/pages/projects/{project}/domains` — **not** the project
  endpoint, whose `domains` field is an array of bare strings carrying no status.
  A non-active domain aborts **before** the production upload.

  On verification failure: roll back to the captured prior deployment and
  re-verify. **On the first run there is no prior deployment, and Cloudflare
  refuses to delete an active production deployment** ("this will not delete the
  active production deployment if one exists", Pages known issues). Revision 2
  specified that deletion as the compensation; it is not an operation the provider
  permits. The honest position: the first run has **no automated compensation**,
  the exposure is bounded by R9 (the identical bytes already passed the full
  inventory sweep on the preview URL, so a production-only failure indicates
  routing or cache, not bad bytes), and remediation is an owner action documented
  in R23. This is **declared as TD-4**, not engineered away.
- **R12** — **The ordered sequence lives in one injected, testable orchestrator.**
  Deleting the rollback step, uploading production before the preview verifies, or
  moving the branch assertion after the upload must each fail a named test.

### Markers the verification actually reads

- **R19** — **The site emits machine-readable build markers.** Today
  `Base.astro:123` renders free text `build {buildId} · code {codeSha}` with no
  `<meta>`; `data.ts:461-469` produces a **7-character** sha while the record
  holds the full `github.sha`; and `build_id` is embedded in a page-level JSON
  blob, so a substring check passes **even if the entire footer is replaced**.
  The obvious implementation is therefore vacuous *and* the obvious sha equality
  always fails. Fix: emit `<meta name="populus:build_id">` and
  `<meta name="populus:code_sha">`; the workflow sets `SITE_CODE_SHA` to the full
  `github.sha`; verification **parses the named marker and compares exactly** —
  never substring containment.

  **Correction to revision 2's diagnosis:** the "always-failing short sha" claim
  was wrong. `data.ts:461` uses `process.env.SITE_CODE_SHA` **verbatim**; only the
  *dev git fallback* at `:464` truncates to 7 characters, and the CI path never
  reaches it. Setting `SITE_CODE_SHA` is still required (nothing sets it today),
  but it fixes an unset variable, not a truncation.

  **The larger instance of the vacuity defect is on a different page.** The footer
  (`Base.astro:124`) renders the **full** 64-hex digest in its `title=`
  attribute — on every page, not abbreviated as revision 3 claimed, and with **zero
  test coverage** (`dashboard/tsconfig.json:3` excludes `test/` from `astro check`);
  and
  `dashboard/src/pages/methodology/index.astro:193` renders the **full**
  `build.manifestSha` inside a copy-pasteable command told to readers —
  `populus verify --build {buildId} --manifest sha256:{manifestSha}`. Since R2
  re-assembles the manifest *after* the site builds, that digest is stale **by
  construction** and every reader who runs the command gets a mismatch. It also
  violates Locked Decision 6 directly. Both pages stop rendering a digest the site
  cannot know: the footer drops it, and the methodology command drops its
  `--manifest` argument (the `--build` argument alone is sufficient — `populus
  verify` resolves the manifest from the build id).

### The signer

- **R13** — **`record-sign.yml` writes and attests an append-only generation**,
  trusting no deploy-job output. `build_id` from the attested manifest/pointer
  (obtainable since P3-3a); `code_sha`/`dist_digest`/inventory from the artifact it
  downloads itself; the deployment id read from the Cloudflare API with its own
  `Pages Read` token and cross-checked. It runs in the caller's context, so
  **`workflow_call` must declare an explicit `secrets:` block** — today it declares
  none while already referencing `CLOUDFLARE_PAGES_READ_TOKEN`, which a called
  workflow does not inherit. Both that token and the data-repo PAT are declared.
- **R25** — **The attested subject name for a generation must be pinned, because
  the existing verifier will otherwise refuse it.** `attestation.py:92`'s
  `resolve_identity` returns `None` — *refuse* — unless the subject name is in
  `SUBJECT_IDENTITIES` or starts with `DEPLOYMENT_SUBJECT_PREFIX` (`deployments/`),
  and `_subject_name_matches` (`:396-401`) requires the in-bundle statement name to
  equal the queried name or end with `"/" + name`. But
  `actions/attest-build-provenance` with `subject-path` names subjects by
  **basename** — which is exactly why `SUBJECT_IDENTITIES` (`:54-57`) maps the bare
  `"manifest.json"` against `publish.yml:91`'s full
  `populus-data/builds/*/manifest.json` path. A generation written to
  `builds/<id>/deployments/<gen>.json` would therefore attest under the subject
  name `<gen>.json`, and **both** readings fail: `resolve_identity("<gen>.json")`
  refuses, and `verify("deployments/<gen>.json", …)` matches no statement name.
  R13 and R18 are both unimplementable until this is pinned. **Fix:** attest with
  an explicit `subject-name` of `deployments/<gen>.json` (the action accepts
  `subject-name` + `subject-digest` in place of `subject-path`), which satisfies
  the `deployments/` prefix and the exact-match arm together. A round-trip
  attest → verify fixture for a generation is required.
- **R14** — **The first run has no prior deployment, and that is the only thing
  special about it.** No exemption, no input, no polling. Consequences, all
  mechanical and all stated: the rollback target is "nothing" and the provider
  refuses to delete an active production deployment, so the first run has **no
  automated compensation** and carries TD-4 (R11); the pre-publish gate has an
  explicit first-run predicate (R18); and the signer verifies the custom domain
  like any other run, because the domain was activated before arming
  (Rollout prerequisite 4), not because the run waited for it.
- **R15** — **The signer verifies the served tree inventory-wide**, redirects
  disabled, comparing content-decoded body hash and length. Marker-only checking
  is insufficient — a compromised deploy job can preserve `build_id`, `code_sha`
  and `stats.json` while replacing every HTML and JS file.
- **R16** — **The three closure-narrowing provider checks run**, pinned to a
  **recorded real Cloudflare response**. `verification_scope` is recorded as
  `expected_paths`, never `"full"`. **ARCHITECTURE still carries both `"full"`
  residues** — `ARCHITECTURE.md:302`'s normative example and `:900`'s TD-8 wording
  — which a prior review round recorded as fixed and revision 1 dropped. Both are
  corrected and a **documentation regression check** forbids the strings — **scoped
  to exclude the revision-history table.** "full served-tree" occurs *twice*:
  `:900` (the residue) and `:9`, the revision-history row recording that
  `"full served-tree verification" was false` — the durable record of the round-11
  correction. Deleting `:9` to satisfy a grep would be precisely the silent drop
  this requirement exists to punish. *(Revision 4 said three; it is two.)*
- **R17** — **A lookup failure is not a verification failure.** `unavailable`
  propagates through the signer; a rate-limited Cloudflare API must not read as
  tampering.
- **R18** — **A verified generation is required before the next publish, and the
  gate verifies rather than resolves.** Revision 1 said "resolves
  `builds/<id>/deployments/`" — satisfied by an unsigned file. §13.2 and §12.1
  step 6 require a *valid, attestation-verified* generation whose `code_sha`
  matches what the live domain serves. The gate therefore: reads the live domain's
  `populus:code_sha` marker (unauthenticated, no Cloudflare credential — R7
  forbids the publish job that); parses the highest generation from the
  `populus-data` checkout the publish job already has; **verifies its attestation
  against the pinned `record-sign.yml@refs/heads/main` identity and OIDC issuer
  via the public `populus` attestation API**; and requires the `code_sha` to match.
  **First-run predicate, stated explicitly:** the gate passes when the domain
  resolves to no deployment **and** `populus-data` contains zero deployment
  generations. Any other unresolvable state fails closed.

  **The gate's step name must not contain "verify".** `_step_index`
  (`test_attestation_structure.py:187-191`) resolves by **first substring match**,
  so a pre-publish step named e.g. "Verify prior generation" placed before
  `Attest published artifacts` (`publish.yml:87`) would capture the lookup and
  break three unrelated tests at once: `test_attest_step_precedes_verify` (`:220`),
  `test_verify_step_demands_real_attestation` (`:227`, since the gate's `run` has
  no `--attestation=sigstore`), and `test_verify_step_is_authenticated` (`:236`).
  Name it "Gate on prior deployment generation" and harden `_step_index` under T12.
- **R20** — **A skipped signer job is a failure, not a success — and the mechanism
  must be named, not just the requirement.** `record-sign.yml:23` gates on
  `POPULUS_RECORD_SIGN_ARMED` at the **job** level, so if that variable were unset
  while publishing stayed armed, the job would be **skipped and report success**:
  the deploy completes, no generation is written, and nothing notices until R18
  fires a day later. The mechanism is a **caller-side assertion job**
  (`needs: [deploy, sign]`, `if: always()`) that fails unless
  `needs.sign.result == 'success'`; a static YAML lint can assert that job's shape
  but **cannot establish that the shape detects the skip**, so the requirement is
  additionally verified by a workflow-semantics fixture. Note `tests/test_publish.py:2027`
  currently *pins* the skip-shaped `if:`, and `publish.yml` has no caller job for
  `record-sign.yml` at all today — both are work items, not existing behaviour.
  **The asymmetry is deliberate:** a skipped *deploy* job is legitimate (it is
  `needs: publish`, skipped whenever publish is skipped, which is the entire
  unarmed state per `publish.yml:31-33`); tightening that would make every unarmed
  nightly a failure. A skipped signer means a deployment went live unrecorded; a
  skipped deploy means nothing went live.
- **R21** — **The structural guard is extended, because it does not cover this
  today.** `tests/test_attestation_structure.py:180` reads only
  `doc["jobs"]["publish"]`, so a new deploy job is invisible, and `:239` hardcodes
  `["build","publish","verify"]`, which a `populus deploy` invocation never joins.
  *(Revision 2 claimed renaming the `Build` step breaks `:241`; that is a docstring
  line and `_step_index` never looks for "Build". What actually breaks is `:245`'s
  `assert invocations, "no \`populus build\` invocation found"`, and only if T5
  replaces the CLI **command** `populus build` at `publish.yml:72`.)* `_step_index`
  is also hardened against the first-substring-match hazard in R18. Revision 1
  claimed this was an inherited constraint; it is real work.

### Tokens and docs

- **R22** — **The `Pages:Edit` token is created last**, account-scoped, no IP
  filter, with its §14 inventory entry and expiry recorded. It must be minted from
  the **account** API-tokens page (`/{account_id}/api-tokens`), not My Profile, so
  it is enumerable at `GET /accounts/{id}/tokens` like its sibling.

  **The owner question is now closed (owner-verified against the endpoint, not
  inferred).** `CLOUDFLARE_PAGES_READ_TOKEN` **is account-owned**: id
  `88ba1c8113d22d4c03b78b066187fa20`, name
  `publicfilings-record-signer-pages-read`, active, expires `2027-08-03T23:59:59Z`,
  one `effect: allow` policy whose resource is
  `com.cloudflare.api.account.d7b5e4995e76a76c9899695b54c61226` and whose permission
  groups are exactly `["Pages Read"]`. It is absent from `GET /user/tokens`.
  These facts are **owner-attested, not verified in-tree** — this plan's own F0
  standard requires saying so.

  **The signer CANNOT check its own scope at runtime, and revision 3 was wrong to
  require it.** `GET /user/tokens/verify` returns only `{id, status, expires_on,
  not_before}` — no policies. `GET /accounts/{id}/tokens` does return
  `policies`/`permission_groups`, but it is a token-*management* endpoint: a token
  whose sole policy is `["Pages Read"]` on the account resource carries no
  API-Tokens-Read permission and **cannot call it**. The owner's enumeration was
  performed with a *different, more privileged* credential, and revision 3 silently
  promoted that one-time result into a per-run self-check — the same class of error
  as rounds 1 and 2 (a claim that reads as verified because someone verified
  something adjacent). The single-element `["Pages Read"]` array remains a genuinely
  valuable property; it is **provisioning-time evidence recorded in §14**, not a
  runtime assertion. §17(h)'s credential fixtures are **not** left as-is either — see
  **R27**, which amends them on the record, because "fails closed on a
  `Pages Write`-scoped token" is unobservable for the same reason this paragraph
  gives.
- **R27** — **§17(h)'s "fails closed on a `Pages Write`-scoped token" is not an
  observable property, and the spec is amended rather than faked.** §17(h)
  (`ARCHITECTURE.md:856`) requires the signer to fail closed when handed a
  write-scoped token. A Cloudflare `Pages Edit` token **succeeds at every read the
  signer performs** — there is no field in any response that distinguishes it, and
  R22 established that the signer cannot introspect its own scope. The requirement
  is therefore untestable except by mocking a distinction that does not exist,
  which is how a fixture comes to assert nothing. **§17(h) is amended on the record**
  (T13) to the property that is both testable and the one actually wanted: the
  signer **never issues a non-GET Cloudflare request**, enforced by the injected
  transport failing the test on any write verb. That bounds the blast radius of an
  over-scoped token by the signer's own behaviour instead of by a scope check it
  cannot perform. Revision 4 demoted R22's runtime assertion but left this fixture
  standing — the same claim, one file over.

  **The property needs a seam and a mutant, or it passes vacuously.** The signer's
  body has no module in this plan: `src/populus/deploy/` was enumerated as
  `snapshot.py`/`cloudflare.py`/`verify.py`/`orchestrator.py`, none of which is the
  signer, so "the signer path" named a path with no code. **`src/populus/deploy/record.py`
  and `tests/test_deploy_record.py` are added** (T10), and R27 is scoped over
  **`record.py`'s Cloudflare call surface only** — the deploy job legitimately
  issues non-GET calls (upload, `POST …/rollback`), so an unscoped property would be
  false by construction. **Killing mutant, stated:** make `record.py` issue one
  `POST`; the injected-transport fixture must fail. Without that mutant a test that
  merely calls the read functions and asserts no writes were seen proves nothing —
  which is the exact failure R27 exists to remove, and round 5 caught it reproduced
  one file over.
- **R26** — **`GET /accounts/{id}/tokens` is not a complete inventory of what can
  reach this zone, and §14 must stop implying it is.** Owner enumeration found a
  pre-existing **user-owned** token — `Cloudflare Agent (auto-generated)`, id
  `15d59985832c2b290a2239d40cd1ed79`, active, **no expiration**, policy resource
  `com.cloudflare.api.account.zone.*` carrying several dozen zone-level **Read**
  permissions. User-owned tokens appear only under `GET /user/tokens`, so any audit
  built on the account endpoint alone is blind to it. Nothing in it appeared to
  carry write authority and it is unrelated to Populus, so it does not breach the
  §14 separation invariant — but it **does** falsify the completeness claim the
  audit story rests on. §14's credential inventory therefore states both endpoints
  as the enumeration surface, and records that user-owned tokens are outside this
  run's control. **Whether that specific token is revoked or scoped down is an
  owner decision, not a task in this run** (TD-5).
- **R23** — **`docs/runbooks/deploy.md`** *and* **`docs/runbooks/rollback.md`** —
  §13.5 (`ARCHITECTURE.md:747`) makes "restore the dashboard to the rollback target
  deterministically" part of the only supported rollback procedure from P3 on, so
  the rollback runbook cannot stay silent on the dashboard;
  `tests/test_publish.py:2048-2059` runs `bash -n` over its fenced bash blocks.
  `deploy.md` records the first-run behaviour, the
  arming order, and the rollback path; §17's P3 status states what this run closes
  and what it does not.

## Scope

The site build and its manifest dependency; the three-outcome build seam and the
stats schema; the snapshot; `src/populus/deploy/`; the deploy job; the
`record-sign.yml` body and its secrets block; the machine-readable markers; the
verifying pre-publish gate; the structural-guard extension; the signer body; docs
and the **four** spec amendments (§12.1 step 4, §17(h), §14's headline, §14's
credential inventory).

## Non-goals

- **§17's "≥3 consecutive nightly deploys"** — time-based; P3 does not close here.
- **The §13.2 external monitor** — R18's gate is in scope; the monitor is not.
- **The §17 rollback drill and the "second post"** — both follow a first
  successful deploy. Owner: project owner.
- **Lighthouse ≥90; the 25-row `doc_url` spot-audit; OQ-14 analytics.**
- **`attestation_phase`** — P3-3c.
- **The M1 House/Senate UA switch** — a one-line follow-up once the domain serves.
  The SEC UA must never change.
- **TD-8 / TD-10** — declared, unchanged.
- **`.github/dependabot.yml` does not exist**, and this run does not create it.
  §12.1 step 1 places the Wrangler pin "under §14's SHA-pinning **and Dependabot
  discipline**" (`ARCHITECTURE.md:688`), but the repo has only two files under
  `.github/` — both workflows. R1 delivers the exact-version pin and the committed
  lockfile; the Dependabot half is **pre-existing debt, declared here rather than
  silently claimed as satisfied** (TD-6).
- **A CSP `_headers` file** — `dashboard/README.md:397` lists it as a P3 completion
  item, but R16's control-path probe expects a **404 on `/_headers`**
  (ARCHITECTURE `:322`), so shipping one is a hard verification failure. Deferred
  explicitly rather than silently foreclosed; reconciling the two is P3-3c work.

## Constraints

- **§14 separation invariant**, as amended by R7: no **job** holds both
  `Pages Write` and GitHub write/attestation authority.
- **Cloudflare Direct Upload has no promote operation**; production is a second
  upload, rollback an explicit API call.
- **The deploy token is account-scoped** — §14: "it can create, edit, and delete
  every Pages project in its account." This is why no security property may rest
  on Cloudflare-side state being unrestorable.
- Free tier: 20,000 files, 25 MiB/file, 500 deploys/month.
- `tests/conftest.py` forbids network → injected transports.
- `publish.yml` runs on `schedule` as well as `workflow_dispatch`; any new input
  must be `type: boolean, default: false` or the nightly breaks.
- Standing gates: **five**.

## Current State

Re-measured in this tree:

- **No deploy code** — `src/populus/deploy/` absent.
- **No site build** in `publish.yml` (zero `npm`/`astro`/`dashboard` occurrences);
  **Wrangler absent** from `dashboard/`.
- `dashboard/src/lib/data.ts:435` reads `manifest.json` unconditionally; `:86`
  derives module availability from it; `:461` uses `SITE_CODE_SHA` verbatim (unset
  today) and only the dev fallback at `:464` truncates;
  `Base.astro:123-124` renders free text plus the **full** manifest digest in a
  `title=` attribute;
  **`methodology/index.astro:193` renders the FULL manifest digest** inside a
  reader-facing `populus verify` command.
- **Nothing emits `dist/stats.json`** — `dashboard/public/` holds only
  `favicon.svg`, `astro.config.mjs` has no copy step, `data.ts:433-434` only reads.
- `run_build` has three returns (`:1541` preserved, `:1557` reconciled, fresh body
  `:1569`–`:1908` returning at **`:1909`**); `:1849` rglobs and hashes every
  build-dir file, `:1903` writes the manifest after that walk; `build_journal`
  inlines the manifest verbatim and refuses inconsistency. **49 call sites, 4 of
  them production.**
- `stats.schema.json` closed-world, validated across **three files / 10 call
  sites**: `tests/test_stats.py:19-21` (7, unconditional under `make test`),
  `scripts/accept_m1_b.py:709`, and `tests/test_members.py:817` — the last behind a
  `skipif` on a local data cache (`:690-696`) that normally does not run.
  `scripts/monitor.py` reads stats with `.get()` and has no live-dashboard marker
  fetch — not a hazard, and §13.2's marker read stays future work.
- `attestation.py:92` `resolve_identity` **refuses** any subject name outside
  `SUBJECT_IDENTITIES` or the `deployments/` prefix; `_subject_name_matches`
  (`:396-401`) requires exact or `/`-suffix match.
- `record-sign.yml`: `workflow_call: {}` with **no `secrets:` block**, body an
  `echo` no-op, gated on unprovisioned `POPULUS_RECORD_SIGN_ARMED` at job level.
- `test_attestation_structure.py:180` reads only the `publish` job; `:239`
  hardcodes three commands.
- ARCHITECTURE still contains `"verification_scope": "full"` (`:302`) and
  "full served-tree" (`:900`).
- Pages project `publicfilings`, **zero deployments** (`latest_deployment: null`),
  `production_branch: main`. **Custom domain `publicfilings.org` is `status:
  active`** — `verification_data.status: active`,
  `validation_data: {status: active, method: http}`,
  `certificate_authority: google`; project `domains` now
  `["publicfilings.pages.dev", "publicfilings.org"]`. Apex `CNAME → publicfilings.pages.dev`,
  proxied. `DATA_REPO_PAT` and `Pages:Edit` unset;
  both `*_ARMED` unprovisioned — **the publish workflow has never run.**
- **Cloudflare API facts, verified against current documentation (round 3
  re-verified all of these independently):**
  `GET /pages/projects/{project}` returns `domains` as an **array of strings** with
  no status; per-domain `status` is only on the `…/{project}/domains` subresource,
  with values `initializing | pending | active | deactivated | blocked | error`.
  Deployment deletion "will not delete the active production deployment if one
  exists". Rollback is `POST …/deployments/{id}/rollback`, constrained to
  successful production builds. The deployments list supports `env=production` and
  carries `uses_functions`, which R16's no-Functions check needs.
  **Documented causes of a stuck `Initializing`:** blocked HTTP validation
  (something intercepting `/.well-known/acme-challenge/`), CAA records that exclude
  the issuing CA, zone holds, grey-cloud/proxy state, "Cache Everything" page rules.
  **Cloudflare does not document Let's Encrypt rate-limiting as a cause** —
  revisions 2 and 3 both asserted it; it is community lore, and the CA here is
  Google Trust Services regardless. *(An **absent** CAA set is permissive, not
  blocking — this zone has none and the certificate issued fine. "Missing CAA
  records", as revision 4 phrased it, was contradicted by this plan's own
  measurement.)*
- **Measured from outside the account — and the measurement corrects an earlier
  misreading.** All of `http://publicfilings.org/.well-known/acme-challenge/probe`,
  `https://publicfilings.org/` and `https://publicfilings.pages.dev/` return
  **522**; no CAA record; NS `amos/erin.ns.cloudflare.com`. The 522 means only
  *nothing is serving yet*, which stays true until the first deployment — it does
  **not** indicate blocked validation. The TLS layer proves it:
  `subject: CN=publicfilings.org`, `issuer: C=US; O=Google Trust Services; CN=WE1`,
  `SSL certificate verify ok`, expiring 2026-11-01. An HTTPS 522 requires a
  completed TLS handshake, so the certificate was already valid when round 3 read
  the same status code as evidence of failure.

## Detected Stack

Python 3.12+ (uv/Hatch, `uv sync --frozen`, `click`, pytest with an autouse
no-network guard); Astro 7 / TypeScript 6 (`dashboard/.node-version` 24.16.0,
`npm ci`); GitHub Actions; five Makefile gates.

## Reuse Map

| Existing | Decision | Verified |
|---|---|---|
| `publish/digests.py` `dist_digest` | **Reuse verbatim** | present |
| `publish/inventory.py` envelope | **Reuse verbatim** | present |
| `publish/attestation.py` (P3-3a) | **Reuse** | supplies `build_id`; `rejected`/`unavailable` for R17; the **verifier the R18 gate needs** |
| `client/snapshot.py` `Fetcher` + `MockTransport` | **Reuse** | the injected-transport idiom |
| `publish.yml` `Verify`-before-`Commit` | **Reuse as precedent** | same gate shape |
| `publish/build.py` `run_build` | **Extend** | the R2 seam, all three outcomes |
| `tests/test_attestation_structure.py` | **Extend — real work, not inherited** | reads one job; hardcodes three commands (R21) |
| `dashboard/src/lib/data.ts`, `layouts/Base.astro`, `pages/methodology/index.astro` | **Extend** | the manifest dependency, the markers, and the full-digest verify command |
| `dashboard/test/*.test.ts` (`pages-render`, `ui`, `css-fold`) | **Extend** | `BuildStamps`/`stamps` fixtures; `make test` runs `npm run gates` |
| `src/populus/net/` SEC client | **Do NOT reuse** | SEC-specific allowlist and UA |

## Architecture

`src/populus/deploy/` — `snapshot.py` (R4), `cloudflare.py` (Pages API pinned to
`GET /accounts/{id}/pages/projects/{project}` → `production_branch`;
**`GET /accounts/{id}/pages/projects/{project}/domains` → per-domain `status`**,
the only endpoint that carries it;
`GET …/deployments?env=production` → `id`, `environment`, `url`;
`POST …/deployments/{id}/rollback`), `verify.py` (markers by parsed `<meta>`,
inventory sweep, provider checks), `orchestrator.py` (the ordered sequence), and **`record.py` — the signer body**
(R13/R27), read-only against Cloudflare and the module R27's no-non-GET property is
scoped over.

**No `DELETE …/deployments/{id}`** — revision 2 pinned it as the first-run
compensation, and Cloudflare refuses it for an active production deployment. The
plan does not call an endpoint whose documented behaviour is to decline.

## Locked Decisions

1. Deploy job and signer stay **separate workflows**.
2. They never share a Cloudflare token.
3. The signer verifies the **full inventory**, not marker files.
4. **No bootstrap exemption exists in the deploy path.** Domain activation is a
   one-time **provisioning** precondition confirmed before arming, not a runtime
   mechanism. Security properties never rest on Cloudflare-side state being
   unrestorable, because the deploy token is account-scoped.
5. Verification logic in Python with injected transports, not shell in YAML.
6. **The site never renders a digest it cannot know** — markers only. This binds
   **every** page, not just the footer (R19).

## Alternatives Considered

- **A `bootstrap` input gated on zero deployments** (revision 1) — rejected: the
  precondition is restorable by the deploy job's own DELETE call.
- **Domain-activation polling** (revision 2) — rejected on three independent
  grounds: the pinned endpoint returns no per-domain status, the premise that a
  deployment causes activation is undocumented — and, as it turned out, **false**:
  the domain later reached `active` with zero deployments (see the banner) — and the
  paired delete-compensation is refused by the provider.
- **A code-level first-run exemption** / **a hand-run bootstrap** (draft) —
  rejected across three earlier rounds.
- **Deleting the Pages project as the first-run compensation** — rejected: it
  requires first deleting the CNAME record, is not an operation a deploy job with
  a Pages token should be able to trigger automatically, and would return the
  domain to the `Initializing` state that prerequisite 4 exists to clear. TD-4
  and an owner runbook are the honest alternative.
- **Keeping the footer's manifest hash** — rejected: R2 re-assembles the manifest
  after the site builds, so any rendered digest is stale by construction.
- **Making `site_file_count` a required integer** — rejected: breaks
  `tests/test_stats.py`'s seven unconditional validators.
- **Deferring R18 to the monitor run** — rejected: §12.1 step 6's "fails closed
  **and the next publish is gated**" would be unimplemented, and the gate is cheap
  (a checkout read plus one unauthenticated fetch).

## Planned Files

- `.github/workflows/publish.yml`
- `.github/workflows/record-sign.yml`
- `src/populus/deploy/__init__.py`
- `src/populus/deploy/snapshot.py`
- `src/populus/deploy/cloudflare.py`
- `src/populus/deploy/verify.py`
- `src/populus/deploy/orchestrator.py`
- `src/populus/deploy/record.py`
- `src/populus/publish/manifest.py`
- `src/populus/cli.py`
- `src/populus/publish/build.py`
- `src/populus/stats.py`
- `dashboard/src/lib/data.ts`
- `dashboard/src/layouts/Base.astro`
- `dashboard/src/pages/methodology/index.astro`
- `dashboard/src/pages/stats.json.ts` *(new — the `dist/stats.json` emitter, R24)*
- `dashboard/package.json`
- `dashboard/package-lock.json`
- `dashboard/test/pages-render.test.ts`
- `dashboard/test/ui.test.ts`
- `dashboard/test/css-fold.test.ts`
- `scripts/accept_m1_b.py`
- `scripts/accept_m2_5.py`
- `scripts/accept_m2_6.py`
- `tests/schemas/stats.schema.json`
- `tests/test_members.py`
- `tests/test_stats.py`
- `tests/test_publish.py`
- `tests/test_pointer_state.py`
- `tests/test_digests.py`
- `tests/test_phase_a_snapshot.py`
- `tests/test_inst_ingest.py`
- `tests/test_attestation_structure.py`
- `tests/test_attestation.py`
- `tests/test_dep_guard.py`
- `dashboard/src/lib/inst.ts`
- `dashboard/README.md`
- `dashboard/test/post/http-status.test.ts`
- `docs/runbooks/rollback.md`
- `tests/test_deploy_snapshot.py`
- `tests/test_deploy_cloudflare.py`
- `tests/test_deploy_verify.py`
- `tests/test_deploy_orchestrator.py`
- `tests/test_deploy_record.py`
- `tests/fixtures/deploy/cf_project.json`
- `tests/fixtures/deploy/cf_domains.json`
- `tests/fixtures/deploy/cf_deployments.json`
- `docs/runbooks/deploy.md`
- `docs/runbooks/attestation.md`
- `ARCHITECTURE.md`
- `STATUS.md`

**`tests/test_dep_guard.py` was the sixth scope miss, found during T2.** Its
`HTTPX_ALLOWED` set names exactly four modules; anything else under
`src/populus/` mentioning `httpx` fails the gate. All three new deploy modules
(`cloudflare.py`, `verify.py`, `record.py`) trip it. Seven plan revisions and
five review rounds — including three that re-derived the blast radius
independently — all missed it, because the file's relevance is invisible unless
you know that allowlist exists. Added individually rather than as a `deploy/`
prefix: a new module in that package should have to justify itself.

**Why the list grew by 13.** Round 2 re-derived the blast radius independently and
found every addition above. `accept_m2_5`/`accept_m2_6` are production `run_build`
callers behind standing gates and are `accept_m1_b`'s peers. The four extra test
modules assert on manifest/digest contents or re-hash stats into the manifest
(`test_pointer_state.py:1342-1360`), so they move when the artifact set does. The
three `dashboard/test/*.test.ts` files carry `BuildStamps`/`stamps` fixtures and
run **inside `make test`** (`Makefile:52-53` → `npm run gates`), and removing
`manifestSha`/`manifestShaAbbrev` from `BuildData` (`data.ts:55-56`) is visible to
`astro check` across every `Base.astro` consumer. `docs/runbooks/attestation.md:55`
already names `record-sign.yml@refs/heads/main` and needs R25's subject convention.

**Checked and confirmed NOT in the blast radius:** no zod/valibot/ajv/typebox in
`dashboard/`; `BuildData.stats` is `Record<string, any>` (`data.ts:59`) so a new
stats key is structurally invisible to the dashboard; and no golden stats fixture
exists anywhere — every stats document in the suite is computed live, so nothing
needs regenerating.

## Implementation Tasks

- **T1** — `deploy/` package; `snapshot.py`. (R4, R5, R6)
- **T2** — `cloudflare.py`: pinned endpoints incl. **the `/domains` subresource for
  per-domain status**, injected transport, recorded fixtures, active-domain
  precondition, rollback. No delete. (R8, R11, R16)
- **T3** — `verify.py`: marker parsing by `<meta>` name with exact comparison,
  inventory sweep, provider checks, `unavailable` propagation. (R9, R11, R15, R16, R17, R19)
- **T4** — `orchestrator.py`: the ordered sequence; rollback when a prior
  deployment exists; **fail loudly with the TD-4 remediation pointer when none
  does**. (R9, R10, R11, R12, R14)
- **T5** — `stage_build`/`finalize_build` for all three outcomes; provisional
  manifest **deleted before re-assembly** so `:1849`'s walk is unchanged; CLI
  surface for both phases so the workflow never calls the count-defaulting wrapper.
  **`stage_build` must forward `attestation=` as an explicit keyword** —
  `test_attestation_structure.py:84-119` flags omissions and explicitly treats
  `**kwargs` forwarding as an offender (`:110-116`), and `:139`/`:164` pin
  `run_build` as discoverable, so a `**kwargs` wrapper fails the guard. (R2)
- **T6** — Stats: `compute_stats` emits `site_file_count: null`; schema requires a
  nullable key; publish-time non-null assertion; **update all three closed-world
  validators (10 call sites)**. (R3)
- **T7** — Dashboard: machine-readable markers; set `SITE_CODE_SHA`; remove the
  footer manifest digest **and the methodology page's `--manifest` argument**;
  keep module availability on the provisional manifest; **add the
  `dist/stats.json` emitter**; update the three `dashboard/test/*.test.ts`
  fixtures. (R19, R24, R1)
- **T8** — `publish.yml`: site build with `dashboard/.node-version`, `npm ci`,
  pinned Wrangler, the env contract, the artifact. (R1, R6)
- **T9** — The isolated deploy job and its permission boundary. (R7, R8, R12)
- **T10** — `record-sign.yml` body **plus an explicit `secrets:` block** declaring
  both the Pages-read token and the data-repo PAT; **attest the generation under
  the explicit subject name `deployments/<gen>.json`**, with a round-trip
  attest→verify fixture. **No runtime token-scope introspection** — a Pages-Read
  token cannot call the endpoint that returns policies (R22); the scope is
  provisioning-time evidence in §14; **the signer body lands in
  `src/populus/deploy/record.py`** with `tests/test_deploy_record.py`.
  (R13, R15, R16, R17, R22, R25, R27)
- **T11** — The verifying pre-publish gate with its first-run predicate, named so
  it does not collide with `_step_index("verify")`; the caller-side assertion job
  that turns a **skipped signer** into a failed run, with a workflow-semantics
  fixture rather than a shape lint alone. (R18, R20)
- **T12** — Extend the structural guard: iterate **all** jobs, derive the command
  list from the workflow rather than hardcoding it, add deploy entry points to the
  pinned name set, and **harden `_step_index` against first-substring collisions**
  (`:187-191`). (R21)
- **T13** — Docs and spec amendments. **The amendment list is now four, not two** —
  each recorded with its reason, never edited to make a change pass:
  (1) **§12.1 step 4** gains the inventory-wide preview sweep (R9) — without it
  TD-4's bound is vacuous; (2) **§17(h)** is restated from the unobservable
  "fails closed on a `Pages Write`-scoped token" to "issues no non-GET Cloudflare
  request" (R27); (3) **§14's headline** to "no **job** holds both", with both
  halves of R7's reasoning; (4) **§14's credential inventory** names both token
  endpoints (R26). Plus: `docs/runbooks/deploy.md` covering the
  first-run behaviour, TD-4's remediation, the arming order, the rollback path and
  **the visible non-fresh-build skip**; `docs/runbooks/attestation.md:55` gains
  R25's subject-name convention; §14 headline "no **job** holds both" **with both
  halves of R7's reasoning**; **delete ARCHITECTURE's two `"full"` residues**
  (leaving the revision-history row) and add the scoped regression check; §14
  `Pages:Edit` entry and **the R26 dual-endpoint enumeration note**; §17 P3 status;
  STATUS. (R7, R9, R16, R22, R23, R25, R26, R27)

## Testing Strategy

| Fixture | Test |
|---|---|
| production-branch mismatch aborts **before** upload | `test_deploy_cloudflare.py` |
| preview failure leaves production untouched | `test_deploy_orchestrator.py` |
| production verify failure → rollback to the captured id, re-verified | `test_deploy_orchestrator.py` |
| **no prior deployment** → failure raises with the TD-4 remediation pointer; **no DELETE call is attempted** | `test_deploy_orchestrator.py` |
| **inactive custom domain aborts before the production upload** (fixture from the `/domains` subresource, `status: initializing`) | `test_deploy_cloudflare.py` |
| the project endpoint's string-array `domains` is **never** read for status | `test_deploy_cloudflare.py` |
| **ordering**: rollback removed / production before preview / branch assertion after upload each fail | `test_deploy_orchestrator.py` |
| file mutated between the two uploads aborts | `test_deploy_orchestrator.py` |
| **snapshot**: mutation during enumeration and between sizing and hashing detected; post-seal source mutation leaves uploaded bytes unchanged | `test_deploy_snapshot.py` |
| **marker**: tampered footer with a correct embedded `build_id` blob still FAILS | `test_deploy_verify.py` |
| **marker**: short vs full code sha — exact comparison, no containment | `test_deploy_verify.py` |
| **marker-preserving tamper, one file at a time** across HTML/JS/CSS/JSON, exact requested-path set | `test_deploy_verify.py` |
| injected `_redirects` hijacking an inventoried path fails | `test_deploy_verify.py` |
| Functions-reporting deployment fails; **each control path poisoned separately** | `test_deploy_verify.py` |
| Cloudflare API unavailable → `unavailable`, not "tampered" | `test_deploy_verify.py` |
| **preview sweep (R9)**: a marker-preserving tamper that passes markers **and** the `stats.json` hash still **fails** the preview inventory sweep — the fixture that makes TD-4's bound non-vacuous | `test_deploy_verify.py` |
| **env contract**: workflow lint asserts all four vars; a `POPULUS_TICKER_MAP` pointing at `tests/fixtures/**` is **refused under CI** | `test_attestation_structure.py`, `test_publish.py` |
| ticker map is a **manifest-listed staged artifact**, covered by the served-tree sweep | `test_publish.py` |
| **gate**: unattested / wrong-identity generation FAILS | `test_publish.py` |
| **gate**: first-run predicate — no deployment + zero generations passes; any other unresolvable state fails closed | `test_publish.py` |
| **gate** does not call the Cloudflare API | `test_publish.py` |
| **gate's step name does not collide with `_step_index("verify")`** — the three existing attest/verify tests still pass | `test_attestation_structure.py` |
| **skipped signer job is treated as failure** — a workflow-semantics fixture, not only a YAML shape lint | `test_attestation_structure.py`, `test_publish.py` |
| **skipped *deploy* job is NOT a failure** (the unarmed nightly stays green) | `test_attestation_structure.py` |
| **R25 round-trip**: a generation attested as `deployments/<gen>.json` verifies; one attested by basename is **refused** | `test_attestation.py` |
| build seam: fresh / preserved / reconciled outcomes | `test_publish.py` |
| **final manifest does not list itself**; journal-materialized recovery is byte-identical to the committed manifest | `test_publish.py` |
| non-fresh build **surfaces the skipped deploy in the job summary**, not only in logs | `test_attestation_structure.py` |
| stats byte-equality is asserted **with a killing mutant** — under the single-writer mechanism it is true by construction, so the mutant makes the `dist/` emitter re-serialize (parse + `JSON.stringify`) and the assertion must fail; without it the row tests nothing | `test_publish.py` |
| stats: byte-equality between the canonical and `dist/` copies; the `dist/` emitter produces them; 15,000-cap; nullable schema passes **all three** closed-world validators; publish-time non-null assertion | `test_stats.py`, `test_publish.py`, `dashboard/test/pages-render.test.ts` |
| **§17(h) credential fixtures (amended)**: the signer fails closed with a **missing** token, succeeds with `Pages Read`, and **never issues a non-GET Cloudflare call** — the injected transport fails the test on any write verb | `test_deploy_verify.py` (signer path, T10) |
| workflow lint: all jobs scanned; deploy job has no GitHub write scopes; command list derived not hardcoded | `test_attestation_structure.py` |
| **doc regression**: `"verification_scope": "full"` and "full served-tree" absent from ARCHITECTURE **outside the revision-history table** | `test_attestation_structure.py` |
| **TD-10 documented non-detection** asserted as *not detected* | `test_deploy_verify.py` |

Each ordering guarantee, each disqualifier, the marker contract, R25's subject
binding, **R27's no-non-GET property** (mutant: make `record.py` issue one `POST`)
and the gate's verification step carry a killing mutant.

## Verification Matrix

| Req | Verified by |
|---|---|
| R1 | T8; workflow lint asserts the build step, node file, pinned Wrangler **and the full four-var env contract**; fixture-path refusal test |
| R2 | T5; three-outcome fixtures; CLI-surface test; self-listing and journal-recovery fixtures |
| R3 | T6; all three closed-world validators pass; non-null assertion test |
| R24 | T7/T5; `dist/stats.json` exists and is byte-equal to the canonical copy |
| R25 | T10; attest→verify round-trip; basename-attested generation refused |
| R4 | T1; snapshot mutation-window tests |
| R5 | T1; per-boundary assertions |
| R6 | T1/T8; artifact layout test |
| R7 | T9/T13; permission assertion; §14 amended |
| R8 | T2; mismatch-aborts fixture |
| R9 | T3/T4/T13; preview-failure fixture **and** the marker-preserving-tamper sweep fixture; §12.1 step 4 amended |
| R27 | T10/T13; no-non-GET-request fixture; §17(h) amended on the record |
| R10 | T4; mutate-between-uploads fixture |
| R11 | T2/T4; inactive-domain-aborts and rollback fixtures; no-DELETE assertion |
| R12 | T4; the four ordering mutants |
| R13 | T10; falsified-output fixtures; secrets block asserted by lint |
| R14 | T4/T11; no-prior-deployment path raises with the TD-4 pointer |
| R15 | T3/T10; one-file-at-a-time tamper fixtures |
| R16 | T2/T3/T13; recorded fixtures; TD-10 non-detection; doc regression check |
| R17 | T3; unavailable-vs-rejected fixture |
| R18 | T11; unattested-generation and first-run-predicate fixtures |
| R19 | T7/T3; tampered-footer and sha-form fixtures |
| R20 | T11; skipped-job-is-failure test |
| R21 | T12; guard covers all jobs and derived commands |
| R22 | T13; §14 records the owner-attested scope as provisioning evidence; no runtime introspection |
| R26 | T13; §14 names both token endpoints; TD-5 recorded |
| R23 | T13; runbook exists |

## Rollout / Rollback

**Owner prerequisites — none of which this run can do:**

1. Provision `DATA_REPO_PAT` (fine-grained on `populus-data`: Contents
   read/write **plus** Administration: read, permanently).
2. ~~Confirm `CLOUDFLARE_PAGES_READ_TOKEN` is account-owned~~ — **done**, verified
   against `GET /accounts/{id}/tokens` and absent from `GET /user/tokens` (R22).
3. Create the `Pages:Edit` token **only once this run's code exists**, from the
   account API-tokens page so it is enumerable alongside its sibling.
4. ~~Activate the custom domain and confirm `status: active`~~ — **DONE.**
   `GET /accounts/{id}/pages/projects/publicfilings/domains` reports
   `status: "active"` with a Google Trust Services certificate issued, and
   `latest_deployment` still null. This is the prerequisite that replaced three
   rejected first-run mechanisms: one-time provisioning of the same kind as items
   1–3, never touching the per-deploy path. **It did not require a deployment** —
   Cloudflare validated through the zone it already controls. R11 re-asserts the
   active status per run against the same endpoint, so a later deactivation aborts
   before the production upload.

**Then:**

5. Merge with both `*_ARMED` unset — nothing runs.
6. Set `POPULUS_RECORD_SIGN_ARMED=true` **before** the publisher. Arming it early
   is inert — `record-sign.yml` is `workflow_call`-only, so with no armed caller
   it never executes. The dangerous order is the reverse (R20).
7. Set `POPULUS_PUBLISH_ARMED=true`.
8. `workflow_dispatch`. The first run deploys to preview, verifies, deploys to
   production, verifies the already-active domain, and signs. **This is the real
   proof** — there is no separate bootstrap step. **Watch this run**: it is the one
   run carrying TD-4, so a production-verification failure needs a human.
9. Nightly takes over.

Rollback: unset the armed variables (instant); revert the merge; §13.5 from the
last attested generation.

## Simplicity Audit

Revision 3 moves the first-run problem **out of the codebase entirely**: the
deploy path has no bootstrap input, no polling loop, no timeout, no exemption and
no compensating special case — it has a precondition assertion and a rollback,
both of which the steady-state path needs anyway. The residual risk is declared as
TD-4 rather than engineered around, which is the smallest honest answer available.

The file list grew because round 2 re-derived the blast radius; every addition is
surface that was always in it. The orchestrator remains complexity bought
deliberately, so that ordering guarantees are failing tests rather than opinions.
Rejected: a deployment-provider interface; a retry framework; a shared verification
base class.

**Accepted, declared:** the same bytes are verified twice by two actors with
different trust assumptions. That is the security argument, not duplication.

## Tech Debt Introduced

1. **TD-8 and TD-10** remain declared, unchanged.
2. **§17's P3 gate does not close** — the ≥3-nightly requirement is time-based.
3. **Third-party verification** waits on the §15.3 counsel gate.
4. **TD-4 — the first production deploy has no automated compensation.** There is
   no prior deployment to roll back to, and Cloudflare will not delete an active
   production deployment. A first run that passes preview verification but fails
   production verification leaves an unverified deployment serving. Bounded by R9:
   the identical bytes already passed the **inventory-wide** preview sweep that R9
   now requires and T13 amends §12.1 step 4 to specify, so a production-only failure
   indicates routing or cache rather than bad bytes. That amendment is what makes
   this bound real: as §12.1 step 4 stands today it checks only markers plus a
   `stats.json` hash, and `ARCHITECTURE.md:320` says in terms that marker checks
   alone are insufficient — so without R9's amendment this entry would be a
   write-off with a citation attached.
   Owner: project owner. **Removal condition: the first successful deploy** — after
   which every run has a rollback target and this entry is deleted permanently.
   *(Revision 1 declared this honestly; revision 2 deleted the declaration on the
   strength of a delete-compensation the provider refuses. It is restored.)*
5. **TD-6 — §12.1 step 1's Dependabot discipline is unmet.** No
   `.github/dependabot.yml` exists. The Wrangler exact pin and committed lockfile
   land in this run; automated update surveillance does not. Owner: project owner.
   Removal condition: add the manifest. Declared rather than claimed.
6. **TD-7 — the production site ships with no ticker map.** No source for a real
   `company_tickers.json` exists on a CI runner (R1), so `POPULUS_TICKER_MAP` points
   at an explicitly absent path and the ticker surfaces render the honest no-map
   state: search-index ticker names are `""` (`data.ts:544`) and ticker pages show
   `no-map` (`:612`). Chosen over the alternative it replaces — fixture-derived
   mappings served as production data, which the served-tree sweep **cannot**
   detect. Owner: project owner. Removal condition: a real registry source staged
   into the pipeline (an ingest step, or a copy committed to `populus-data`).
   **Test/production divergence to watch:** with the variable unset locally,
   `inst.ts:314-315` falls back to the fixture, so `dashboard/test/*.test.ts` always
   exercise the *mapped* path while CI deploys the *no-map* path —
   `pages-render.test.ts` needs a no-map case or the deployed surfaces are untested.
7. **TD-5 — the credential audit surface is incomplete by construction.**
   `GET /accounts/{id}/tokens` does not enumerate user-owned tokens; a
   pre-existing, non-expiring, user-owned token with broad zone-level Read
   (`Cloudflare Agent (auto-generated)`) is invisible to it. Owner: project owner.
   Removal condition: either that token is revoked/scoped down, or §14's audit
   procedure permanently enumerates both endpoints. Out of scope for this run —
   R26 records the fact; revoking credentials is an owner decision.

## Memory Touch-Points

- **`measure-the-mechanism`** — round 1 found the dashboard contract and both
  stats validators outside scope; revision 2 lists them because they were
  *derived* from the tree, not from the draft.
- **`reversing-a-reviewed-decision`** — **four** spec amendments are recorded
  corrections, not silent edits; the `"full"` residues are a separate deletion.
  Five review rounds have each caught at least one fix that read as done and was not.
- **`specify-before-rewriting`** — §12.1 is the specification; defects found *in
  it* are fixed there.
- **`mutation-tests-pin-properties`** — ordering, disqualifiers, the marker
  contract and the gate's verification step each need a killing mutant.
- **`verify-against-a-frozen-tree`**, **`review-scope-decides-the-verdict`**,
  **`orchestrate-worktree-isolation`**, **`plan-v1-literal-rid-tokens`**.

## Failure-Mode Sweep

- **F0 verify-don't-assume** — ✓ and **round 2 proved revision 2 still had not done
  it for the provider**: it polled a field the pinned endpoint does not return and
  specified a compensation Cloudflare refuses. Every Cloudflare fact in Current
  State is now cited to documentation, and every code fact to file:line.
- **F1 gate-list completeness** — ✓ five gates, and R3 exists because *three files*
  validate a schema the seam would have broken — revision 2 counted two, and leaned
  on the one that is normally skipped.
- **F2 full-tree gate scope** — ✓ Makefile entrypoints, **including `make test` →
  `npm run gates`**, which revision 2 did not trace into `dashboard/test/`.
- **F3 verify end-to-end** — ✓ Rollout step 8 is the real proof; **four** owner
  prerequisites named, one of them newly load-bearing.
- **F4 honest handoff** — ✓ Non-goals names every §17 item not closed, now
  including the CSP `_headers` foreclosure, and §17(h)'s credential fixtures are
  *in* scope rather than silently dropped.
- **F5 no self-signing** — ✓ P3-3a's code review found four blockers past five
  green gates; two plan rounds have found 15 more. This plan expects a third.
- **N/A** data-migration — the stats field is additive and nullable.

## Definition of Done

- **R1** done: the workflow builds the site with pinned Node and Wrangler and the
  documented env contract.
- **R2** done: all three outcomes specified and fixtured; non-fresh builds skip
  the deploy leg; no path publishes a false count.
- **R3** done: all three closed-world validators pass; a null count fails at
  publish time.
- **R24** done: `dist/stats.json` is emitted by the build and is byte-equal to the
  canonical copy.
- **R4** done: the seven steps; mutation-window tests pass.
- **R5** done: digest asserted at all five boundaries.
- **R6** done: `inventory.json` sibling to `site/`.
- **R7** done: the deploy job holds no GitHub write scopes; §14's headline amended.
- **R8** done: branch mismatch aborts before upload.
- **R9** done: preview failure leaves production untouched, **and the preview
  verification is inventory-wide** — a marker-preserving tamper fails it, so TD-4's
  bound rests on a check that actually runs.
- **R27** done: §17(h) amended on the record; the signer issues no non-GET
  Cloudflare request and the transport fails the test if it does.
- **R10** done: mutation between uploads aborts.
- **R11** done: custom-domain verification runs on **every** deploy; the active
  status is read from the `/domains` subresource; an inactive domain aborts before
  upload; rollback is fixtured and **no DELETE call exists in the codebase**.
- **R12** done: all four ordering mutants killed.
- **R13** done: the generation is attested; the `secrets:` block declares both.
- **R25** done: a generation attested as `deployments/<gen>.json` round-trips
  through the existing verifier; a basename-attested one is refused.
- **R14** done: no exemption exists anywhere in the deploy path; the first run's
  residual risk is TD-4, declared with a removal condition.
- **R15** done: one-file-at-a-time tamper fixtures pass with exact path sets.
- **R16** done: provider checks pinned to recorded fixtures; TD-10 non-detection
  asserted; the doc regression check passes and ARCHITECTURE is clean.
- **R17** done: an unavailable Cloudflare API reports as such.
- **R18** done: an unattested generation fails the gate; the first-run predicate
  passes only on no-deployment + zero-generations; the gate never calls Cloudflare.
- **R19** done: a tampered footer fails even with a correct embedded blob; sha
  comparison is exact; **no page renders a manifest digest**, methodology included.
- **R20** done: a skipped signer job fails the run, proven by a workflow-semantics
  fixture; a skipped deploy job still passes.
- **R21** done: the guard scans all jobs, derives its command list, and
  `_step_index` no longer resolves by first substring match.
- **R22** done: `Pages:Edit` recorded in §14 with scope and expiry, labelled
  owner-attested; the signer makes **no** runtime scope claim.
- **R26** done: §14 names both token endpoints as the enumeration surface and
  records the user-owned blind spot as TD-5.
- **R23** done: `docs/runbooks/deploy.md` exists and covers TD-4's remediation.

Plus: all five Makefile gates exit 0 on a hash-stable tree; every required mutant
killed.
