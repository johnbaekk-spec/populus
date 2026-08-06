# qa-report-v1: RUN M2-8 — T7–T16, QA ROUND 2 (re-verification of the remediation)

**Transport:** `interactive-disk`. **Worktree:** `/Users/johnbaek/projects/Populus-m28`,
branch `feat/run-m2-8-surfaces` off `7ab75ec`. **Source-read-only:** no source file was
modified by this pass. Mutation testing applied and reverted each mutation under a
`finally` with a per-file SHA-256 restore assertion; the whole-tree fingerprint before and
after the mutation set is identical —
`3f08cd2440c4d01e71230180874bac6a1e16b70fd5313c467bf1a397217a2b4f` — and `git status` still
reports 21 modified / 17 created.

**Scope of this round.** `QA-REPORT.md` (round 1) raised 6 Critical + 16 Major. A
remediation agent claimed 6/6 Criticals and 15/16 Majors fixed. **Nothing in that claim was
taken on trust.** Every finding below was re-verified by execution — real builds, real
artifacts, real consumers, and an independent mutation set — not by reading the diff.

## Detected Stack

Detected fresh, not cached. Python 3.12 via `uv` (frozen lockfile, 44 packages), `pytest`,
`click`, SQLite + JSON1; HTTP only through `SecClient`. Dashboard: Astro (`output:
"static"`), Node 24 with native TS stripping, `node:sqlite` `DatabaseSync`, **`node --test`**
(not Vitest). Repository-owned gate entrypoints (`Makefile`): `make check` = `make test`
(`test-python` → `uv sync --frozen` + `uv run pytest -q`; `dashboard-gates` → `npm ci` +
`npm run gates` = `check && test && build && test:post`) + `make security`
(`scripts/dep_guard.py`). Acceptance targets: `accept-m1-b`, `accept-m2-5`, `accept-m2-6`,
`accept-m2-8`.

## Summary

**The remediation is substantially real, and the round-1 Criticals are genuinely fixed.** I
say that plainly because I set out to break it and mostly could not. C2 — the defect that
appeared three times in this increment — now closes end to end: a real `run_build` emits
`inst_serving.db`, the manifest enumerates it with a `logical_digest` that recomputes
exactly, `run_verify` passes, and the **real MCP consumer reads real rows out of the real
producer's own bytes**. C4's override of the prescribed fix is **correct**, and I can prove
the prescribed fix would have broken the plan's own exit case (b). C5's caps were not
relaxed and the breach is surfaced loudly rather than tuned away. Every gate claim in the
Dev Notes reproduces to the number.

Four things block the increment.

1. **Two mutations SURVIVED** on the two most safety-critical paths named in the plan —
   exit classification and NULL-honesty — with 263 tests *and* `accept-m2-8` green.
2. **C5 is still wrong in the unsafe direction, by the same mechanism as before.** The
   remediation created `SITE_CHROME_FILES = 103` to name the file class its own analysis
   said "appeared in no term at all", then never referenced it. The projection under-reports
   the breach by exactly those 103 files.
3. **A new Major regression the remediation introduced and did not test:** every holding on
   the live federated plane now ships `accession: null`, and the docstring justifying that
   is factually contradicted by the code one module away.
4. **`DEV-NOTES.md` is inaccurate again** — not affirmatively false as in round 1, but its
   headline measurement and its changed-file list both disagree with `git`.

## Requirement Coverage

