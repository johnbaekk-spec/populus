# Handoff — M1 final: R36 + R28, then R8

Written 2026-08-19, after four external-review cycles closed R7 and R10.
**Read this before the plan.** Every constraint in §7 and every lesson in §8 cost
real time in the session that produced them.

## 1. State of the world

| Thing | Where | State |
|---|---|---|
| The plan | `docs/design/UX-OVERHAUL-PLAN.md` | plan-v1 Revision 4, **amended 2026-08-19** (R10: "near-universal" → "universal") |
| `main` | `c62db75` | PRs #45 (R35+R9), #46 (R7+R10) and #47 (B34+B35) all merged |
| Worktree | `<repo>/.claude/worktrees/ux-overhaul` | branch as needed |
| Remaining M1 | **R36 + R28 (one commit), then R8** | not started |

**Branch from `origin/main`.** Everything M1 has shipped so far is on it —
R4/R5/R6/R7/R9/R10/R35 plus the B34/B35 completion — so there is no open branch
to inherit from and nothing in flight to collide with.

## 2. What is already done, so you do not redo it

- **R4, R5, R6, R7, R9, R10, R35** are merged and gated.
- **The geometry harness** (`dashboard/test/geometry/`) runs at 360/720/964/1080/1440
  against real `dist`, with a negative-control spec that must FAIL on a
  reintroduced defect. 44 assertions.
- **The R10 whole-dist gate** (`dashboard/test/post/universal-caveat.test.ts`)
  asserts no unpaged table repeats one flag on every row without stating it once.
  It carries a detector self-test — see §8, it was wrong three times.
- **Unit baseline: 406.** Reconcile against it after every change.

## 3. R36 + R28 — ONE commit

The plan inlines this in full at `docs/design/UX-OVERHAUL-PLAN.md` §R36. Read it
there; this section carries only what execution proved.

Scope, all in one commit: the Cloudflare beacon in `Base.astro`, **both**
privacy-copy files, the byte-exact locked CSP in a new
`dashboard/public/_headers`, and the whole control-envelope change.

### The CSP is LOCKED byte-exact in the plan

Two script hashes, `style-src 'unsafe-inline'`, and **NO style hashes** — CSP
ignores `'unsafe-inline'` in a directive that also lists hashes, so adding one
would silently re-block every bar on the site.

**VERIFIED 2026-08-19 against the current tree — do NOT re-measure them:**
exactly two distinct EXECUTABLE inline scripts exist, both on all 9,660 pages,
both matching the locked pair:

    sha256-l7z5mLHE3mvA5XUH9QJEiNRmReuFTfsBcWHAxRGvW3k=   389 B  pre-paint theme
    sha256-MqA3PKuITCptalBQPnAhrxVICEdcFhUVx47/2VNIkDU=   937 B  theme-toggle module

(The plan says the second is 933 B. It is 937 B. The HASH is what matters and it
matches.)

### B31 — the trap that will eat a day if you miss it

The plan's census — *"exactly TWO distinct inline script modules"* — was taken
over **3,668** pages. The tree is now **9,660**, and the institutional embeds
brought **2,953 `<script type="application/json">` data islands** with them, up
to 2.4 MB each.

A whole-dist sweep that matches `<script>` without inspecting `type` counts
**2,955** distinct bodies, not 2. The obvious reaction — add the missing hashes —
is exactly backwards: `type="application/json"` never executes, `script-src` does
not govern it, and hashing it would pin the CSP to the corpus so **every data
refresh breaks the deploy**.

Count only bodies whose `type` is absent, `module`, `text/javascript`, or
`application/javascript`. Filtered that way the emitted set equals the locked
pair EXACTLY (set equality, not superset), which is what R36's matrix row wants.

### The privacy copy — both files, same commit

`methodology/index.astro:207` currently reads *"No tracking, no cookies, no
fingerprinting, no analytics of any kind"*. That becomes false the moment the
beacon ships, so it changes in the beacon's commit, not after.

`scripts/search-client.ts:52` says *"this site has no view analytics to rank
by"*. Reconcile it — the claim survives in narrowed form (there is still no
per-page view ranking) but it cannot be left as written without checking.

State the locked retention verbatim: **7-day unsampled, ~10% aggregate,
six-month window**, attributed and dated.

