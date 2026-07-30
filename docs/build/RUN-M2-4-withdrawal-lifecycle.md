# Module serving lifecycle — explicit specification

**Status:** revision 7 — **APPROVED** by external design review
("faithfully expresses the endorsed symmetric tuple-first design… I would now
implement this specification as written").

Written after seven QA rounds patched this behaviour into existence without a
specification and an eighth returned four blockers, all inside one inference
function. Six review rounds refined it:

| Rev | Found | Closed by |
|---|---|---|
| 1 | tuple-write failure re-created the exposure; the sidecar certified itself; test list would pass a version-only check | rev 2 |
| 2 | unserialized writers could roll the anchor backward; write-failure table wrong; resolver partition forbade correct restoration | rev 3 |
| 3 | monotonicity "defence" was TOCTOU and version-only; resolver partition contradicted its own healing rule; heal/lock rows missing | rev 4 |
| 4 | record-first withdrawal let a replayed pre-withdrawal pointer heal backwards; lock contract unimplementable against the sole-oracle rule | rev 5 |
| 5 | document still normatively said record-first in its rationale and crash matrix (an editing failure, not a design one) | rev 6 |
| 6 | two wording nits, non-blocking | rev 7 |

**Scope:** `SnapshotClient` per-module serving state — what the client may serve
for a module, and how that changes across refresh, crash and I/O failure. It
consumes the pointer/manifest verification protocol unchanged — normatively
ARCHITECTURE §5.5, implemented by the RUN-5 client work whose crash-consistency
requirement (R24) is recorded in `snapshot.py`'s own module docstring — and does
not widen the trust anchor. (M2-3's plan ends at R13 and does not define these;
revision 2 mis-cited them.)

---

## 1. The invariant

> **A module is served ONLY while the client can positively prove, from durable
> state, that the current trust-anchored pointer publishes it.**
> Absence of proof is absence of service.

This inverts rounds 1–8, which asked *"is something suppressing this module?"*
and served whenever the answer was no — making **serving** the default for every
unenumerated state, I/O failure and corrupt file. Round 8 found that default
reached through four different doors.

A false absent costs a tool answering "the institutional module is not
available". A false present serves coverage-gate-withheld data labelled as
published. The asymmetry is the whole reason for the inversion.

## 2. Durable state

Three files under `<cache>/<module>/`, plus the verified build directories.

| File | Role | Trust |
|---|---|---|
| `trust.json` | `(pointer_version, pointer_sha256)` — the replay/equivocation anchor | **Authoritative.** Exactly two fields — `load_tuple()` rejects any other key set and §5.5 fixes the anchor's width — so the serving record lives beside it, not inside it. |
| `serving.json` | the **single serving record** (§3) | **Authoritative once validated against `trust.json`.** Written atomically; one write per transition. |
| `<build_id>/` | verified artifacts + `manifest.json` | **Authoritative** once `_build_complete(build_id, manifest_sha256)` passes. |
| `current` | *(removed)* | — |

**Removed: `withdrawn.json` (the tombstone) and `install.json` (the sidecar).**
Every round-5..8 finding was about cross-file inference between advisory
markers — the tombstone's write failing, its `withheld_build` being `None`, its
parse failing, its retirement being under-proven, and the sidecar being believed
without its cross-check. One validated record removes the inference entirely.
`current` is removed rather than demoted: revision 1 called it a "crash-recovery
hint" while no recovery path consulted it (review F4), which is just dead state
that invites future misuse.

## 3. The serving record

`serving.json` is written atomically and contains:

```json
{
  "pointer_version": 7,
  "pointer_sha256":  "<digest of pointer_bytes>",
  "pointer_bytes":   "<the exact verified latest.json bytes, base64>",
  "installed_build": "20260725.1"      // or null when the module is not served
}
```

`serving_build()` — a pure function, the ONLY way serving is decided:

```
serving_build():
    trust = load_tuple()                             # (version, sha) or None
    if trust is None:                    return None # nothing established
    rec = read_serving_record()                      # None if absent/corrupt
    if rec is None:                      return None # ← fail closed (rev-1 F5/F4)
    if rec.pointer_version != trust.version:  return None
    if rec.pointer_sha256  != trust.sha:      return None
    if sha256(rec.pointer_bytes) != trust.sha: return None   # bytes bound to anchor
    pointer = parse(rec.pointer_bytes)               # AUTHENTICATED source
    if rec.installed_build is None:      return None # withdrawn
    if rec.installed_build != pointer.build_id:      return None
    if not build_complete(pointer.build_id, pointer.manifest_sha256): return None
    return pointer.build_id
```

**Why `pointer_bytes` (closes rev-1 F2).** Revision 1 took `build_id` and
`manifest_sha256` from the advisory sidecar, so the sidecar certified itself: a
valid-shaped corrupt record could copy the tuple fields and name a *different*
complete cached build, and the "positive proof" proved nothing. Here those two
values are parsed out of bytes whose digest must equal the trust anchor, so they
are derived from the authenticated pointer. `installed_build` is then only a
cross-check, never a source of authority.

## 4. Transitions

Each transition is **two ordered atomic writes**, arranged so that the window
between them evaluates to *absent* under §3. **The tuple write — write 1 in
both directions — is the commit.**

| Outcome | Precondition | Write 1 (**the commit**) | Write 2 |
|---|---|---|---|
| `installed` | verified pointer + manifest include this module; artifacts fetched and verified into `<build_id>/` | `trust.json` ← new tuple | `serving.json` ← `{new pointer, installed_build=build_id}` |
| `withdrawn` | verified manifest **omits** this module | `trust.json` ← new tuple | `serving.json` ← `{new pointer, installed_build=null}` |
| `idempotent` | pointer digest equals the anchor | — | if `serving_build()` is None: write the record the anchored pointer implies — a completing record when it publishes the module and its build verifies, a **null** record when it omits the module |
| `incompatible` | manifest present, `client_compat` excludes us | — | — |
| `refused` | any verification/fetch failure | — | — |

### 4.1 Serialization and monotonicity (closes rev-2 F1)

Per-file atomic writes do NOT make a two-file transition atomic against another
writer. Two clients on one cache — an MCP server polling while a CLI refreshes —
can interleave so that a *stale install* completes after a *newer withdrawal*
commits, overwriting both files with an older mutually-consistent generation:
the anchor rolls backward and the withheld build serves again.

**Mutual exclusion is the only mechanism that closes it**, and its scope is
therefore stated rather than assumed:

1. **An exclusive per-module lock** (`<cache>/<module>/.lock`, `flock`) held
   across the whole read-modify-write: trust load, pointer evaluation, both
   transition writes, and any idempotent heal. A refresh that cannot take the
   lock returns `refused` — it never proceeds unserialized. The lock is released
   on every exit path, including every exception.
2. **Declared scope: a local POSIX filesystem**, where `flock` is reliable. The
   cache is a per-user local directory, so this is the real deployment.

Two lock failures, deliberately distinguished (rev-4 F2 — revision 4 conflated
them and became unimplementable, demanding absence while `serving_build()`, the
sole oracle, would still prove a valid build):

- **Contention** (another writer holds the lock) is *transient* and says nothing
  about the validity of what is already proven. `refresh()` returns `refused`
  and **the module keeps serving whatever `serving_build()` still proves** —
  which is exactly §1: positive proof exists. No second oracle is introduced,
  and no transition proceeds unserialized.
- **An unsupported lock facility** (`flock` unavailable on the cache
  filesystem) is *persistent*: no transition can ever be made safely, so the
  module is **disabled** — decided at client construction, BEFORE any cache
  state is consulted, and reported absent with that reason. That is a
  configuration outcome, not a serving decision, so §6's sole-oracle rule is
  untouched.

**Revision 3's "monotonicity as lock-loss defence in depth" is withdrawn as
unsound** (rev-3 F1). Re-reading `trust.json` and then writing is not atomic: a
stale writer can pass the re-read, pause while a newer transition commits, and
overwrite afterwards. It also compared only `pointer_version`, so an
equal-version/different-digest equivocation is not "older" and passes. A check
that fails exactly when it is needed is worse than none, because it invites
reliance. Closing this properly without a reliable lock needs a fenced or
compare-and-swap commit over the full tuple, which is out of scope here; the
honest position is the declared scope above.

**Full-tuple validity (retained, for a different reason).** A serving record is
valid only when BOTH `pointer_version` and `pointer_sha256` equal the anchor
(§3). This rejects equal-version/different-digest equivocation on the read path,
independent of concurrency — it is an anti-equivocation rule, and is explicitly
**not** offered as a substitute for mutual exclusion.

`serving_build()` is a pure read and needs no lock: every state it can observe
mid-transition evaluates to absent (§5), which is the safe direction.

**Ordering rationale.** Revision 1 advanced the tuple first in *both* directions
but made the SIDECAR the proof, so a failed tuple write left old-tuple +
old-sidecar mutually consistent and the module kept serving (rev-1 F1). That was
a defect of the *proof model*, not of the order — and it is already fixed by §3,
where the record must match the anchor to prove anything.

Revision 4 nevertheless "fixed" it by flipping withdrawal to write its null
record before its tuple. That reopened the hazard from the other side (rev-4 F1): with the record written and the tuple write failed, **a
replay of the pre-withdrawal pointer still equalled the old anchor**, so the
idempotent heal fired and overwrote the null record, restoring the withheld
build. Being absent under `serving_build()` is not enough if `refresh()` will
then repair the mismatch in the wrong direction.

**The anchor is therefore written FIRST in both directions**, and one argument
covers both:

- **The tuple write IS the commit.** Once it lands, the old record mismatches the
  new anchor and the module is immediately absent (§3) — that alone completes a
  withdrawal, and the null record only tidies. A replay of any pre-commit
  pointer is now a rollback against the advanced anchor and is **refused**, so
  no heal can fire backwards over a commit.
- **If write 1 (the tuple) fails, nothing changed.** The transition did not
  commit, prior state stands, the next refresh retries. This is the honest
  acceptance point, stated rather than assumed.
- **If write 2 (the record) fails**, the anchor is ahead of the record →
  mismatch → absent, and the heal at the anchored pointer completes it in
  whichever direction that pointer implies (a completing record when it
  publishes the module, a null record when it omits it).

There is no ordering in which a single failed write both commits and mis-serves,
and no surviving pre-commit pointer that can heal backwards over a commit.

`verified_omission: bool` stays on `RefreshResult` as a **reporting** signal for
health messages. It is never consulted for serving (§1 governs that). On an
`idempotent` poll of an unchanged withdrawing pointer it MUST be reconstructed —
`serving.json` records `installed_build=null` for a pointer whose manifest omits
the module, which is exactly the fact — so an offline restart reports the gate
withholding rather than degrading to a neutral reason (closes rev-1 F6).

## 5. Crash boundaries

| Crash point | Durable state | `serving_build()` | Recovery |
|---|---|---|---|
| install: after artifacts, before tuple | old tuple, old record (consistent) | old build | next refresh installs |
| install: after tuple, before record | new tuple, **stale** record | `None` | `idempotent` heal writes the record |
| install: after record | new tuple + matching record | new build | — |
| withdrawal: after tuple, before record | tuple at vN, **stale** record at vN-1 | `None` | heal writes the null record; a replay of vN-1 is refused as a rollback |
| withdrawal: after record | consistent, `installed_build=null` | `None` | — |
| **install write 1 fails** (tuple) | unchanged: old tuple + old record | old build | next refresh retries the install |
| **install write 2 fails** (record) | new tuple + **stale** record | `None` | `idempotent` heal completes the record |
| **withdrawal write 1 fails** (tuple) | unchanged: old tuple + old record | old build — the withdrawal did NOT commit | next refresh re-runs withdrawal |
| **withdrawal write 2 fails** (record) | new tuple + **stale** record | `None` | heal writes the null record; pre-commit replays are refused |
| **idempotent heal write fails** (the one-write transition) | unchanged: whatever was there | `None` | `refresh()` returns `refused`; the error never escapes |
| lock CONTENDED (transient) | unchanged by the contender: no write attempted | exactly whatever `serving_build()` proves — which may be `None` if the lock HOLDER is mid-transition | `refresh()` returns `refused`; §4.1 governs (rev-5 F2) |
| `flock` UNSUPPORTED (persistent) | not consulted | module disabled at construction | reported absent with that reason (§4.1) |
| `trust.json` or `serving.json` corrupt/unreadable | unparseable | `None` | next refresh re-establishes the tuple/record state implied by the authenticated pointer — which may be a null withdrawal record, not necessarily an install (rev-6 F2) |

Revision 2 collapsed the four write-failure cases into one row asserting "state
unchanged", which is false for a write-2 failure: those windows leave a
deliberate mismatched partial state that evaluates absent, and they are exactly
the load-bearing ones. Each is now separate and separately testable (rev-2 F2).

Corruption of an *artifact* or `manifest.json` is caught by `_build_complete` →
`None`. No other file participates in the decision, so no other corruption has a
serving effect (closes rev-1 F5, which flagged that revision 1's blanket "any
corrupt file" row contradicted its own treatment of `current`).

## 6. What the implementation must not do

- Decide serving from anything other than `serving_build()`.
- Take `build_id` or `manifest_sha256` from any source other than pointer bytes
  whose digest equals the trust anchor.
- Treat an unreadable or corrupt record as "no restriction".
- Let a cleanup or write `OSError` escape `reconcile()` or `refresh()` —
  `refresh()` runs on every poll, so an escaping error takes down every module
  rather than one (round-6 F1).
- Reintroduce inference *between* files (generation arithmetic, presence
  comparisons, "newer than" checks across advisory records). Every such rule in
  rounds 5–8 became a finding.

## 7. Tests this specification requires

**Anti-replay negative controls (each must yield absent — closes rev-1 F3).**
A generic "corrupt record" case is insufficient: it would pass an implementation
that checks only `pointer_version`, which is precisely the round-8 F3 defect.
Required, each valid-shaped and differing in exactly one respect:
1. `pointer_version` equal, `pointer_sha256` different
2. `pointer_version` different, `pointer_sha256` equal
3. both tuple fields equal, `pointer_bytes` hashing to something else
4. tuple + bytes consistent, `installed_build` naming a *different* complete build
5. tuple + bytes consistent, named build's artifacts missing or corrupt
6. record absent; record unparseable; record valid-shaped with wrong types

**Lifecycle.** Each row of §5; withdraw → offline restart → absent; withdraw →
replay of the pre-withdrawal pointer → absent; withdraw → newer build
republishes → served; authorized higher-version rollback to the withdrawn build
→ served; install → withdraw → install → withdraw (repeat polls stable, no
oscillation).

**Two distinct expectation sets (rev-3 F2).** Revision 3 conflated them and was
internally unsatisfiable: it demanded absence for every negative control *and*
required the install write-2 state to heal and serve. `serving_build()` is
evaluated on durable state as found; `_resolve_snapshot()` runs a `refresh()`
first, which may legitimately heal. They are tested separately.

*(a) Pre-refresh — `serving_build()` on the state as found.* Every anti-replay
negative control, both write-2 partial states, the corrupt/absent record, and a
withdrawn record MUST return `None`. No exceptions: this is the pure invariant.

*(b) Post-refresh — `_resolve_snapshot()` after an authenticated poll.*
- *Must serve* (`inst_db_path` is the expected build's path,
  `inst_from_published_manifest is True`): first install; newer republication
  after a withdrawal; authorized higher-version rollback to the withdrawn build;
  **install write-2 partial state healed at an equal authenticated pointer**;
  and any malformed-record case where the equal authenticated pointer publishes
  the module and its build verifies — healing is correct there, and the test
  must not forbid it.
- *Must remain absent* (`inst_db_path is None`,
  `inst_from_published_manifest is False`): the verified withdrawal;
  withdrawal write-2 partial state; replay of the pre-withdrawal pointer; any
  case where the named build's artifacts are missing or corrupt; and an
  unsupported `flock`. **Lock contention is NOT in this group** — it must keep
  serving a build that is still proven.

**Congress must stay available in both groups** — a MODULE-level failure must
never take down the server. This is scoped deliberately (QA-NIT-4): an
unsupported `flock` is a CACHE-level failure — no module can be transitioned
safely, congress included — so the server refuses to start with a message naming
that cause. Module-level failures (a withheld inst module, a corrupt inst
artifact, an unremovable inst temp directory, an inst I/O error) must resolve to
an honest absence for that module with congress unaffected. §8's "Also changed"
note records the cache-level exception; this sentence previously read as an
absolute and contradicted it.

**Serialization tests (rev-3 F3, rev-4 F1/F2).** Lock contention returns
`refused` with NO durable write and serving stays exactly whatever
`serving_build()` proves (the test seeds a stable proven build, since a holder
mid-transition may legitimately prove `None` — rev-6 F1); an unsupported
`flock` disables the module before cache state is read; **the withdrawal write-2
partial state followed by a replay of the pre-withdrawal pointer stays absent**
(the exact path that resurrected withheld data); the lock is released on every
exceptional exit path (assert a subsequent refresh can take it after an injected
mid-transition exception);
opposite transitions (install vs withdrawal) serialize rather than interleave;
and a deliberately stale writer resumed after a newer commit cannot regress the
anchor — under the declared scope of §4.1, with the fail-closed path asserted
when the lock is unavailable.

**Reporting.** `verified_omission` is reconstructed on an idempotent poll after
an offline restart, and the health caveat still names the coverage gate.


---

## 8. Implementation notes (recorded 2026-07-25, after building against this spec)

Two places where the implementation refines what §§4–7 said. Both were found by
building and testing, and both are deliberate:

1. **The idempotent heal reuses `_install` rather than a separate path.** §4
   describes the heal as "write the record the anchored pointer implies". A
   dedicated `_heal_at` was written first and was WRONG: it read the manifest
   from the module's own cache directory, which a *withdrawn* module does not
   have, so it silently failed to reconstruct the verified-omission fact.
   `_install` already fetches and verifies the manifest, writes the withdrawal
   when the module is omitted, and short-circuits the artifact fetch when the
   build is complete — so the heal calls it. One verified path, not two that can
   disagree.

2. **Corrupt artifacts: absent pre-refresh, re-verified online post-refresh.**
   §7(b) lists "artifacts missing or corrupt" under *must remain absent*. That is
   right pre-refresh and when offline, but online the build is re-fetched and
   re-verified against the manifest digest, so serving it again is safe and
   permanent absence would be the worse outcome — self-healing is the point of a
   content-addressed cache. Both halves are pinned by tests
   (`test_corrupt_artifacts_are_absent_pre_refresh_and_re_verified_online`,
   `test_corrupt_artifacts_stay_absent_when_they_cannot_be_re_fetched`) so the
   distinction is explicit rather than accidental.

**Also changed:** an unsupported `flock` is a CACHE-level failure — no module can
be transitioned safely — so `_resolve_snapshot` now exits with a message naming
that cause instead of the generic "no current snapshot" advice, which would send
an operator chasing a publish problem they do not have.

3. **A corrupt trust anchor now REFUSES instead of re-bootstrapping** — a change
   to the pre-existing TD-7 "corrupt tuple is state loss" decision, and
   owner-visible. `_load_trust` swallowed `TrustTupleError` and returned `None`,
   which `evaluate_pointer` reads as bootstrap, so any unexpired attested
   pointer was accepted — including one older than a committed withdrawal, which
   re-installed the coverage-gate-withheld build and had the resolver stamp it
   `inst_from_published_manifest=True` with the ≥95% guarantee. `serving_build()`
   fails closed on that same file, so the client was reading one anchor two
   contradictory ways, fail-open on the write path. Under §1 a corrupt anchor is
   absence of proof, so it is now `refused` with an actionable message (clear the
   module cache). The cost: a corrupt anchor no longer self-heals. An ABSENT
   anchor is still genuine bootstrap — only the corrupt case changed.

4. **An uncommitted withdrawal is signalled rather than silent.** When a verified
   manifest omits the module but the anchor write fails, §4/§5 correctly keep the
   prior build serving (nothing committed). Those bytes did pass the gate when
   published, but reporting them as clean published data with no signal would
   hide that the current build no longer publishes the module — so the refresh
   result carries `observed_omission` and the resolver surfaces
   `inst_stale_withdrawal_pending`.