| Round-1 ID | Claim | Verdict | Proof |
|---|---|---|---|
| **C1** digest deadlock | FIXED | **VERIFIED-FIXED** | Published artifact digests `8e272d2a32dc…`; independent recompute matches; `run_verify.ok = True`. Mutations removing the `serving_activity` and `serving_filer_rows` primary keys are both **KILLED** (83 failures each). |
| **C2** no producer | FIXED | **VERIFIED-FIXED end to end** | See below. Producer→manifest→verify→**consumer** closed by execution. Mutations deleting the `write_serving_db` call (82 fail), the manifest entry (10 fail) and the R10 control (1 fail) all **KILLED**. |
| **C3** issuer_key namespace | FIXED | **VERIFIED-FIXED** | Producer-built artifact: `serving_activity.issuer_key` = `serving_issuer_holder_rows.issuer_key` = `{cusip6:…, entity:cik:…}`. Round-1 intersection was empty; it is now complete. Mutation reverting to `f"cusip:{cusip}"` **KILLED** by both the unit suite and `accept-m2-8` (`unjoinable: ['cusip:037833100', 'cusip:594918104']`). |
| **C4** false exit | FIXED (fixer **overrode** the prescribed fix) | **VERIFIED-FIXED; the override is CORRECT** — see the judgment below | 5 of 6 exit mutations **KILLED**; **1 SURVIVED** (N2). |
| **C5** budget proof | "FIXED, with a finding surfaced" | **PARTIALLY FIXED** — caps intact, breach surfaced, but still under-reported by 103 (N1) | Independently measured `dist/` = **12,545 files**, largest `congress/data/feed.v1.json` = **11,962,205 B** — both exactly as claimed. |
| **C6** NULL position_key | FIXED | **VERIFIED-FIXED** for the fabricated-total defect | 3 unkeyable rows across 3 issuers fold to **3** rows with correct values (round 1: 1 row, `$750`, `+700`). Mutation removing the unkeyable branch **KILLED**. New adjacent defect at N6. |
| **M2** write freshness | FIXED | **VERIFIED-FIXED** | Three consecutive writes to one path: `{activity 4, filer_rows 7, filings 5, issuer_holder 7}` on all three (round 1: 1→2→3). Aliased destination **refused** with `InstAggError`. |
| **M3** tautologies | FIXED | **VERIFIED-FIXED** | `wanted = _loader_selected_columns(text, "ACTIVITY_TABLE")` — extracted from the loader, not built over the producer's columns, behind a `bool(wanted)` non-vacuity guard. `accept-m2-8`: "the loader's SELECT list was read: 20 columns". |
| **M4** self-fulfilling data_note | FIXED | **VERIFIED-FIXED, and stronger than claimed** | Deleting `HoldingsTable.astro:265` is **KILLED** by the post-build gate (`institutional/filers/1067983/index.html does not render the §5 data_note at all`) **and** by the unit suite. The Dev Notes' "leaves all 91 unit tests GREEN" is now itself out of date — the added template-half regex catches it. |
| **M5** ban list | FIXED | **VERIFIED-FIXED** | 10 → **16** patterns, derived per-token from the spec. All five round-1 escapes now caught. Deleting `backs`, `likes` or `bullish` individually is **KILLED**. Residual inflection gap at N8. |
| **M6** three §5 texts | FIXED | **VERIFIED-FIXED** | `ui.ts` third phrasing replaced by a link to `#inst-data-note`; the anchor is emitted unconditionally. |
| **M9** unreachable rows | FIXED | **VERIFIED-FIXED** | Drove the cursor at `limit=1`: page 1 `truncated=True` + `next_cursor`, page 2 completes; 2/2 rows reached; `COMPLETE LIST REACHABLE: True`. |
| **M10** hand-copied schema | FIXED | **VERIFIED-FIXED** | `tests/test_inst_federated_boundary.py:93` is `_SCHEMA = SERVING_SCHEMA` — the producer's own constant, imported. |
| **M11** activity untested | FIXED | **VERIFIED-FIXED** | Plan's three exit fixtures exist; `accept-m2-8` reports "the activity grain produced 2 row(s) over 2 periods — the R13 path is EXERCISED, not schema-only". Residual gaps at N2/N3/N12. |
| **M12** R10 deviation | FIXED | **VERIFIED-FIXED** | `require_complete_inst_module` exists, is called at `build.py:1952` (the literal appears **twice** in the file — the def and the real call, no comment copy), and deleting the call is **KILLED**. |
| **M14** flag unwired | DEFERRED, declared | **VERIFIED as declared** | `classify_position` still has **0** production call sites (confirmed independently). `src/populus/inst_flags.py:38` declares the deferral and names spec §1.2 and mutations 8–9 as vacuous. Honest. |
| **M15** false Dev Notes | FIXED | **PARTIALLY FIXED** — see N5 | The affirmatively-false claim is gone; the replacement numbers are stale. |
| **M16** spec self-contradiction | FIXED | **VERIFIED-FIXED** | `M2-8-outsized-position-spec.md:187-188` — mutation 6 struck through, `**RETRACTED 2026-08-05 (QA M2-8 M16).**`, replaced by a valid alternative at `:198`. |

M1, M7, M8, M13 were spot-checked (exit rows carry issuer names per `accept-m2-8`; `format.ts`
holds the converged primitives; `capRows` returns a `boundBy` discriminant; the
`unresolvedUndisclosed` counter is rendered) but were **not** driven to a mutation. They are
recorded as unverified-by-execution rather than confirmed.

### C2 — proven end to end, the way no test in the repo does it

The claim deserved the hardest attack because the defect recurred three times. Result:

```
BUILD_ID: 20260723.1
inst module artifacts in the manifest:
  name='inst_agg.db'      bytes=53248  logical_digest='155250ca2757f179…'
  name='inst_serving.db'  bytes=28672  logical_digest='8e272d2a32dc42e7…'
release assets: congress.db  inst_agg.db  inst_serving.db  journal.json
run_verify.ok = True   errors = ()
manifest logical_digest == independently recomputed digest:  True
```

`inst_serving.db` is produced, released, enumerated, digested and verified by a real
`run_build`/`run_publish`. I then went one layer further than any test in the repo does —
**the repository's own boundary suite hand-writes its serving rows** (`write_serving_db(path)`
at `tests/test_inst_federated_boundary.py:121`), so producer→consumer is closed nowhere. I
drove the **real producer** over the real M2-4 corpus and pointed the **real MCP consumer**
at its output:

```
producer-built artifact: serving_activity 4 | serving_filer_rows 7 | serving_filings 5 | serving_issuer_holder_rows 7
activity change_kind histogram: [('add', 2), ('exit', 1), ('new', 1)]
consumer: served_from = published-serving-projection
          federated_boundary.route = published / in_published_universe
          HOLDINGS ROWS = 2   issuer names = ['APPLE INC', 'NVIDIA CORP']
inst_health.per_filer_detail = {"published": true, "artifact": "inst_serving.db", ...}
```

The ATTACH mechanism was checked directly rather than inferred, because zero activity rows
makes success and the fail-open `return None` indistinguishable from the artifact alone.
Instrumenting `_qoq_deltas_table` inside a real build:

```
attached schemas: ['main', 'temp', 'inst_agg']
resolved to     : "inst_agg".agg_qoq_deltas
```

The ATTACH resolves, `DETACH` is unconditional in a `finally`, and `congress.db` is hashed
after `snapshot.close()`. **C2 holds.** One coverage gap remains (N12).

### C4 — judging the override against the plan's own text

The fixer overrode QA r1's prescribed fix (`base = is_amendment = 0`), arguing it would
break plan exit case (b). **That reasoning is correct, and I can measure it.**
`v_filer_reported_filings` **already applies restatement resolution** — in case (b) the base
`13F-HR` is suppressed and never reaches the predicate:

```
### (b) base + RESTATEMENT + later NEW_HOLDINGS
  rows SURVIVING in v_filer_reported_filings: 2
    13F-HR/A  is_amendment=1 amendment_type=NEW_HOLDINGS  -> full_report=False
    13F-HR/A  is_amendment=1 amendment_type=RESTATEMENT   -> full_report=True
  full-report count (SHIPPED rule)   = 1     AUTHORITATIVE = True
  base count (QA r1 PRESCRIBED rule) = 0  -> would have been NOT authoritative
```

Plan `RUN-M2-8-plan.md:753-755` requires case (b) to be a **legitimate exit**; the
prescribed rule yields zero bases and would have refused it. Plan §B (`:340`) says "exactly
one surviving base 13F-HR for the (cik, period) **after restatement resolution**" — the view
performs the resolution, and after it the restatement *is* the period's full report. The
shipped `_is_full_holdings_report` implements exactly that sentence.

**It did not silently widen authority.** Adversarial probes:

| case | full reports | authoritative | correct? |
|---|---|---|---|
| (a) base + NEW_HOLDINGS | 1 | yes | yes |
| (b) base + RESTATEMENT + later NEW_HOLDINGS | 1 | yes | yes, per plan |
| (c) NEW_HOLDINGS only | 0 | **no** | yes — the forbidden false exit is refused |
| NULL `amendment_type` amendment only | 0 | **no** | yes — the measured round-1 defect |
| base + unclassifiable amendment | — | **no** | yes — known-type guard fires |
| base + RESTATEMENT filed **earlier** than the base | 2 | **no** | yes — fail-closed on ambiguity |

This is **not** a false-exit defect. It is the plan implemented correctly.

## Gate Evidence

Full-tree canonical commands, run from the repository's own entrypoints. Every Dev Notes
gate claim reproduces exactly.

| Gate | Command | Source | Scope | Exit | Duration | Required | Status |
|---|---|---|---|---|---|---|---|
| test + security | `make check` | Makefile:117 | full tree, both toolchains | **0** | 562 s | required | **pass** |
| — python | `uv sync --frozen` + `uv run pytest -q` | Makefile:43-44 | full tree | 0 | 252 s | required | **pass** — `1916 passed, 8 skipped` |
| — dashboard unit | `npm ci` + `npm test` | package.json:15 | `test/*.test.ts` | 0 | — | required | **pass** — `tests 221 / pass 221 / fail 0` |
| — dashboard build | `astro build` | package.json:12 | full site | 0 | 100 s | required | **pass** — 8,170 pages |
| — post-build | `npm run test:post` | package.json:16 | `test/post/*.test.ts` | 0 | 202 s | required | **pass** — `tests 35 / pass 35 / fail 0` |
| security | `uv run python scripts/dep_guard.py` | Makefile:59 | pyproject + lockfile + import roots | 0 | — | required | **pass** — `dep_guard: OK` |
| typecheck | `astro check` (inside `npm run gates`) | package.json:14 | dashboard | 0 | — | required | **pass** |
| lint | — | not declared | — | — | — | optional | **unavailable** (no lint entrypoint declared; not reported as pass) |
| acceptance | `make accept-m1-b` | Makefile:114 | hermetic M1 chain | **0** | 1 s | required | **pass** |
| acceptance | `make accept-m2-5` | Makefile:65 | full 13(f) list + Berkshire corpus | **0** | 231 s | required | **pass** |
| acceptance | `make accept-m2-6` | Makefile:78 | hermetic seam chain | **0** | 1 s | required | **pass** |
| acceptance | `make accept-m2-8` | Makefile:96 | projection → artifact → digest → seam → activity → budget | **0** | <1 s | required | **pass** |

`accept-m2-8` confirms the C5 posture independently, and does so loudly:

```
ok  MEASURED dist/: 12,545 files (cap 15,000, provider 20,000); largest congress/data/feed.v1.json at 11,962,205 B
ok  a tree one file over the cap is REFUSED — the gate can fail
ok  geometry one over its maximum is REFUSED — the gate can fail
ok  RESERVATION BREACH (owner decision required): the corrected forward projection is 16,070
    against a 15,000 self-cap — 1,070 over. … It must NOT be re-tuned away here.
```

**No cap or reservation was relaxed.** `GLOBAL_FILE_CAP = 15_000`, `PROVIDER_FILE_LIMIT =
20_000` and `MAX_SHARD_BYTES = 25 MiB` are asserted equal to their literals by
`dashboard/test/post/file-budget.test.ts:86-88`, the enforcing gate counts a real tree, and
both gates are driven past their limits to prove they can fail.

### Independent mutation set

Applied by QA, not by the author. Each mutation reverted with a hash-checked restore.
(The first harness run piped `pytest` into `tail`, masking exit codes; every ambiguous case
was re-run with `set -o pipefail` and is reported from that run.)