### The control envelope — every consumer, same milestone

This deliberately changes a security posture the deploy pipeline enforces, so
every consumer changes with it. All three files exist and are the anchors:

| File | Change |
|---|---|
| `src/populus/publish/inventory.py` | gains a `control_files` list (path, bytes, sha256) beside `files`; `_headers` goes there |
| `src/populus/deploy/snapshot.py:255` | `_require_copy_faithful` compares the copied set against `files` ∪ `control_files` |
| `src/populus/deploy/verify.py:146` | `content-security-policy` joins `ALLOWED_RESPONSE_HEADERS` as REQUIRED, equal to the locked value, with missing/altered negative tests |

`site_file_count` counts `files` only; control files are named in the build
record. The domain-serving sweep iterates `files` only. Control-path probes
(including `/_headers`) stay exactly as they are.

**R28 is satisfied by R36's beacon** — it must exist before any M2 change lands.

## 4. R8 — a read-model change, and the largest live defect left

**MEASURED 2026-08-19 on the current build: 112,976 raw position keys render as
VISIBLE text across 1,312 of 1,500 filer pages.** Example, from
`dist/institutional/filers/1000275/`:

    <td class="c-pos"><span class="mono-note">sid:sec:prov:629d8827d09a94eb37ae25403f4edcf6</span></td>

That is plan success criterion #2 — *"No default view renders an internal
identifier"* — violated on 87% of filer pages. It is the biggest remaining
user-visible defect in M1.

**Plan the read model before writing UI.** The data problem is real:

- `QoqDeltaRow` (`dashboard/src/lib/inst.ts:34`) carries **no `issuer_name` at
  all** — only `position_key`, `put_call`, periods, values, shares, flags.
- `TopHolderRow` (`inst.ts:51`) **does** carry `issuer_name`, and the reader at
  `inst.ts:213` already selects it. So the name exists on serving rows; it is not
  on the QoQ row.
- The rows are read from `agg_qoq_deltas` (`inst.ts:155`).

R8's requirement is *"a period-keyed projection joining the already-denormalized
`issuer_name` on serving rows"*. **Period-keyed matters**: an issuer's name can
differ between quarters, and joining without the period is a G14 identity
time-travel violation. The render site is `ui.ts:1038` (`c-pos`).

Unresolvable keys render a **plain-English unknown**, never a key and never a
blank. The matrix row also wants a `grep -a`-negative for key prefixes.

## 5. Build recipe — `POPULUS_PRIOR_SIGNALS` is REQUIRED

Without it the build exits 1 after emitting ~4,900 of 17,283 files, which looks
plausible if you only glance at `dist/`. **Check the EXIT CODE, not the tree.**
The missing ticker registry is deliberate — that is the production configuration.

```bash
W=/Users/johnbaek/populus-build-20260817.1   # already staged: builddir + 3 DBs
cd dashboard && CI=true \
  POPULUS_BUILD_DIR="$W/builddir" POPULUS_DB="$W/congress.db" \
  POPULUS_INST_DB="$W/inst_agg.db" POPULUS_TICKER_MAP="$W/no-ticker-registry.json" \
  POPULUS_PRIOR_SIGNALS="$W/builddir/signals.v1.json" \
  SITE_CODE_SHA="$(git rev-parse HEAD)" npm run build:bounded
```

~10 min, needs 32 GiB. Then `npx playwright test` and
`node --test test/post/universal-caveat.test.ts`.

`test:post` needs the same env vars, and it now carries
`--max-old-space-size=24576` because it used to OOM inside `node:sqlite` before
its first assertion. Its 13 remaining failures are attributed in BACKLOG §8 —
none is yours; confirm the set has not grown rather than assuming.

## 6. The review loop

```bash
source ~/projects/orchestrate-tool/lib/codex-bridge.sh
export CODEX_EXECUTION_CONTEXT=interactive_bridge
export TEST_CMD='cd dashboard && npm run check && npm test'
BRIDGE_REVIEW_PHASE=code-review-<fresh-label> codex_review_round <label> <prompt-file>
```

Traps, each of which cost a round:

- Leave `CODEX_REVIEW_PHASE` **UNSET** — the phase allowlist forces
  CHANGES_REQUESTED for `code-review`.
