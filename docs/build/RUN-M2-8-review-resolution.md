# RUN M2-8 — review resolution (T7–T16, the holdings surfaces)

**Status:** QA PASS at round 3, with two Majors resolved in a fourth pass recorded below.
**Reviews used:** 3 of the owner's cap of 4.
**Reviewer:** internal QA agent (Codex unavailable — no tokens).

This file is the tracked record. `DEV-NOTES.md` carries the working detail but is
listed in `.git/info/exclude`, so it is permanently untracked and **cannot** be the
only home for a caveat — that was itself finding P1 below.

---

## 1. What this increment shipped

The reversal of DR-8 Pattern F for per-filer holdings: Populus now replicates the
13F corpus and serves a derived projection, instead of federating every position
list to EDGAR. Surfaces: a filer's complete reported portfolio, every institution
holding a given issuer, and a cross-filer activity feed.

The decision itself is recorded in `M2-8-holdings-publication-decision.md`, which
separates the two halves deliberately: internal Pattern-R replication is *derived*
from DR-8, while publishing the full position list is an **owner product decision**
that no prior document implies.

## 2. Round-by-round

| Round | Verdict | Findings | Note |
|---|---|---|---|
| 1 | FAIL | 6 Critical, several Major | All six sat underneath five green gates. |
| 2 | FAIL | 5 named (N1–N5) + 2 survivors | Two round-1 mutations survived their own fix. |
| 3 | **PASS** | 2 Majors standing (P1, N6) | 42 mutations chosen by the reviewer, 42 killed. |

The dominant defect class across all three rounds was **declared but never
produced** — three separate instances (nothing wrote `inst_serving.db`; nothing
produced `serving_activity`; nothing called the emitter). Each time a lower layer
was fixed and the layer above was never re-checked. The round-3 pass added the
producer-to-artifact assertions that make that class fail loudly.

## 3. The two Majors standing at round 3, and their resolution

### P1 — a false claim of measurement in a tracked document

`ARCHITECTURE.md:389` published **"Measured 2026-08-05: 184 B/row … on a 1,202-row
projection."** Nothing in the repository produces either number; `grep` over the
whole tree returned only that line and the QA reports. It had replaced an earlier
unbacked `~90 B/row target` — *an unbacked figure swapped for an unbacked figure,
inside a sentence criticising the first for being unbacked.*

The honest handling existed, but only in `DEV-NOTES.md`, which git will never keep.
After commit the repository would have carried the assertion and none of the caveat.

**Resolved:** the row now states that full-scale size is **UNMEASURED**, names the
only real observation (1,365 B/row on a 21-row artifact, where SQLite page overhead
dominates and which therefore does not extrapolate), and **names both dead figures
as unbacked** rather than quietly deleting them. Deleting them would have destroyed
the evidence that this repository twice mistook an estimate for a measurement.

This is the third occurrence of the estimate-as-measurement class in one increment.

### N6 — a comparator that was not antisymmetric

`sortHoldingRows` ended in `return positionIdentity(a) < positionIdentity(b) ? -1 : 1`.
It calls `positionIdentity` **without** a `rowIndex`, so two unkeyable rows of one
period and grain both render `unkeyable:<period>:?|<grain>` — identical strings.
The comparator then answered `1` to both `cmp(a,b)` and `cmp(b,a)`: asserting
*a-after-b* and *b-after-a* simultaneously, leaving the order engine-defined.

`sortHolderRows:522` had the identical defect on `filer_key`. **QA did not name
this one** — it was found by reading the sibling function.

**Resolved:** both comparators now return `0` on equal keys, deferring to
`Array#sort`'s guaranteed stability (ES2019), which preserves the artifact's own
`ORDER BY period, rowid`. The "two builds paginate identically" promise now holds
by construction rather than by luck of the engine's sort.

**A note on how the test was arrived at,** because the first attempt was wrong:

The initial test asserted the property *through* `sortHoldingRows` — and the
mutation **survived**. V8 binary-insertion-sorts short arrays and happened to
preserve input order even with the inconsistent comparator, so a sort-level
assertion is blind to the defect. The comparators were therefore **exported**
(`compareHoldingRows`, `compareHolderRows`) and the invariant is now asserted on
the comparator itself:

```ts
sign(cmp(a, b)) + sign(cmp(b, a)) === 0
```

The sum form is used rather than `sign(cmp(a,b)) === -sign(cmp(b,a))` because
`-Math.sign(0)` is `-0`, which strict equality distinguishes from `0`.

Three tests now pin it, including a pairwise sweep over every ordered pair of a
mixed set (NULL vs disclosed, equal values with different issuers, colliding
identities). **Mutation-verified: 3/3 fail with the defect reintroduced, 3/3 pass
with the fix.**

The general lesson is the one already recorded for this project: *a surviving
mutation means the test asserted an end state, not the property.*

## 4. The file-cap decision (owner, 2026-08-05)

The corrected forward projection is **16,173 files**:

```
12,442 M1 pages + 103 site chrome + 1,500 M2 filer pages
     + 64 activity shards + 2,064 M3 reservation = 16,173
```

Against the original 15,000 self-cap that was a **1,173-file breach**, surfaced to
the owner rather than tuned away. **The owner raised the cap to 18,000**, so the
projection fits with **1,827 of headroom**.

What did *not* change is the arithmetic — the projection was not adjusted by a
single file to reach this outcome. What changed is the budget it is measured
against, which was the owner's to move.