| # | Mutation | Path | Result |
|---|---|---|---|
| 1 | `None` back into `KNOWN_AMENDMENT_TYPES` | exit | **KILLED** |
| 2 | every filing counts as a full report | exit | **KILLED** (3 fail) |
| 3 | a surviving RESTATEMENT stops counting | exit | **KILLED** (case b) |
| 4 | drop the `exit_not_assertable` degradation | exit | **KILLED** |
| 5 | remove the `parse_status` guard | exit | **KILLED** |
| 6 | **`!= 1` → `< 1`** ("exactly one" → "at least one") | exit | **SURVIVED** → N2 |
| 7 | `serving_activity` loses its primary key | digest | **KILLED** (83 fail) |
| 8 | `serving_filer_rows` loses its primary key | digest | **KILLED** (83 fail) |
| 9 | activity `issuer_key` → private `cusip:` namespace | C3 | **KILLED** (suite + acceptance) |
| 10 | delete `write_serving_db` in `run_build` | C2 | **KILLED** (82 fail) |
| 11 | delete the serving manifest entry | C2 | **KILLED** (10 fail) |
| 12 | delete `require_complete_inst_module` | R10 | **KILLED** |
| 13 | filer-grain `value_usd or 0` | NULL-honesty | **KILLED** |
| 14 | **activity-grain `curr_shares or 0`** | NULL-honesty | **SURVIVED** → N3 |
| 15 | delete `HoldingsTable.astro` `data_note` render | honesty | **KILLED** (post-build **and** unit) |
| 16–18 | delete `backs` / `likes` / `bullish` patterns | banned wording | **KILLED** (each) |
| 19 | remove the unkeyable branch from `positionIdentity` | C6 | **KILLED** |

**17 killed, 2 survived.**

## Issues Found

### Critical

**N1 — `SITE_CHROME_FILES` is defined, documented as the unaccounted file class, and
referenced nowhere. The budget projection under-reports the breach by 103 files, in the
unsafe direction.**
`src/populus/inst_budget.py:104` declares `SITE_CHROME_FILES = 103` with the comment
*"Everything else a real build emits and no term accounted for: `_astro/` bundles (91) and
the fixed top-level pages (12)."* `grep -rn SITE_CHROME_FILES` over the entire repository
returns **exactly one hit — the definition.** It is not in `__all__`, not in
`worst_case_file_count` (`:241-263`), not in any test, not in `scripts/accept_m2_8.py`.

Measured:

```
REPORTED projection  = 12,442 + 1,500 + 64 + 2,064 = 16,070   -> over by 1,070
M1_MEASURED_PAGES + SITE_CHROME_FILES = 12,545   <- the module's OWN measured tree
projection incl. chrome                = 16,173  -> over by 1,173
UNDER-REPORT vs the module's own measured tree = 103 files
```

`worst_case_file_count` is fed `M1_MEASURED_PAGES = 12_442`, which
`dashboard/test/post/file-budget.test.ts:150-151` defines as `congress/ + tickers/` **only**.
The real tree is 12,545 (I counted it; `accept-m2-8` counts it; they agree). The 103-file
remainder was identified, given a named constant, and then omitted from the formula.

*Failure scenario:* the owner reads `RESERVATION BREACH … 1,070 over` and sizes the remedy
against 1,070 when the honest figure is 1,173. Shrinking a reservation by exactly 1,070
leaves the tree still over its self-cap. This is the same defect class as C5(a) — *"it omits
a whole file class"* — reproduced inside the fix for C5(a), and it errs in the same unsafe
direction. It is Critical not because the breach is hidden (it is surfaced correctly) but
because the number the owner will act on is understated by a term the module itself named.
*Fix direction:* add `SITE_CHROME_FILES` to `worst_case_file_count`, or fold it into
`M1_MEASURED_PAGES` and re-point the drift test at the whole tree. Do not delete the
constant — the class is real.

**N2 — SURVIVING MUTATION on exit classification. The plan's "two or more surviving bases ⇒
not assertable" is enforced by the code and pinned by nothing.**
`src/populus/inst_serving.py` — relaxing the composition guard from *exactly one* to *at
least one*:

```python
-        if sum(1 for _amend, is_full, _type, _status in rows if is_full) != 1:
+        if sum(1 for _amend, is_full, _type, _status in rows if is_full) < 1:
```

**263 tests pass. `make accept-m2-8` passes.** Nothing anywhere observes the change.

Plan `RUN-M2-8-plan.md:340` is explicit and normative: *"exactly one surviving base 13F-HR
for the (cik, period) after restatement resolution — **two or more surviving bases ⇒ not
assertable**"*. My own C4 probe shows the shipped code *does* implement it (base + an
earlier-filed RESTATEMENT yields 2 full reports and is correctly refused) — but that
behaviour is unguarded, so it can be removed silently.

*Failure scenario:* a filer's period carries two surviving full holdings reports — an
out-of-order restatement, a duplicate base accession, or a restatement whose supersede link
was never written. The composition is ambiguous: the two documents disagree about what was
held. Under the relaxed predicate the period reads authoritative-full and every position
absent from the merge publishes as `change_kind='exit'` — *"this institution sold out of X"*
asserted from a document set that contradicts itself. This is the exact honesty failure
`exit_not_assertable` exists to prevent, and the plan names this exact condition.
*Fix direction:* add the fixture I built for the C4 probe — base plus a RESTATEMENT filed
**before** it, both surviving — and assert not-authoritative. It is ~10 lines beside the
existing `_exit_case` helper. [[mutation-tests-pin-properties]]

**N3 — SURVIVING MUTATION on NULL-honesty. The activity grain's undisclosed values can be
fabricated as `0` with every gate green.**
`src/populus/inst_serving.py` — on a field the repository's own two-period fixture
**actually leaves NULL**:

```python
-                "curr_shares": curr_shares,
+                "curr_shares": curr_shares or 0,
```

**263 tests pass. `make accept-m2-8` passes.** This is not a no-op mutation: I measured the
fixture first — `NULLs in the repo two-period fixture: {'curr_shares': 1}` — so the mutation
genuinely converts a published NULL into a published `0`.

The filer grain **is** pinned: the same mutation on `"value_usd"` is **KILLED** by
`test_emitted_rows_round_trip_with_null_honesty`. The gap is specific to the activity grain
— the grain R13 introduced, and the one whose values render as change copy in the feed.
`inst_serving.py`'s module header (line 31) states the invariant absolutely: *"a legitimately
unavailable value is None and is never rendered as 0 (NULL-honest)"*. `accept-m2-8`'s
"no fabricated zero in the artifact" check does not reach `serving_activity`.