- **PIN `TEST_CMD`** or it resolves `make test` and burns a round on the backend.
- Use a **fresh** `BRIDGE_REVIEW_PHASE` per cycle; the round counter is
  per-phase and the cap is 3.
- The label prefix names the artifact files, so a reused prefix **overwrites** a
  previous cycle's findings.
- The bridge reads `PLAN.md`/`DEV-NOTES.md`/`QA-REPORT.md` at the REPO ROOT (all
  three are in `.git/info/exclude`), and they must describe THIS diff.
  `qa-report-v1`'s verdict must END with PASS, FAIL or INCOMPLETE.
- **Never submit from a dirty tree.** One round was spent reviewing
  half-finished work because uncommitted edits sat on disk.
- Validate artifacts before submitting:
  `workflow_validate_content dev-notes-v1 "$REPO/DEV-NOTES.md" dev` (from
  `~/projects/orchestrate-tool/lib/workflow-artifacts.sh`). The H2 heading set is
  fixed and exact.

## 7. Standing rules

- Never pipe a gate; read the command's own exit code. Under zsh
  `${PIPESTATUS[0]}` is empty.
- `grep -a` always — `derive.ts` contains a deliberate NUL byte.
- Do not write the bare word for the popular HTTP client library anywhere under
  `src/populus/` — `dep_guard` greps comments too.
- Push feature branches; **never** push to `main`. `gh pr merge` is
  classifier-blocked — hand PRs to the owner and say so plainly.
- `test:post` and the geometry lane never run in CI; a local unfiltered
  `make check` is the only authoritative evidence.
- Banned wording is word-boundary over `dist/`: `sold`, `bet`, `conviction`,
  `bullish`, `bearish`, `backs`, `favors`, `likes`, `buying`, "fund size".
- No price data; closed quarters only; null is never zero; nothing
  honesty-bearing tooltip-only or media-query-hidden.

## 8. What four review cycles taught, in one page

Nine findings became blockers because a check looked green while measuring
nothing. **A check that cannot fail is indistinguishable from a check that
passes.** Every gate here now carries a proof that it fires; keep that.

The specific shapes, all of which recurred:

1. **A test that skipped and read as coverage.** An R9 assertion loaded a page
   with no `.tiles`; it skipped every run through two consecutive INERT fixes
   that measured byte-identically.
2. **A guard whose SCOPE silently stopped including the code it guards.** The
   fold sweep selected media blocks four different wrong ways before landing on
   "blocks whose `[min,max]` interval intersects `[0,720]`, per comma-separated
   arm".
3. **A liveness check that asserted a violation still exists.** Once the fix
   worked, "found none" became indistinguishable from "the regex is broken".
   Assert the sweep can PARSE, not that offenders remain.
4. **A page-wide exemption letting a wired table vouch for its unwired sibling.**
5. **The `<thead>` row counted as data** — a header carries no flags, so
   "some row has no flag ⇒ not universal" skipped EVERY production table. The
   gate was inert and its own fixture passed because it had no `<thead>`.
6. **A marker trusted for its presence rather than its meaning.** An empty
   `data-stated-flags` on a visibly repeating table passed.
7. **Measuring the wrong box.** `getBoundingClientRect` on a child inside a
   closed `<details>` reports a stale rect; `checkVisibility()` returned false
   even when open. Measure the `<details>` element's own height.
8. **Fixing between rounds without review.** Two regressions were introduced
   exactly that way — universality judged per page instead of per table, and the
   inert gate. If the cap is spent and a fix is not trivially provable, file it.
9. **A wrong instrument manufacturing the defect it claims to find.** Forcing a
   table wide made the sticky identity column (opaque, `z-index: 2`) cover the
   scroll cue, "proving" a bug that did not exist. Ruled out only by injecting an
   opaque red band and watching it vanish.

**Mutation-check every gate you add**: break the thing, watch it go red, restore,
watch it go green. Verify the mutation actually applied before trusting either
result.

## 9. Definition of done, per requirement

Its Verification Matrix row passes; a test FAILS if the feature is removed; local
unfiltered `make check` green (or its failures attributed as in BACKLOG §8); no
banned string in `dist`; no raw identifier, flag slug, or schema reference in any
default view.