**The cost is explicit and recorded at `GLOBAL_FILE_CAP`:** the buffer against
Cloudflare's hard 20,000 drops from 5,000 files to 2,000, and the self-cap is now
**90%** of the provider limit rather than 75%. The next module that does not fit is
a Pages-tier decision, not another raise. `accept_m2_8.py`'s breach branch says so
in its own output, and `tests/test_inst_shard_budget.py` asserts the 90% ratio so a
further creep toward the provider limit cannot pass unremarked.

## 5. Deferred, and honestly declared: the outsized-position flag (M14)

`src/populus/inst_flags.py` is complete and executed against every row of its
spec's 17-row truth table — and has **no production call site**. No projection
column carries it, no surface renders it, no MCP tool returns it.

The deferral is an owner decision, taken 2026-08-05, and it is defensible on the
spec's own §7 reasoning: the flag is the **only new claim** in a product whose
credibility rests on making none. Everything else on these surfaces *reports* what
a filer filed, and is checkable against EDGAR; the flag would *assert* that a
position is unusual — a statement with no source document behind it, computed from
thresholds (1.5×, 5%, four quarters) that the filings do not supply.

What was not defensible was that nothing said so: R15 read "met" while the product
had no flag, and spec §1.2 plus mutations 8–9 were **vacuously satisfied** because
there is no rendering to test. That is now stated in the module docstring a reader
reaches first, rather than inferred from a grep returning nothing.

## 6. Verification at the point of merge

Every figure below was reproduced on the merge commit's tree, not carried over
from a fixer's report.

| Gate | Result |
|---|---|
| `make check` | 0 |
| pytest | **2296 passed, 8 skipped** (post-merge with P3-3) |
| dashboard `node --test` | **224/224** (221 + 3 new antisymmetry tests) |
| `tsc --noEmit` | clean |
| astro build | 8,170 pages |
| post-build gate | 39/39 (P3-3 added 3) |
| `dep_guard` | OK |
| `accept-m2-5 / m2-6 / m2-8 / m1-b` | all rc=0 |
| measured `dist/` | 12,545 files (cap 18,000, provider 20,000) |

**Lint remains `unavailable`** — undeclared, no tool installed. It has never been
reported as a pass and is not one here.

## 7. Known, open, and not fixed by this increment

- **`accept_m1_b.py` carries `FILE_BUDGET = 8500`**, which disagrees with the
  global cap. Both sides are now named and the conflict is visible in the gate
  output itself, but the two budgets are still two numbers.
- **`build.py:1955-1957` references `run_rollback`, which does not exist.** Named
  by QA round 3 as documentation asserting unimplemented behaviour; pre-existing,
  out of this increment's scope.
- **`inst_serving.db` has never been measured at full scale** — see §3, P1.
- **Deployment now exists — P3-3 landed while this branch was open** (merged as
  PR #9/#10, `origin/main` at `5e2b4d2`). `publish.yml` carries a real deploy leg
  (preview -> verify -> production via `populus.deploy.orchestrator`), OQ-1 is
  decided as **publicfilings.org**, and everything it needs is provisioned:
  `CLOUDFLARE_PAGES_EDIT_TOKEN`, `DATA_REPO_PAT`, `CLOUDFLARE_ACCOUNT_ID`,
  `CLOUDFLARE_PAGES_PROJECT`, and both `POPULUS_PUBLISH_ARMED` and
  `POPULUS_RECORD_SIGN_ARMED` set to `true`.

  The last dispatch (run `31119399761`, 2026-08-06 16:19 UTC) **failed on GitHub
  infrastructure, not on this code**: the publish job recorded zero steps, waited
  ~15 minutes and was cancelled with *"The job was not acquired by Runner of type
  hosted."* The repository is public, so Actions minutes are not the cause. A
  re-run is the remedy, and it must happen AFTER this branch merges — a re-run
  today would deploy a `main` that does not yet contain these surfaces.

### Integration with P3-3

This branch was cut before P3-3 and merged `origin/main` at `ec90bb4`. One real
conflict, in `publish/build.py`: P3-3 moved manifest assembly out of `stage_build`
into a new `_seal_build(state, provisional=...)` that runs **twice** — provisionally
so the site build can read `manifest.modules`, then finally once the served file
count is known.

Main's `_seal_build` carried the **pre-M2-8** single-artifact form
(`"artifacts": [inst_entry.to_dict()]`). Taking either side wholesale would have
silently stopped publishing `inst_serving.db` — the same *declared but never
produced* class that dominated all three QA rounds. The M2-8 enumeration was
therefore ported into `_seal_build`, with `inst_serving_path` and
`inst_serving_logical` threaded through the `state` dict, so **both** passes
enumerate the serving artifact.

`test_the_real_build_routes_through_the_completeness_control` broke on this: it
asserted `require_complete_inst_module(` appeared in `inspect.getsource(run_build)`,
and the refactor moved the call out of that function. The property still held, so
the test was not relaxed to whichever function holds the call today — it now walks
the **actual call graph** from `run_build` and requires the control to be reachable,
with a non-vacuity assertion that the walk really traverses the P3-3 seam. A future
refactor may move the control again; it may not drop it. Mutation-verified: deleting
the call fails the test.

The 18,000 file cap and P3-3's deploy path do not interact — `site_file_count` is a
stats value and the deploy inventory counts independently; the cap is enforced only
by the post-build gate and `check_measured_tree`.
