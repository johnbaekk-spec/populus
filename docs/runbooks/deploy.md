# Runbook — deploy the dashboard (ARCHITECTURE.md §12.1)

The dashboard is deployed **publisher-side**, by the same workflow run that built
and published the data. There is no manual `wrangler` path, no bootstrap mode,
and no first-run exemption: the first deploy runs the identical protocol every
later deploy runs. What is special about the first run is only that it has **no
prior deployment to roll back to** — see §3, which is the one part of this
runbook that stops existing after the first success.

Companions: [`rollback.md`](rollback.md) (§13.5 — the only supported rollback,
now including the dashboard), [`attestation.md`](attestation.md) (what is signed
and how to check it).

---

## 1. What one armed run does

The full normative sequence is §12.1; this is the operator's map of it.

| Step | What happens | Failure leaves |
|---|---|---|
| 1 | Pinned inputs: `dashboard/.node-version`, `npm ci` from the committed lockfile, exact Wrangler pin | nothing deployed |
| 2 | Stage the data build → build the site from it → count `dist/` files → write the count into **both** `stats.json` copies → assert byte-equality → compute `dist_digest` → assemble/hash/attest the manifest → publish (assets → manifest → pointer) | data possibly published, site **not** deployed |
| 3 | Isolated deploy job: downloads the artifact, recomputes `dist_digest`, asserts the workflow-locked branch equals the project's configured `production_branch`, asserts the custom domain is `active` | production untouched |
| 4 | **Preview** upload, then verified **inventory-wide** (every `inventory.json` path fetched with redirects disabled, decoded body hash + length checked) plus markers and `stats.json` | production untouched, prior build still serving |
| 5 | **Production** upload of provably the same bytes, then live-verified on `publicfilings.org`. A failure whose findings are ALL inventoried paths answering `HTTP 404, expected 200` gets one 45 s settle and one re-verification of the **full** inventory (R11a — the custom domain can still be resolving individual objects seconds after a promotion); every other failure shape, and a second failure of that same shape, triggers the compensating Cloudflare rollback to the captured prior deployment id | prior build restored — **except on the first run**, §3 |
| 6 | `record-sign.yml` independently re-derives everything, re-verifies the served tree, and attests `builds/<build_id>/deployments/<gen>.json` | deployment live but **unrecorded** — the next publish is gated (§13.2, §17) until a valid generation exists |

Step 4's sweep being inventory-wide is a RUN P3-3b amendment to §12.1, recorded
in `ARCHITECTURE.md`'s revision table. It is not cosmetic: §18.1's TD-8 accepts
the production-verification window **only** because the same bytes already
passed the preview check, and that sentence means nothing if the preview check
read three marker files.

---

## 2. Owner prerequisites — four, none of which CI can do

1. **`DATA_REPO_PAT`** — fine-grained on `populus-data`: Contents read/write,
   **plus Administration: read, permanently** (the immutable-releases setting
   check in §13.2 runs forever, not only during staging).
2. **`CLOUDFLARE_PAGES_READ_TOKEN`** — **done.** Account-owned (not user-owned),
   active, expires 2027-08-03, exactly one policy whose permission groups are the
   single-element list `["Pages Read"]`, and absent from `GET /user/tokens`.
   Recorded in §14 as **owner-attested provisioning evidence**: the signer cannot
   check its own scope at runtime and does not pretend to.
3. **The `Pages:Edit` token — created LAST**, only once the deploy code that
   consumes it exists. Account-scoped (Cloudflare has no per-project Pages
   scope — the dedicated account is the boundary), **no IP filter**, expiry
   recorded in §14, and **minted from the account API-tokens page**
   (`/{account_id}/api-tokens`), *not* from My Profile — a user-owned token would
   be invisible to `GET /accounts/{id}/tokens`, which is the listing the §14
   quarterly audit reads.