Separately measured: **no fixture anywhere produces a NULL `prev_value_usd`,
`curr_value_usd` or `delta_value_usd`**, so the `# None = undisclosed, never 0` comment at
`inst_serving.py:827` documents a property that is entirely untested.

*Failure scenario:* a filer discloses shares but not value (or the reverse) — the routine
case `sumDisclosedValue` and the `value_label` machinery exist for. The feed publishes
`0 shares` / `$0` for a position that was simply not disclosed, and the dashboard renders it
as a real quantity rather than as "not disclosed". This is the defect M13 fixed on the
consumer side, arriving from the producer side.
*Fix direction:* extend `test_emitted_rows_round_trip_with_null_honesty` over
`activity_rows`, and widen `accept_m2_8.py`'s zero-check to `serving_activity`.

### Major

**N4 — NEW REGRESSION: every holding on the live federated plane now ships
`accession: null`, and the docstring justifying it is factually false.**
`src/populus/mcp_server/envelope.py:125,142` — `accession: str | None = None` and
`"accession": accession` are **new in this increment** (confirmed by `git diff HEAD`). The
published plane passes it (`server.py:642`, `accession=row["accession"]`). The live plane
does not:

```python
# src/populus/mcp_server/server.py:1031-1039
holdings = [
    env.shape_holding(
        h,
        period_of_report=detail["period_of_report"],
        filed_date=h.get("source_filed_date") or detail["filed_date"],
        doc_url=h.get("source_doc_url") or detail["doc_url"],
    )                                     # <- no accession=
    for h in detail["holdings"]
]
```

The docstring at `envelope.py:129-131` says it is optional *"because the live federated path
shapes rows before an accession is resolved"*. That is contradicted one module away:
`src/populus/mcp_server/inst_queries.py:590` emits `"source_accession": source.accession`
in the very dict being iterated. The call site uses `source_filed_date` and `source_doc_url`
from that dict and drops the third sibling.

`server.py:605-606` states the contract this breaks: *"Rows are shaped exactly like the
federated ones so a client parses both planes identically."*

*Failure scenario:* a client reading per-row §5.1 provenance gets a real accession from
`mode='snapshot'` and `null` from `mode='detail'` on the live path — and `null` is
indistinguishable from "this filing has no accession", which is never true. Per-row is the
correct grain here for the same reason `filed_date` and `doc_url` already are: a composed
period mixes a base filing with its amendments.
*No test covers it in either direction* — `git diff HEAD -- tests/test_mcp_server_inst.py`
has no `accession` hunk, and `test_shape_holding_fields` (`:506-518`) asserts eight fields,
not this one. The two existing `accession` assertions are on the envelope-level
`live_source`, a different field.
*Fix direction:* one line, in the idiom of the two above it —
`accession=h.get("source_accession") or detail["accession"]` — plus a cross-plane test.

**N5 — `DEV-NOTES.md` is inaccurate again. The measurement is stale and the changed-file
list omits nine files.**
Round 1 refused this document as a QA input (M15). It is no longer *affirmatively false* —
the "T8/T9/T11–T16 NOT STARTED" claim is gone and correctly retracted — but its replacement
numbers do not match `git`:

| `DEV-NOTES.md:15-19` | measured now |
|---|---|
| 19 files modified | **21** |
| ~1,918 insertions / 144 deletions | **1,978 / 147** |
| ~9,455 lines in new files | **9,484** |

The cause is visible in the mtimes: `DEV-NOTES.md` was written at **14:21** and five files
were modified after it — `fixture-preview.test.ts` 14:35, `ARCHITECTURE.md` 14:51,
`envelope.py` 14:52, `server.py` 14:53, `test_mcp_server_inst.py` 14:53. The document was
accurate when written and was not re-measured before being handed to QA.

Nine changed files are named nowhere in it: `ARCHITECTURE.md`,
`dashboard/src/pages/institutional/{filers/[cik],index,tickers/[t]/holders}.astro`,
`dashboard/test/pages-render.test.ts`, `src/populus/client/snapshot.py`,
`src/populus/mcp_server/envelope.py`, `tests/test_mcp_server_inst.py`,
`tests/test_inst_flags.py`. **N4 lives in one of them** — the one file that changed after
the notes were written *and* carries a new untested regression is the one the author's own
review narrative never covered.

**N6 — `sortHoldingRows` uses an inconsistent comparator; its docstring promises the
determinism the code does not provide.**
`dashboard/src/lib/holdings.ts:510` calls `positionIdentity(a)` / `positionIdentity(b)`
**without the `rowIndex` argument** that `foldPositions` correctly passes at `:641`. Without
it, every unkeyable row collapses to one synthetic key. Measured:

```
identity(a) = unkeyable:2026-03-31:?|LONG|SH
identity(b) = unkeyable:2026-03-31:?|LONG|SH   (identical)
cmp(a,b) = 1   cmp(b,a) = 1      <- both claim "greater": not a strict weak ordering
keyed duplicates (same position_key + grain): identity equal = true | cmp = 1, 1
n=3 / 12 / 30 / 64:  sortHoldingRows(rows) === sortHoldingRows(reversed) ?  false  (all four)
```

