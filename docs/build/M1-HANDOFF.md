# Handoff — M1 after R36+R28 shipped: what remains is R8, and it needs DATA

Written 2026-08-19, superseding `M1-FINAL-HANDOFF.md`, which assumed R36+R28
and R8 could both be executed in one pass. R36+R28 shipped. **R8 cannot be
finished from any artifact currently on disk**, and §4 is the whole reason this
document exists — read it before planning any R8 work.

Three premises in the previous handoff were re-measured and two had moved. Do
the same to this one.

## 1. State of the world

| Thing | Where | State |
|---|---|---|
| The plan | `docs/design/UX-OVERHAUL-PLAN.md` | plan-v1 Revision 4, amended 2026-08-19 |
| `main` | `b95b1bf` | PR #48 merged (that PR was the handoff doc itself) |
| **R36 + R28** | **PR #49**, `feat/m1-r36-r28-r8` @ `58a9dd9` | **DONE — in review, not merged** |
| **R8** | `feat/m1-r8-security-directory` @ `851f785` + docs | **code-complete, UNVERIFIABLE — see §4** |
| Remaining M1 | **R8 only** | blocked on a corpus, not on code |

`M1-FINAL-HANDOFF.md` remains accurate for everything R36 and for §7–§8's
standing rules. It is wrong only where it implies R8 is executable today.

## 2. R36 + R28 — done, and what it cost to get right

PR #49. The beacon, the byte-exact locked CSP, the provider-control envelope,
and the privacy copy. Gate evidence is in the PR body; not repeated here.

Four things the plan did not predict, recorded because each is a class of miss
rather than a one-off:

1. **The plan named two copy files. The tree had five.** `Base.astro`'s footer
   shipped "no tracking" on EVERY page; `index.astro` and
   `watchlist/index.astro` carried their own. A line-oriented grep missed them
   because the prose wraps. **Sweep copy newline-insensitively or do not claim
   coverage.** `dashboard/test/privacy-copy.test.ts` now does, with a positive
   control proving it fires on a wrapped denial.
2. **Three deploy test-doubles** each needed the CSP attached — `verify`,
   `record`, `upload`. A change to a shipped posture propagates to every fake
   that models the thing.
3. **B31 is real and measured on this corpus.** Matching `<script>` without
   inspecting `type` finds **2,955** distinct bodies rather than 2, because
   **2,953** `type="application/json"` islands never execute. Largest is now
   **8.50 MiB** — the previous handoff recorded "up to 2.4 MB", so the corpus
   grew ~3.5×. Hashing them would pin the CSP to the corpus and break the deploy
   on every data refresh.
4. **A gate written for this work was inert, and only mutation-checking caught
   it.** `test_a_control_file_is_hash_bound_like_any_other` passed under BOTH
   the correct and the broken implementation: reverting `_require_copy_faithful`
   to `files`-only also raises `SnapshotError` also naming `_headers`, via the
   key-set branch. The assertion matched a substring common to both. It is now
   pinned to `"copied bytes do not match the sealed tree"`.

## 3. DEPLOY PRECONDITION, already satisfied — do not silently undo it

Cloudflare Web Analytics must stay on **"Enable with JS Snippet installation"**.
The owner switched it 2026-08-19. Under automatic injection Cloudflare adds the
same beacon at the edge and **every pageview counts twice**.

Measured 2026-08-19 before the switch: no beacon was reaching the served pages
and the site shipped no CSP — so both plan premises were re-verified against the
live domain rather than assumed. If you inherit this and the numbers look
doubled, check the RUM install mode first.

## 4. R8 — the blocker, stated precisely

**The defect is LIVE.** Measured 2026-08-19 on the current build: **112,976 raw
position keys render as visible text across 1,312 of 1,500 filer pages** — e.g.
`sid:sec:prov:629d8827d09a94eb37ae25403f4edcf6` in a `c-pos` cell. Plan success
criterion #2 violated on 87% of filer pages. This is the largest remaining
user-visible defect in M1 and it is still shipping.

**The code is done.** On `feat/m1-r8-security-directory`: `agg_security_directory`
period-keyed and projected in BOTH builders, `title_of_class` carried through
`_AGG_INPUT_COLUMNS`, the period-keyed join, the render, the payload decoder,
and 9 fixture tests. `pytest` green, `astro check` 0 errors.

**It cannot be verified, because no artifact has both halves:**

| Artifact | `inst_holdings` | periods | `agg_qoq_deltas` |
|---|---|---|---|
| `data-20260731.1` … `data-20260802.2` (5 releases) | 602,496 | **1** | n/a |
| `data-20260812.1/congress.db` | **0** | — | n/a |
| `data-20260812.1/inst_agg.db` | n/a | 6 | **9,482,028** |
| staged `populus-build-20260817.1` | **0** | — | v2, no directory |

The projection needs raw holdings. The changes table needs multi-period deltas.
The holdings stop being carried somewhere between 08-02 and 08-12.

**Two traps, and the second is worse than the first.**

- Regenerating from the 08-02 source produces a CORRECT directory — 12,537 rows,
  every `class_title` populated, zero empty names — and **0 QoQ deltas**. The
  changes table renders nothing, so a `grep -a` key-prefix negative over `dist`
  comes back clean because **there are no rows**, not because the fix works.
  That is a false green, and it is the obvious way to "finish" R8.