4. **Custom domain active — DONE, and confirmed before arming.** The domain
   reached `active` with **zero deployments**, which settled a design question
   three revisions argued about from documentation silence:

   ```bash
   curl -sS -H "Authorization: Bearer $CLOUDFLARE_PAGES_READ_TOKEN" \
     "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/publicfilings/domains" \
     | python3 -c 'import json,sys; [print(d["name"], d["status"], d.get("certificate_authority")) for d in json.load(sys.stdin)["result"]]'
   ```

   Expected: `publicfilings.org active google`. The certificate is issued by
   **Google Trust Services**, not Let's Encrypt — any reasoning that assumes an
   ACME/Let's Encrypt validation path is reasoning about a mechanism this project
   does not use.

   Use **this** endpoint. `GET /pages/projects/{project}` returns `domains` as an
   array of bare strings carrying no status; it cannot answer this question.

---

## 3. Arming order — the record signer FIRST

```bash
gh variable set POPULUS_RECORD_SIGN_ARMED --repo johnbaekk-spec/populus --body true
gh variable set POPULUS_PUBLISH_ARMED     --repo johnbaekk-spec/populus --body true
gh variable list --repo johnbaekk-spec/populus
```

**The order is load-bearing, and the reverse order is the dangerous one.**

- Arming the signer early is **inert**: `record-sign.yml` is `workflow_call`-only,
  so with no armed caller it never executes. There is no cost to setting it first.
- Arming the publisher first is **not** inert. `record-sign.yml` gates on
  `POPULUS_RECORD_SIGN_ARMED` at the **job** level, and a job whose `if:` is false
  is **skipped — and a skipped job reports success.** A run in that state deploys
  to production, writes no deployment generation, and shows green. Nothing
  notices until the next publish is gated a day later.
- The workflow-side control for this is a caller-side assertion job
  (`needs: [deploy, sign]`, `if: always()`) that fails unless
  `needs.sign.result == 'success'`. The arming order is the **provisioning** half
  of the same property — do both; neither substitutes for the other.

Then dispatch, and **watch this run** (§4):

```bash
gh workflow run publish.yml --repo johnbaekk-spec/populus
gh run watch --repo johnbaekk-spec/populus
```

To stop everything instantly, unset the variables — no revert, no deploy:

```bash
gh variable delete POPULUS_PUBLISH_ARMED     --repo johnbaekk-spec/populus
gh variable delete POPULUS_RECORD_SIGN_ARMED --repo johnbaekk-spec/populus
```

---

## 4. The first run carries TD-4 — the one window with no automated compensation

**Every later run** that fails production verification rolls back automatically to
the captured prior deployment and re-verifies it. **The first run cannot**, for two
independent reasons that are provider facts, not implementation gaps:

1. There is no prior production deployment to roll back to (`latest_deployment`
   is `null` today).
2. Cloudflare **refuses to delete an active production deployment** — "this will
   not delete the active production deployment if one exists". Deleting the
   deployment was specified as the compensation in an earlier plan revision; it
   is not an operation the provider permits, so it is not in the code. The deploy
   path issues **no `DELETE`** call at all.

So a first run that **passes** preview verification and **fails** production
verification leaves an unverified deployment serving `publicfilings.org`, and
clearing it requires a human. This is declared as **TD-4**, not engineered away,
and it exists **exactly once**: after the first successful production deploy every
run has a rollback target and this section is deleted.

### Remediation, in order

1. **Read what actually failed before touching anything.** The identical bytes
   already passed the **inventory-wide** preview sweep (§12.1 step 4 as amended),
   so a production-only failure is far more likely to be routing, cache, domain
   state, or a Cloudflare-side propagation delay than bad bytes. The failure
   message names which assertion failed — marker mismatch, inventory path
   mismatch, provider check, or domain/deployment identity.
2. **Confirm what the domain is actually serving** (unauthenticated, no token):

   ```bash
   curl -sS "https://publicfilings.org/?cachebust=$(date +%s)" \
     | grep -o '<meta name="populus:[a-z_]*" content="[^"]*"'
   ```

   and which deployment the project considers production:

   ```bash
   curl -sS -H "Authorization: Bearer $CLOUDFLARE_PAGES_READ_TOKEN" \
     "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/publicfilings/deployments?env=production" \
     | python3 -c 'import json,sys; r=json.load(sys.stdin)["result"]; print(r[0]["id"], r[0]["environment"], r[0]["url"]) if r else print("no production deployment")'
   ```

3. **If the bytes are right and the environment was wrong** (stale edge cache,
   domain hiccup): fix the environment and re-dispatch the workflow. The next run
   re-verifies from scratch.