The docstring at `:499-501` states *"Deterministic display order … **Two builds of one
corpus must paginate identically.**"* The comparator never returns `0`, so ties resolve by
input order in a way `Array.prototype.sort` does not define.
*Failure scenario:* two rows sharing an identity — two unkeyable holdings, or the repeated
line items the module explicitly calls legitimate — land either side of an embed page
boundary depending on upstream row order, so a rebuild shifts page contents and page bytes.
Bounded in practice because `row_id INTEGER PRIMARY KEY` makes the producer's read order
stable, which is why I grade this Major rather than Critical.
*Fix direction:* thread the index (as `foldPositions` does) or return `0` on equal identity
and let the sort's stability do the work.

### Minor

- **Self-fulfilling assertions elsewhere — the M4 shape, all three PRE-EXISTING at
  `7ab75ec`** (verified with `git show HEAD:`; none introduced by this remediation):
  - `dashboard/test/post/fixture-preview.test.ts:116` —
    `assert.ok(html.includes("all periods on record") || html.includes("§"), "cumulative labeling")`.
    The real copy at `dashboard/src/pages/institutional/index.astro:53` reads
    `accumulate over **ALL** periods on record`; `includes` is case-sensitive, so the first
    disjunct is permanently false and the assertion rests on `§`, which the page emits four
    times unconditionally. **Deleting the Locked #6 cumulative-labeling footnote — an honesty
    invariant on a shipped page — keeps this green.**
  - `dashboard/test/css-fold.test.ts:444` —
    `assert.ok(css.includes(`.${cls}`) || css.includes("[data-"), …)`. The right disjunct is
    loop-invariant and `global.css` contains four `[data-` occurrences, so the "is styled"
    half cannot fail for any of the 29 Astro-only classes (including `caveat-box`).
  - `dashboard/test/pages-render.test.ts:132` —
    `assert.ok(html.includes("· partial · JT") || html.includes("· JT"), …)`; the second is a
    substring of the first, so only the `JT` owner token is pinned and the `partial` side
    qualifier is not.
- **The ban list misses the natural present-tense inflections of two spec-listed terms.**
  Measured: `"the manager is betting on it"` → `[]` (the `bet` pattern is `\bbets?\b`) and
  `"piling into it"` → `[]` (the pattern is `\bpiling in\b`, and `into` defeats the word
  boundary). Both are exactly the present-tense trading claim §1.1's stated rationale bans.
  Zero live hits today; a mechanism gap, not a current violation.
- **A new unconditional completeness claim the R12 scanner cannot see.**
  `dashboard/src/lib/ui.ts:1015-1016` (new copy) reads *"**every position** this filer
  reported for the selected quarter, as it reported it"*, rendered by a block that has no
  knowledge of whether `capRows` truncated the embed. Measured:
  `unqualifiedAllClaims(<that copy>) → []` while the control
  `unqualifiedAllClaims("all holders of this issuer") → ["all holders of this issuer"]` — the
  scanner matches `\ball\b` only. Mitigated: `holdings.ts:1054-1059` does render a truncation
  note when `total > matched`, so a capped page is not silently false; the two statements
  simply contradict each other on the same page.
- **`ARCHITECTURE.md:389` states a measurement with no evidence in the repository.**
  *"**Measured 2026-08-05: 184 B/row** across all three grains on a 1,202-row projection (the
  earlier '~90 B/row target' was an estimate, never a measurement)."* `grep -rn "184 B\|1,202"`
  over the whole tree returns **only that line**. No script, gate or test produces a
  bytes-per-row figure or a 1,202-row projection. Replacing an unbacked 90 with an unbacked
  184, in a sentence criticising the 90 for being unbacked, is [[mockups-are-not-measurements]]
  recurring. The rest of that table cell is accurate and checks out.
- **`src/populus/publish/build.py:1954-1958` describes a mechanism that does not exist** —
  *"`run_verify`, `run_rollback` and the client installer all iterate `module_db_artifacts`"*.
  There is no `run_rollback` (it is `_publish_rollback`, `:2156`), and neither it nor the
  client installer calls `module_db_artifacts`; both iterate every manifest artifact. The
  coverage is broader than claimed, so this is harmless in effect and wrong in description.
- **`accept-m2-8` reports `logical_digest 8c4493412ed48859…` while a real published build
  produces `8e272d2a32dc42e7…`** — different fixtures, both correct, but the Dev Notes quote
  the acceptance figure as though it were the build's.
- **Test bookkeeping does not reconcile.** `dashboard/test/holdings.test.ts` defines **50**
  top-level tests, while `dashboard/test/fixtures/institutional.ts:3-5` and
  `DEV-NOTES.md:165-167` both say 49; and 260 − 221 = **39**, not 49. The **de-duplication
  itself is confirmed** — no test file under `dashboard/test/` imports another `.test.ts`,
  zero test blocks were removed from `css-fold.test.ts` (6 at HEAD → 11, all additive), and
  summing top-level tests across the suites gives **221 exactly**. Nothing was lost; the
  counts were taken at different moments.