- That corpus yields only **`cusip:`-shaped** position keys, while the measured
  defect is **`sid:`-shaped**. If production's QoQ rows are `sid:`-keyed and the
  directory is `cusip:`-keyed, the join misses entirely and every row renders
  "security not identified" — **worse than the raw key**, and invisible on this
  corpus. Do not ship R8 without proving the key spaces match.

**To resume, exactly one thing is needed:** a corpus carrying BOTH multi-period
holdings AND `sid:`-shaped position keys — the corpus behind the 112,976
measurement. Nothing else about R8 is open. Tracked as **B36**.

Also observed, unresolved, and possibly the same root cause: the regenerated
aggregate has **zero entity-keyed issuers** (`resolution_source` 100% `cusip6`),
matching the shipped 08-12 artifact. So issuer→entity linkage is not landing in
the builder generally. Consequence: `institutional/tickers/[t]/holders` emits
**zero pages**. If a future corpus DOES produce entity-keyed issuers, those
pages start emitting for the first time — check it against the file-count budget
(**B27**, already at 85% of the 25 MiB per-file cap) before being surprised.

## 5. Build recipe — and check the FILE COUNT, not just the exit code

```bash
W=/Users/johnbaek/populus-build-20260817.1   # builddir + 3 DBs
cd dashboard && CI=true \
  POPULUS_BUILD_DIR="$W/builddir" POPULUS_DB="$W/congress.db" \
  POPULUS_INST_DB="$W/inst_agg.db" POPULUS_TICKER_MAP="$W/no-ticker-registry.json" \
  POPULUS_PRIOR_SIGNALS="$W/builddir/signals.v1.json" \
  SITE_CODE_SHA="$(git rev-parse HEAD)" npm run build:bounded
```

~23 min, needs 32 GiB. The missing ticker registry is deliberate — that is the
production configuration.

**A complete build is 9,660 pages / 17,283 files.** Without
`POPULUS_PRIOR_SIGNALS` the build exits 1 after ~4,900. That much the previous
handoff said. What it cost this cycle to learn: **a thin tree does not announce
itself — it announces itself as unrelated test failures.** A 9,672-file tree
(56% complete) produced three geometry failures that read as a harness
regression on `main` and consumed most of two sessions before anyone counted
files. Count them first:

```bash
find dist -type f | wc -l    # expect 17283
```

**Never pipe a gate.** `${PIPESTATUS[0]}` is empty under zsh — verified again
this cycle, where `pytest -q | tail` reported "exit code 0" over five real
failures. Redirect to a file and read `$?`.

## 6. Standing rules — unchanged, carried forward

All of `M1-FINAL-HANDOFF.md` §6 (the Codex loop) and §7 (standing rules) apply
verbatim. The ones that bit this cycle:

- `grep -a` always — `derive.ts` contains a deliberate NUL byte.
- Push feature branches; **never** to `main`. `gh pr merge` is
  classifier-blocked — hand PRs to the owner.
- `test:post` and geometry never run in CI; a local unfiltered `make check` is
  the only authoritative evidence.
- Banned wording is word-boundary over `dist/`. Note `dist/legal/DATA-LICENSE.md`
  contains `sold` in license prose; the real gate scopes past it, so a hand-rolled
  grep will produce a false positive there.
- **Do not edit source while a build is running.** One build was discarded this
  cycle for exactly that.

## 7. Attributed `test:post` failures — now 13, unchanged

10 × `fixture-preview` (B18 — resolves a dev build path that does not exist;
worktree artifact), 1 × search-index budget (B18.3, 506,945 B vs 128 KiB),
1 × `R19 GATE` (B27), 1 × `Locked #19` (B29). **Confirm the set, not the
count** — a coincidental 13 is not the same 13.

Geometry is **44 pass / 0 fail on a complete tree** (B37, closed as not-a-defect).

## 8. What this cycle taught

The previous handoff's §8 lesson — *"a check that cannot fail is
indistinguishable from a check that passes"* — recurred twice, and once in the
mirror:

1. **A check that cannot fail.** The control-file test above, passing under the
   broken implementation because both branches raised the same exception type
   naming the same path. Caught only by breaking the code and watching.
2. **A check that cannot PASS looks exactly like a check catching a defect.**
   Two geometry canaries assert the stat strip wraps at 720px. On a thin corpus
   there are four sparse tiles and nothing to wrap, so they fail for want of a
   precondition — reporting the identical red a broken detector would. The wrong
   reading is the alarming one, which is why it escalated. Tracked as **B38**:
   assert the precondition before the property.
3. **Two sessions, two "I ran it" claims, opposite results.** Neither "it was
   green for me" nor "it was red for me" is evidence. The discriminator was one
   `find | wc -l`. When measurements conflict, find the cheapest thing that
   distinguishes the apparatus from the subject, and run that before arguing.

**Mutation-check every gate you add**: break the thing, watch it go red, restore,
watch it go green — and verify the mutation actually applied. A "raised" that
came from an unrelated failure reads as a pass for the wrong reason.

## 9. Definition of done, per requirement

Unchanged from the previous handoff. For R8 specifically, add: the corpus it was
verified against must be named, with its period count and position-key shape, in
the Dev Notes. A green R8 on a single-period `cusip:`-keyed corpus proves
nothing, and this document exists partly so nobody re-learns that.