4. **If the bytes are wrong, forward-fix — you cannot go back.** Deploy a
   known-good tree over it by dispatching a corrected run. The moment a **second**
   deployment exists, the ordinary rollback path is available and TD-4 is over.
5. **Do not** attempt to clear it by deleting the Pages project or removing the
   custom domain. Both were considered and rejected on the record: project
   deletion requires removing the CNAME first and is not something a Pages token
   should be able to trigger, and either one returns the domain to
   `Initializing` — the exact state prerequisite 4 exists to clear, at the cost of
   re-running domain validation.
6. **File the incident issue** with the failing assertion, the deployment id, and
   what was served. A TD-4 event is the one deploy failure class that has no
   machine record of its own resolution.

---

## 5. A preserved or reconciled build skips the deploy leg — and the run must say so

`run_build` has **three** outcomes, and only one of them deploys:

| Outcome | Meaning | Deploy leg |
|---|---|---|
| **fresh** | a new build was assembled | runs |
| **preserved** | an in-flight staged build was recovered verbatim, never re-produced | **skipped** |
| **reconciled** | the build was already completed and reconciled | **skipped** |

Skipping is correct — there is no new tree to publish. The hazard is *how it is
reported*. An operator who dispatched the workflow specifically to redeploy sees
a **green run** and reasonably concludes the site was updated.

**Requirement: a skipped deploy leg is written to the job summary
(`$GITHUB_STEP_SUMMARY`), not only to the step log** — stating in one line that
**nothing was deployed and the live site is unchanged**. Logs are opt-in; the
summary is what the run page shows. Mechanism: `populus stage-build` exits **3**
for a preserved or reconciled build (recovery working correctly, not an error),
and the Stage build step writes a *"Build preserved — nothing deployed"* block to
the summary and skips every later step via `steps.stage.outputs.fresh`.

If you dispatched a redeploy and the summary does not say the deploy ran, **it did
not run** — the live site still serves the previous build.

To force a real redeploy of an existing build, use the §13.5 dashboard-restore
path in [`rollback.md`](rollback.md), which re-deploys through the same
preview-verify-then-production protocol and writes a **new appended generation**.

---

## 6. After the first success

- Nightly takes over; each run performs the same protocol.
- §17's "≥3 consecutive nightly deploys" gate is **time-based** — it closes on the
  third consecutive green nightly, and nothing in a single run can close it.
- The dashboard-inclusive §13.5 rollback drill and the second launch post both
  become possible only now, and both remain open P3 gates.
- Delete TD-4 from the plan's debt list and delete §4 of this runbook: the
  exposure it describes cannot recur once a rollback target exists.


## TD-4 incident: a deployment went live and could not be attested

**Symptom.** The `Gate on prior deployment generation` step refuses:

```
<domain> serves a deployment (populus:code_sha '<sha>') but populus-data holds
zero deployment generations. Something went live unrecorded.
```

**What happened.** The deploy job put bytes on the domain and the signer then
refused to attest them. The gate now blocks every publish — including the one
carrying the fix. This is the deadlock TD-4 predicts, and it is the gate working
correctly: it will not publish over a state nobody has explained.

**What NOT to do.** Do not attest the live build to clear the gate — that
records a provenance claim for something you know is wrong, which is the one
thing this system exists to prevent. Do not try to delete the deployment;
Cloudflare refuses to delete an active production deployment.

**Clearing it.**

1. Fix the underlying defect and merge it.
2. Read the sha the domain is actually serving:

```bash
curl -s https://publicfilings.org/ | grep -o 'populus:code_sha" content="[^"]*"'
```

3. Re-dispatch naming that exact sha:

```bash
gh workflow run publish.yml --repo johnbaekk-spec/populus --ref main -f acknowledge_unrecorded_code_sha=<sha>
```

The acknowledgement clears **only** this state, for **one** run, and attests
nothing. It must match the live sha exactly, so it cannot be set once and left
on, and it is unavailable to the nightly schedule. The verdict records that a
human overrode a gate and which deployment they overrode.

4. That run deploys the fixed build and writes the first real generation. The
   override is never needed again; the next run has a generation to verify.