- **`tests/test_inst_serving_artifact.py:306** —
  `assert "require_complete_inst_module(" in inspect.getsource(run_build)` is the M4 shape in
  Python. It works today (the literal appears only at the real call site), but a future
  comment naming the function inside `run_build` would silently defeat it.
- **`dashboard/src/components/HoldingsTable.astro:93`** opens a `DatabaseSync` and the file
  contains no `.close()`; the handle is memoised on `globalThis` for the build process. The
  header comment makes this deliberate and it is build-time only, but it is asymmetric with
  `activity.ts`, which closes in a `finally`.

## New vs Pre-existing

**Introduced by this remediation pass:** N4 (`accession: null`), N5 (Dev Notes staleness),
N1's dead constant, and the `ui.ts` "every position" copy. These are the regressions a
~30-file fix pass had room to create, and N4 is the one that matters.

**Introduced earlier in T7–T16, surviving round 1 undetected:** N2, N3 (both surviving
mutations — the code paths are from the original increment; the remediation added tests
around them without pinning these two properties), N6 (`holdings.ts` is a new file in this
increment).

**Pre-existing at `7ab75ec`, inherited, not caused by this RUN:** all three self-fulfilling
assertions (`fixture-preview.test.ts:116`, `css-fold.test.ts:444`,
`pages-render.test.ts:132`) — each verified present and unchanged at HEAD; the M1 `dist/`
overrun itself (M1-B/M1-E grew the tree with nothing counting it), which `accept-m2-8`
correctly labels INHERITED; and `scripts/accept_m1_b.py:63 FILE_BUDGET = 8500`.

**Not a defect, recorded so it is not re-litigated:** the C4 override. The prescribed fix was
wrong and the implemented fix is right.

## Test Coverage Gaps

- **The activity grain never flows through `run_build`.** Every end-to-end fixture
  (`seed_inst(db, covered=True)`) is single-period, so `agg_qoq_deltas` has **0 rows** and the
  published `serving_activity` has **0 rows** in every test that drives a real build. Measured
  on my own e2e run: `serving_filer_rows 1, serving_issuer_holder_rows 1, serving_activity 0`.
  The grain is exercised only through `_project_with_aggregate`. The ATTACH resolves (I proved
  it by instrumentation), but no test would notice if it stopped.
- **Producer → consumer is closed nowhere in the repository.** The boundary suite hand-writes
  its serving rows (`tests/test_inst_federated_boundary.py:121-149`). It imports
  `SERVING_SCHEMA` so the *schema* contract is genuinely pinned (M10 is fixed), but the
  producer's actual output is never fed to the consumer. I had to write that test myself to
  verify C2; it passed, and it should exist in the repo.
- **N2 and N3 above** — the two surviving mutations *are* coverage gaps.
- **No NULL `prev_value_usd` / `curr_value_usd` / `delta_value_usd` exists in any fixture**,
  so the activity grain's NULL-honesty contract is unexercised in full.
- **The restatement-only period is untested.** A period whose only surviving filing is a
  `13F-HR/A` marked RESTATEMENT with no base ever ingested reads **authoritative** (measured).
  That is defensible — a restatement is a complete replacement report, and after resolution it
  is structurally indistinguishable from case (b) — but the plan's sixth condition, *"discovery
  for that (cik, period) completed without `partial_lineage`"*, is the guard that would catch a
  restatement whose base was never fetched, and it is declared unimplementable (TD-T7-1). The
  two gaps compose. Honestly declared; worth an owner's eye.
- **`accession` on `shape_holding` is asserted on neither plane** (N4).
- **`/institutional/index.html` is not in `INST_PAGES`** (`fixture-preview.test.ts:149-152`),
  so the post-build `data_note` gate covers two of three institutional surfaces despite its
  name saying "every".

## Security

Applicable surfaces only. `make security` → `scripts/dep_guard.py` → `dep_guard: OK — no
denylisted vendor dependencies or imports` (exit 0). No new dependency and no new HTTP client
were introduced; all network access remains behind `SecClient`, and the boundary suite proves
the published path opens no socket (an `_ExplodingTransport` raises on any request, on top of
the autouse socket guard — I reproduced `transport.requested == []` on a published-path call).

The one security-adjacent change is `src/populus/client/snapshot.py:513-562`
(`serving_db_path`), and it is **stricter** than its sibling `db_path()`: the artifact is
served only when the *verified* manifest enumerates it, so an unlisted file sitting in the
cache directory — which `_build_complete` never hash-checks — is not handed back. Its
`except (KeyError, TypeError)` is correctly typed for the `manifest["modules"][m]["artifacts"]`
lookup it wraps, absence returns `None`, and a non-`inst` module raises rather than guessing.

SQL construction in `_qoq_deltas_table` (`inst_serving.py:851`) interpolates a schema name
into a query. It is `# nosec B608`-marked; the value comes from `PRAGMA database_list`, not
from user input, and is double-quoted. Acceptable. The untested boundary worth naming: no
test drives `_qoq_deltas_table` against a database with an unexpected attached schema.

## Tech Debt Introduced

Cross-verified against `DEV-NOTES.md:195-211` and `docs/build/RUN-M2-8-plan.md`.

**Correctly declared** — `M1_MEASURED_PAGES` drift (bounded by a post-build drift gate,
which I confirmed exists at `file-budget.test.ts:142-159`); `ServingProjection` holding all
rows in memory (TD-T7-2); `partial_lineage` unevaluable in `authoritative_full_periods`
(TD-T7-1, and the docstring says so); R10 enforced at the producer rather than the validator;
`stats.json` truncation wiring unbuilt.

**Undeclared:**

- **`scripts/accept_m1_b.py:63` still asserts `FILE_BUDGET = 8500`** while
  `src/populus/inst_budget.py:101` records the measured M1 footprint as **12,442** and the
  module docstring calls 8,500 *"a reservation, not a measurement"* that *"under-counted this
  by 3,942 files"*. `accept-m1-b` printed `published files 24 / 8500 M1 budget` in this very
  run. Two disagreeing M1 budgets now coexist; the remediation established that one of them is
  wrong and left it asserting. Out of M2-8's scope to fix, but not out of scope to declare.
- **`SITE_CHROME_FILES` as dead code** (N1) — a constant carrying a real measurement that no
  caller consumes.
- **The `accession` field is a half-built contract** (N4) — declared on the envelope,
  populated on one plane of two, justified by a docstring that is false.
- **`positionIdentity`'s `rowIndex` is optional**, so correctness depends on every caller
  remembering to pass it; one of the two callers does not (N6). A required parameter, or a
  distinct function for the fold path, would make the defect unrepresentable.

## Memory Touch-Points

- **[[mutation-tests-pin-properties]]** — the central result of this round. The author found
  two surviving mutations and fixed them; I found **two more** on the same paths. Both are the
  documented signature: a test that asserts an end state (these fixtures reach
  authoritative-full, these rows round-trip) rather than the property (a *second* full report
  must disqualify; an undisclosed value must never become `0`). Four surviving mutations across
  this increment now.
- **[[measure-the-mechanism]]** — vindicated twice. The C5 rewrite genuinely converted a
  `value > value` tautology into a gate that counts a real tree and is driven past its cap in
  both directions. And it is the reason N1 is visible at all: once the mechanism measures, the
  missing 103 becomes arithmetic instead of opinion.
- **[[mockups-are-not-measurements]]** — recurred inside the fix for it. `ARCHITECTURE.md:389`
  replaced an unbacked `~90 B/row` with an unbacked `184 B/row` "Measured 2026-08-05", in the
  same sentence that criticises the first for being an estimate.
- **[[measure-closed-quarters-only]]** — not exercised; the serving projection publishes
  current + prior from whatever the corpus holds, and `publication_periods` does not
  distinguish an open quarter. Not in scope for T7–T16, noted so it is not assumed handled.
- **[[review-scope-decides-the-verdict]]** — this report is scoped to the code and the
  measured behaviour of the gates. Harness provenance is out of scope, and every round-1
  finding is graded explicitly VERIFIED-FIXED / PARTIALLY FIXED / DEFERRED rather than folded
  into a summary.

## Failure-Mode Sweep

| Failure mode | Present? | Evidence |
|---|---|---|
| Fixer grading its own work | **Mitigated** | Every claim re-executed; two surviving mutations and one new regression found that the author's own pass did not report. |
| Gate that cannot fail | **No** (was C5) | Both budget gates driven past their limits: *"a tree one file over the cap is REFUSED"*, *"geometry one over its maximum is REFUSED"*. |
| Estimate presented as measurement | **Yes** | `ARCHITECTURE.md:389` (184 B/row, 1,202 rows) — no evidence in the repository. |
| Self-fulfilling test | **Yes, 3 — all pre-existing** | `fixture-preview.test.ts:116`, `css-fold.test.ts:444`, `pages-render.test.ts:132`. The M4 instance itself is genuinely fixed. |
| Assertion of absence from insufficient documents | **No** | Exit cases (a)(b)(c), the NULL-`amendment_type` case and the unclassifiable-amendment case all behave per plan; 5 of 6 exit mutations killed. **But** the "2+ bases" condition is unpinned (N2). |
| NULL rendered as 0 | **Yes, latent** | Filer grain pinned; activity grain mutation **survived** (N3). |
| Silent cap/reservation relaxation | **No** | 15,000 / 20,000 / 25 MiB asserted equal to their literals; breach reported, never tuned away. |
| Producer/consumer contract drift | **Partly** | Schema contract pinned both ways (M10 fixed). Column contract inverted and real (M3 fixed). **But** `accession` diverges across planes (N4), and no test feeds producer output to the consumer. |
| Dead code presented as wired | **Yes, 2** | `SITE_CHROME_FILES` (N1) — undeclared. `classify_position` (M14) — **declared**, which is the correct handling. |
| Documentation asserting unimplemented behaviour | **Yes** | `ARCHITECTURE.md:389`; `build.py:1954-1958` (`run_rollback` does not exist); `envelope.py:129-131` (contradicted by `inst_queries.py:590`). |
| Dev Notes unusable as QA input | **Improved, not resolved** | The false claim is retracted; the numbers are stale and nine changed files are unnamed (N5). |
| Regression from the fix pass | **Yes, 1 Major** | N4, in a file modified after the Dev Notes were written and absent from its changed-file list. |

## Verdict

The remediation is **substantially sound** and I want that on the record before the blockers:
all six round-1 Criticals are materially addressed, C2 closes end to end through a real
consumer, C4's override of my predecessor's prescribed fix is **correct** and provably so,
C5's caps were not touched and the breach is surfaced exactly as an owner decision should be,
17 of 19 independent mutations were killed, and every gate claim in the Dev Notes reproduces
to the number — `make check` 0, pytest 1916 passed / 8 skipped, dashboard 221, post-build 35,
`dep_guard: OK`, and all four acceptance targets 0.

It does not pass, for four specific and narrow reasons:

1. **N1 (Critical)** — the corrected budget projection still omits a documented file class,
   understating the breach by 103 files in the unsafe direction, via a constant the
   remediation created for exactly that class and never used.
2. **N2 (Critical)** — a surviving mutation on exit classification. The plan's explicit
   *"two or more surviving bases ⇒ not assertable"* is enforced by the code and pinned by
   nothing; relaxing it publishes false exits with 263 tests and `accept-m2-8` green.
3. **N3 (Critical)** — a surviving mutation on NULL-honesty in the activity grain; an
   undisclosed value can be published as a fabricated `0` with every gate green.
4. **N4 (Major)** — a new, untested regression shipping `accession: null` on the live plane,
   defended by a docstring the adjacent module contradicts.

N2 and N3 are both fixture additions of roughly ten lines each; N1 and N4 are one-line
changes. None requires rework of the design. This is a short, well-defined list — not a
failed increment — and `DEV-NOTES.md` should be re-measured against `git` before it is handed
to the next round (N5).

This report is evidence for an independent `qa-review`. It is not merge approval.

FAIL
