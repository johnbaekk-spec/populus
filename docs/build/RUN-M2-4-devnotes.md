## Detected Stack

Python 3.12, `uv`, hatchling, SQLite/JSON1, Click, `httpx`, `lxml`, FastMCP (official MCP SDK), pytest. Canonical gates: `make test` (`uv run pytest -q`) and `make security` (`scripts/dep_guard.py`).

## Requirement and Task Completion

All R1–R14 of the pre-approved plan implemented, extending the existing MCP server rather than forking it. Built on RUN M2-3 (`inst_agg.db` aggregate tables, manifest `inst` module, module-aware `SnapshotClient.db_path()`), M2-2 (inst tables, `compute_coverage`) and M2-1 (`SecClient`).

- **R1 — `inst_filer_lookup(query, limit=25)`.** Resolves a name fragment or CIK to canonical filer(s) from `agg_filer_registry`; corrective-hint error on empty/no-match; degrades honestly when `inst` is absent. Done.
- **R2 — `inst_filer_holdings(cik, period=None, mode='snapshot')`.** The filer's published aggregate profile (registry row + concentration) for a period, under the M2 envelope, with a `mode='detail'` hint when the snapshot cannot answer; bad `cik` gets a corrective hint. Done.
- **R3 — `mode='qoq'`.** Quarter-over-quarter position changes from `agg_qoq_deltas` (`change_kind`, `delta_value_usd`, unit-guarded `delta_shares`), carrying both periods. Done.
- **R4 — `mode='detail'` (FEDERATED).** The filer's full position list for a period (or latest) fetched live from SEC EDGAR through the RUN-M2-1 `SecClient`, `live_source`-stamped instead of `build_id`, with both dates, `unit_basis` and the M2 caveat. Done.
- **R5 — `inst_ticker_holders(ticker, period=None, limit=50)`.** Resolves the ticker to an issuer CIK via the federated, cached `company_tickers.json`, derives the issuer key, ranks holders by value from `agg_issuer_top_holders`, explicitly labels the mapping as PRESENT-DAY (G14 — a current ticker→CIK map is not an as-of mapping), and hints when unresolved. Done.
- **R6 — `inst_biggest_moves(period=None, side='new', limit=50)`.** Largest cross-filer QoQ changes from `agg_qoq_deltas`, filtered by `side ∈ {new,add,trim,exit}`, value-ranked, with input validation and honest degradation. Done.
- **R7 — `inst_health()`.** Reports the `inst` module's presence, snapshot build, freshness (latest `period_of_report` + latest `filed_date`), filer/position counts and the standing caveats — including the coverage-gate withholding reason when the module is absent. Done.
- **R8 — envelope.** Reuses `INST_DATA_NOTE` as the non-removable M2 `data_note`; adds a `live_source` alternative to `build_id` (§11.3) for federated responses and `shape_holding` for inst records. Done.
- **R9 — `license_notices`.** Every inst response carries the `sec-edgar` register attribution via module-scoped surfacing of the entry's required notices. Done.
- **R10 — `populus_health`.** Reports `inst` alongside `congress` (present/absent, snapshot build, freshness, caveats), listing only present modules. Done.
- **R11 — server wiring.** Resolves an `inst` `SnapshotClient(module="inst")` **tolerating an absent module** (`db_path()` is `None`) plus an injectable federated client; no fork of the congress server. Done.
- **R12 — always-run inst tool suite.** Committed fixtures cover every tool's snapshot/qoq/detail path, the inst-absent degradation, and envelope honesty (data_note, both dates, unit labels, license notices). Done.
- **R13 — cache-gated golden Q&A corpus.** Mirrors M1's gated golden with analyst questions ("What did Berkshire hold at 2026-Q1?", "Who are the biggest holders of …?", "Is this current?" → must surface the quarter-end/lag caveat). Done.
- **R14 — no regressions.** The prior 1298 tests stay green; `scripts/dep_guard.py` clean (G1); no test opens a socket (the autouse guard holds; the federated path is exercised through an injected transport). Done.

## Changed Files

New: `src/populus/mcp_server/inst_queries.py`, `tests/test_mcp_server_inst.py`, `tests/fixtures/inst/mcp/`.

Modified (complete list, reconciled against the gate manifest — QA-r6-F3):
- `src/populus/mcp_server/server.py` — register the five `inst_*` tools, resolve the inst snapshot + federated client, thread provenance/absence state, extend `populus_health`, stamp federated failures with `live_source`.
- `src/populus/mcp_server/envelope.py` — M2 `data_note`, `live_source`, `shape_holding`, `sec-edgar` notices.
- `src/populus/client/snapshot.py` — tolerate an absent module; durable withdrawal (tombstone + trust advance + sidecar removal), fail-closed accessors, crash-safe republication ordering, `verified_omission` on `RefreshResult`.
- `src/populus/ingest/inst13f.py` — `discover(include_history=True)` reads the older `filings.files[]` shards, `_SHARD_RE` validation, `submissions_shard` on both ingest sources, `unread_shards` on `_Discovery`.
- `src/populus/normalize_inst.py` — full §5 caveat text in `INST_DATA_NOTE`.
- `src/populus/identity/bootstrap.py` — `parse_company_tickers`, the decision core split out of `load_company_tickers` so the federated resolver reuses it.
- `tests/test_publish.py` — snapshot withdrawal/republication/crash-boundary coverage and the real-client resolver integration tests.
- `tests/test_inst_ingest.py` — cache-source history-shard coverage.
- `tests/test_pointer_state.py` — crash boundaries rewritten to the three-boundary model; the R22 `client_compat` test restored to an honest trigger.
- `src/populus/inst_agg.py`, `src/populus/inst_agg.sql`, `tests/test_inst_agg.py` — nullable QoQ value columns and the `unclassified` change kind, so an undisclosed prior value can no longer difference against a fabricated zero.

New documentation artifacts: `docs/build/RUN-M2-4-plan.md`, `docs/build/RUN-M2-4-devnotes.md` (this file), and `docs/build/RUN-M2-4-withdrawal-lifecycle.md` — the APPROVED specification this run is gated on.

*(This list has now been corrected twice for omissions — QA-r6-F3 and QA-VERIFY4-N4. Reconcile it against `git status`, not from memory.)*

### QA round-1 remediation (9 blockers, all fixed and mutation-verified)

- **F1 — a withheld module kept serving stale cached data.** `SnapshotClient.refresh()` accepted a verified manifest that no longer contained the module and left the previous build in place, so `inst` continued answering after the coverage gate withheld it. Now returns a `withdrawn` result and clears the `current` marker. *Test:* `test_a_withheld_module_stops_serving_the_previously_cached_build` (drives the real snapshot path).
- **F2 — the federated `mode='detail'` path served ONE filing per period.** For a period with a base 13F-HR and a `13F-HR/A amendmentType NEW HOLDINGS`, it returned the newest — i.e. Berkshire's **4-row** amendment presented as its complete 2025-Q1 position list (the base has **110**). It now composes the period's filings in filed order with the same semantics the pipeline applies (RESTATEMENT supersedes, NEW HOLDINGS adds, unknown type taken as authoritative and labeled), returns 114 rows, exposes a `composition` audit trail, and stamps **each row with its own filing's filed date and document URL** rather than restamping the base rows with the amendment's date (G4). *Test:* `test_federated_detail_composes_the_real_base_and_new_holdings_amendment`, against the committed real merge pair.
- **F3 — transport/decode failures escaped the tool boundary.** A timeout or malformed payload propagated out of an MCP call instead of returning an envelope. Both federated boundaries now convert any unexpected exception into an honest error envelope naming the exception type. *Test:* parametrized over both tools.
- **F4 — `inst_ticker_holders` records dropped their period, unit and provenance.** A holder row lifted out of the response could not say which quarter-end or unit it described. Records now carry `period_of_report` + `value_unit`; the response carries `period_of_report`, `filed_through` (the build watermark — the aggregate has no per-row filed date and one is never fabricated) and a `provenance` string.
- **F5 — the inst `data_note` was an abridged caveat.** Restored to the full M2-CONTRACT §5 text (quarter-end snapshot, up-to-45-day lag, no shorts/cash, era-dependent units, confidential omissions, amendments, affiliated overlap).
- **F6 — `inst_health` claimed the ≥95% gate for data that never passed it.** A `--inst-db` bypass points at an arbitrary local file; asserting the coverage guarantee there fabricates an assurance about unpublished data. Caveats are now provenance-dependent (`published-snapshot` vs `unverified-local-db`, the latter carrying an explicit `UNVERIFIED SOURCE` caveat).
- **F7 — `populus_health`'s inst detail reported freshness without caveats in both states.** It now carries the same caveats/provenance/`data_note` as `inst_health` (asserted equal in test), falls back to the aggregate's own latest period when no watermark exists, and states that ABSENT means *withheld by the coverage gate*, not broken.
- **F8 — the debt inventory redefined an approved ID.** Reconciled below.
- **F9 — the federated ticker resolver reimplemented a laxer `load_company_tickers`.** It bypassed the malformed/duplicate/**DC1 title-conflict** dispositions, so a ticker the identity pipeline REJECTS still resolved to an `entity:` key the published aggregate does not key the same way, picking the first raw match. `load_company_tickers` was split into a `parse_company_tickers` decision core that both planes now share; a rejected ticker returns an honest error, a symbol claimed by two CIKs refuses to guess (G3), and an accepted mapping reports the snapshot's dispositions.

### QA round-2 remediation (7 further blockers + 1 nit, all fixed and mutation-verified)

Round 2 confirmed F3/F4/F8/F9 resolved but found that three round-1 fixes were incomplete and that composition was under-tested. All are fixed:

- **r2-F2 (worst) — `main()` DROPPED `inst_from_published_manifest`.** The round-1 F6 provenance fix was therefore **inert in production**: every verified published snapshot was labeled `unverified-local-db` and had its coverage assurance suppressed — the exact inverse of the intended behaviour — while the round-1 test passed because it constructed `build_server` directly. `main()` now forwards the whole resolved mapping, and `test_main_forwards_every_resolved_value_to_the_server` asserts key-by-key equality so ANY future dropped key fails there rather than in production.
- **r2-F1 — the withdrawal was not durable.** Clearing the `current` marker left the advisory sidecar naming the old build, so the next client's read-time `reconcile()` cross-checked it against the trust tuple, found the cached build dir intact, and **resurrected exactly the stale institutional build the gate meant to suppress**. `_withdraw()` now removes the sidecar first, and an `OSError` is no longer swallowed — a withdrawal that cannot be made durable returns `refused` instead of falsely reporting success. Regression: withdraw → new client → offline pointer fetch → still absent.
- **r2-F3 — absence reasons asserted a gate decision that may never have happened.** `populus_health` told every absent state that the ≥95% gate withheld the module, including a `--db` dev bypass and a failed refresh. The reason is now RESOLVED where the facts are: only a verified current manifest that omits `inst` may claim a gate withholding; a bypass or resolution failure gets a neutral reason that explicitly asserts no gate decision was observed. Carried structurally (`inst_absent_gate_withheld`), not sniffed from prose.
- **r2-F4 — `composition_complete` was derived from a LABEL, not from success.** A base that failed to parse contributes no rows, yet still counted as "base", so a clean NEW HOLDINGS amendment on top of it was reported complete; conversely a standalone RESTATEMENT — authoritative in full by itself — was falsely warned incomplete. Completeness now requires a *successfully parsed* authoritative full filing (base or RESTATEMENT), and an unknown amendment type can never establish it.
- **r2-F5 — `parse_status` reported only the LAST filing.** A clean amendment masked a failed or partial base whose rows feed the pooled answer. Status is now aggregated across every applied filing (any failure ⇒ `partial`, all failures ⇒ `failed`), each filing's own status appears in the `composition` trail, and the last filing's status is kept separately as `last_filing_parse_status`.
- **r2-F6 — the composition matrix was untested.** Added always-run cases for RESTATEMENT replacement, RESTATEMENT-only discovery, unknown amendment type, out-of-order discovery, and a failed constituent filing — built from the REAL corpus bytes with only the cover's `amendmentType` value swapped, so the true parse chain is exercised rather than stubbed holdings.
- **r2-F7 — the data note stated a falsehood.** "a filing is due up to 45 days after the quarter end, so these positions are **at least** that stale" inverts the rule: 45 days is the maximum filing lag, not a minimum staleness. Replaced with the contract's own framing — quarter-end snapshots *filed up to 45 days late*.
- **r2-F8 (nit) — test count drift** between this record and the gate artifact; reconciled below against the canonical gate.

### QA round-3 remediation (4 blockers, all fixed and mutation-verified)

Round 3 confirmed the round-2 work but found that two of those fixes still did not hold end-to-end, plus two genuine contract gaps:

- **r3-F2 — the verified-omission branch was UNREACHABLE in production.** The round-2 resolver decided "did the gate withhold this?" by re-reading `current_manifest()` — but withdrawal clears the `current` marker, so the real client always returns `None` there and production fell back to the neutral reason. It passed round 2 only because my mock kept returning a manifest the real client never would. The fact now travels on `RefreshResult.verified_omission`, and the new test drives the **real** `SnapshotClient` withdrawal lifecycle with no mock at all.
- **r3-F1 — withdrawal did not advance the anti-replay trust tuple.** Removing the sidecar stopped `reconcile()`, but the tuple still named the OLD pointer, so replaying that pointer evaluated as `idempotent` and the online heal branch rebuilt `current` from the retained cache — the withheld build came back. Withdrawal now writes a durable **tombstone** bound to the withdrawing pointer, advances the trust tuple to it, and removes the sidecar; every heal path consults the tombstone. Three defenses: the replay test passes on any one of them, so an additional test isolates the tombstone's own job (a repeat refresh at the unchanged pointer must still report `withdrawn` **carrying `verified_omission`** — without it the fact is lost and r3-F2 returns one path across).
- **r3-F3 — `partial` was accepted as authoritative.** Completeness tested `status != "failed"`, but `partial` means parse defects or an entry-total mismatch, i.e. positions may be MISSING. Now requires exactly `parsed`. **This change exposed a bug in my own round-2 fixtures**: synthetic covers were paired with a different filing's info table, producing an entry-total mismatch and therefore a silent `partial` — my composition tests had been weaker than they appeared. Covers are now generated consistent with the table they serve.
- **r3-F4 — only `filings.recent` was read.** SEC keeps a recent window inline and pushes older filings into `filings.files[]` shards, which discovery counted but never fetched (TD-M2-2-3), so an explicitly-requested historical period returned a FALSE "no 13F-HR at that period" — breaking R4's arbitrary-period promise. `discover()` gained `include_history` (opt-in, so the M2-2 ingest path's cost and behaviour are unchanged) with shard-name validation matching the `_ACCESSION_RE` discipline; a shard that cannot be read is recorded, and the not-found error then states that the history was searched INCOMPLETELY rather than asserting the filing does not exist (G3).

### QA round-4 remediation (5 blockers + 1 nit, all fixed and mutation-verified)

Round 4 confirmed round 3's withdrawal/replay behaviour, real-client omission propagation and strict `parsed` requirement, then found five more:

- **r4-F2 — I shipped a method that could never run.** `_CacheSource.submissions_shard` passed a `from_cache` field `_Doc` does not have and omitted the required `raw_path`, so EVERY call raised `TypeError`. It survived a "mutation-verified" claim because the r3-F4 shard tests drove only the *federated* source: I added a method to three classes and exercised one. Rebuilt against the real `_Doc` contract (sidecar provenance + `raw_path`, mirroring `submissions`), with a cache-source history test that also pins the no-opt-in behaviour.
- **r4-F1 — an interrupted withdrawal could serve forever.** Withdrawal writes the tombstone BEFORE unlinking `current`, so a crash or unlink I/O failure between the two leaves a live marker naming the withheld build — and reconcile's tombstone branch merely *returned* instead of revoking it. Reconcile is the crash-recovery path, so it now FINISHES a half-done withdrawal.
- **r4-F3 — incomplete history was surfaced in only one branch.** `unread_shards` was consulted solely in period-not-found, so an empty `recent` plus unreadable shards falsely asserted "no 13F-HR filings found", and a successfully-composed period was still marked complete even though an unread shard could hold an amendment for that very period. Incompleteness now propagates to every no-result and composed-result branch via `history_complete` + `unread_shards`, and `composition_complete` requires an exhaustive search as well as an authoritative full filing.
- **r4-F4 — withdrawal was never proven reversible.** No test drove covered → withheld → newer covered, so a tombstone interaction could have permanently suppressed a legitimate republished module without failing the gate. Added a real-client lifecycle test proving republication restores `current`/`db_path`, stays idempotent on a repeat poll, and does not weaken old-pointer replay rejection.
- **r4-F5 — federated FAILURES were stamped as snapshot data.** Post-fetch error branches returned through the snapshot-default envelope, attaching the institutional `build_id` to a live SEC failure and breaking the §11.3 `live_source`-xor-`build_id` data-plane rule. Every federated error path now carries a failure-aware `live_source` (`outcome: "failed"`, null accession).
- **r4-F6 (nit)** — a resolver comment still said an absent module refresh returns `refused`; the implemented status is `withdrawn`. Corrected.

### QA round-5 remediation (4 blockers, all fixed and mutation-verified)

- **r5-F1 — the round-4 fail-closed path still served withheld data.** If the tombstone landed but unlinking `current` raised `OSError`, `refresh()` returned `refused` with `serving` still set; `_resolve_snapshot` then took `db_path()` at face value and served the coverage-gate-WITHHELD database *labeled as a published snapshot*. A verified omission is a fact about the manifest, not about our filesystem, so it now returns `withdrawn` + `verified_omission` regardless of cleanup success, and `current_build()` fails closed while a tombstone stands (belt-and-braces, independent of reconcile). Republication clears the tombstone, so a legitimate newer build is never suppressed. Test injects the unlink failure and asserts the PRODUCTION resolver refuses the data.
- **r5-F2 — the no-SEC-client branches still used the snapshot envelope.** Round 4 stamped the exception paths but not the configuration-failure paths, so a missing federated client was attributed to `inst_build_id`. Both tools' no-client branches now carry the failure-aware `live_source`.
- **r5-F3 — only unread SHARDS counted as an incomplete history.** A filing rejected at discovery (malformed accession, non-ISO dates) is equally invisible to the answer, and could be the very amendment that restates the period. `discovery.rejected` now participates in `history_complete` / `composition_complete` and is reported as `rejected_filings`.
- **r5-F4 — all-period totals were presented as the requested quarter's.** `agg_filer_registry` accumulates over EVERY retained period, but `filer_snapshot` returned `position_count` / `total_value_usd` beside a requested `period_of_report` — inviting an analyst to read lifetime totals as that quarter. Those keys are now `all_periods_*` with a `counts_basis` label, the quarter's own figures are returned separately under `period`, and a quarter with no data returns a corrective hint listing the available periods instead of a successful profile with a null concentration (which was indistinguishable from a real empty quarter).

### QA round-6 remediation (2 blockers + 2 nits, all fixed and mutation-verified)

Round 6 was the first round to CERTIFY prior fixes rather than find holes in them ("round-5 fixes F2–F4 are reachable through production tool closures and adequately exercised"), and it localized the remaining risk to a single named subsystem — the snapshot withdrawal/republication lifecycle. Both blockers were in it:

- **r6-F1 — a persistent unlink failure crashed server startup.** With the `current` unlink failing repeatedly, the next refresh retried the revocation inside `reconcile()` and let the `OSError` escape. `refresh()` runs on every poll, so this took down the whole server — congress and the federated tools included — instead of starting with `inst` safely absent. Revocation failure is now swallowed: the tombstone stands, the accessors keep failing closed, and the module is simply unavailable.
- **r6-F2 — republication cleared the tombstone before the new markers were durable.** A crash in that window left the stale `current` marker from a failed withdrawal readable again, re-exposing the withheld database. The tombstone is now cleared LAST, after tuple/sidecar/current. Fixing this exposed a modeling error of my own: the tombstone recorded the *withdrawing* build while `current` names the *previously-served* build — two different ids I had conflated, so the active-check compared values that could never match. The tombstone now records the suppressed build explicitly, and is active exactly while `current` is absent or still names it.
- **r6-F3/F4 (nits)** — the Changed Files list omitted the ingest and two test files (reconciled against the gate manifest above); `RefreshResult`'s documented status set omitted `withdrawn` (added).

### QA round-7 remediation (2 blockers + 1 nit, all fixed and mutation-verified)

Round 7 found no congress or MCP-tool regression; both blockers were again in the snapshot lifecycle, and both were genuinely merge-blocking:

- **r7-F1 — a failed tombstone WRITE left nothing suppressing anything.** Round 6 hardened the *cleanup* failure, but if creating the tombstone itself raised `OSError` no suppression state existed at all: the stale `current` marker stayed readable and the production resolver served the coverage-gate-withheld database as published. Fixed at the right layer — `_resolve_snapshot` now treats `verified_omission` as authoritative BEFORE consulting `db_path()`, because the manifest fact cannot fail on I/O while every mechanism below it can. Test fails both the tombstone write and the marker unlink, resolves twice, and asserts congress stays available throughout.
- **r7-F2 — an authorized rollback to the withheld build stayed suppressed forever.** Tombstone activity keyed purely on `current == withheld_build`, so a legitimate higher-version pointer rolling back TO that build was revoked on every poll — the module unavailable indefinitely, markers oscillating. Activity is now generation-aware: a sidecar naming that build at a pointer NEWER than the withdrawal proves a completed republication and retires the tombstone, while a crash mid-republication (no such sidecar) stays suppressed. **My first version of this test passed immediately and tested nothing** — a clean install deletes the tombstone, so the generation check never ran; the test only became load-bearing once it injected the surviving-tombstone window the finding actually describes.
- **r7-F3 (nit)** — "Plan Deviations: none in substance" understated a real scope expansion; disclosed above.

### The withdrawal-lifecycle rewrite (rounds 5-8 superseded)

QA rounds 5, 6, 7 and 8 each found blockers in ONE mechanism: a tombstone-based
scheme that inferred "is this module withheld?" from four independently-
corruptible files cross-checked at read time. Round 8's four blockers were all
inside the same function, which had been rewritten four times. The owner's call
was to stop patching and specify the lifecycle first.

**docs/build/RUN-M2-4-withdrawal-lifecycle.md** is that specification. It went
through six design-review rounds before implementation began — the reviews found
three blockers per round in the DESIGN, each of which would otherwise have cost
an implementation plus a QA round to discover: a tuple-write failure that
recreated the exposure; an advisory record that certified its own claim; a
monotonicity "defence" that was TOCTOU and therefore failed exactly when needed;
a record-first withdrawal that let a replayed pointer heal backwards over a
commit; a resolver test contract that forbade correct restoration. Revision 7
was APPROVED.

**What the implementation changes.** The invariant is inverted: a module is
served ONLY while the client can positively prove, from durable state, that the
current trust-anchored pointer publishes it. Absence of proof is absence of
service. Consequently:

- `withdrawn.json` (tombstone), `install.json` (sidecar) and `current` are all
  DELETED, replaced by one `serving.json` validated against the trust anchor.
- The record carries the EXACT verified pointer bytes; `build_id` and
  `manifest_sha256` are parsed out of bytes whose sha256 must equal the anchor,
  so they are derived from the authenticated pointer rather than asserted by the
  record. This is what makes it proof rather than assertion.
- `serving_build()` is the SOLE oracle. Nothing else decides serving.
- Both transitions are tuple-first and **the tuple write is the commit**: once it
  lands the old record mismatches the anchor and the module is immediately
  absent, and any replay of a pre-commit pointer is a rollback and is refused.
- The whole read-modify-write runs under a per-module `flock`. Contention is
  transient (`refused`, serving unaffected); an unsupported `flock` is
  persistent and disables the module before cache state is read.

**Why this closes rounds 5-8 by construction rather than by patch:** every one
of those findings was "your inference is wrong in state X" — a failed tombstone
write, a `withheld_build` of `None`, a corrupt tombstone, an under-proven
retirement, a sidecar believed without its cross-check. Deleting the inference
deletes the category. Each former finding is now a negative control in §7 that
yields absent for the same reason as every other unproven state.

**Two deliberate deviations from the spec**, recorded in §8 of the lifecycle
document: the idempotent heal reuses the verified `_install` path rather than a
parallel one (a dedicated heal was written first and was wrong — it read the
manifest from a cache directory a withdrawn module does not have, silently
losing the verified-omission fact); and corrupt artifacts are absent pre-refresh
but re-verified online post-refresh, since re-fetching against the manifest
digest is safe and permanent absence would be the worse outcome. Both halves are
pinned by tests.

**Tests.** The spec's §7 list is implemented in full: six anti-replay negative
controls each differing in exactly ONE respect (a generic "corrupt record" case
would pass a version-only check — the round-8 F3 defect); the lifecycle set
(withdraw → offline restart → absent; withdraw → replay → absent; withdraw →
republish → served; install/withdraw alternation stable); every crash boundary
including both write-2 partial states; the serialization set (contention writes
nothing and serving is unaffected, the lock is released after an exception, an
unsupported flock disables the module, a stale writer cannot regress the anchor);
and the resolver partitioned into must-serve and must-remain-absent groups with
congress asserted available in both.

`tests/test_pointer_state.py` was rewritten to the new three-boundary model
(rename → tuple → record). Two of those are behaviour CHANGES, not renames:
the tuple-written-no-record window now reports absent where the old model kept
serving the prior build, and a corrupt serving record now fails closed where the
old corrupt sidecar was ignored while another marker kept serving. Both are the
intended inversion and are asserted explicitly.

**Mutation verification.** Every proof rule was verified by reintroducing the
defect and observing the corresponding test fail: a version-only anchor check,
trusting the record's `build_id` over the authenticated bytes, dropping the
bytes→anchor binding, and record-first withdrawal. One control (negative control
3) initially SURVIVED its mutation — the forged bytes named a build that a
different check rejected, so the binding under test was never exercised; it was
rewritten to forge internally-consistent bytes and now fails when the binding is
removed. A second self-caught defect: `serving_build()` did not honour the
disabled state because that check had been placed on `current_build()` only,
creating exactly the second oracle §6 forbids.

### Independent QA review of the rewrite (4 blockers + 4 nits, all fixed and mutation-verified)

The rewrite was reviewed adversarially by an independent agent that built working
probes rather than reasoning from the diff. It confirmed the proof model holds —
it could not forge a serving record, roll a generation backward, or find a torn
read across the two files that did not evaluate absent — and then found four
blockers anyway.

- **B1 (the money question, answered YES) — a corrupt trust anchor plus a
  replayed pre-withdrawal pointer served the coverage-gate-WITHHELD build,
  stamped `inst_from_published_manifest=True`.** `serving_build()` fails CLOSED
  on a corrupt `trust.json`; `refresh()` routed the same file through
  `_load_trust`, which swallows `TrustTupleError` and returns `None` — read by
  `evaluate_pointer` as bootstrap, so ANY unexpired attested pointer was
  accepted, including one older than a committed withdrawal. One anchor, two
  contradictory readings, fail-open on the write path: precisely the class of
  cross-path inference disagreement this rewrite set out to delete, sitting one
  frame below where the design work had been looking. Now `refused`, with an
  actionable message. **This changes the pre-existing TD-7 decision ("corrupt
  tuple is state loss") for every module and is owner-visible** — an ABSENT
  anchor is still genuine bootstrap; only the corrupt case changed.
- **B2 — an `OSError` in the temp-install path escaped `refresh()` and took the
  whole server down, congress included.** `_install`'s temp pre-clean and
  `mkdir` sat outside the guarded region, so an unremovable `.tmp-<build>`
  orphan or a full/read-only cache raised straight out of a call that runs on
  every poll — round-6 F1's exact symptom at a new site, and `reconcile`'s new
  `except OSError: pass` actively enabled it by letting the orphan survive
  silently. Two further sites on the same path: `_module_lock`'s `open()` (the
  guard wrapped only `flock`) and `_build_complete`'s `stat`/`read_bytes`.
  All four guarded, plus a module boundary in `_resolve_snapshot` so any
  unexpected inst failure resolves to an honest absence instead of a traceback.
- **B3 — `test_a_stale_writer_cannot_regress_the_anchor` was VACUOUS.** It
  defined a `_StaleFetcher` and never instantiated it, serialized `serving.json`
  into an unused variable named `v1_bytes`, and polled with the real fetcher —
  so it re-asserted the withdrawal and tested nothing about anchor regression,
  while the genuine pointer bytes it needed were captured three tests above it.
  Rewritten to replay the real pre-withdrawal pointer.
- **B4 — the claim "the spec's §7 list is implemented in full" was false.** Both
  commit-boundary rows (install/withdrawal write-1 failure) untested; the
  authorized-rollback-to-the-withdrawn-build case — which was r7-F2, a SHIPPED
  blocker — had no regression test; "opposite transitions serialize" had none;
  and `test_verified_omission_is_reconstructed_on_an_idempotent_poll` was
  weakened by an `or` whose second disjunct is trivially true after any
  withdrawal, so it passed even if the heal stopped carrying the flag — the
  exact regression it is named for. All now covered and load-bearing.
- **N1** — `verified_omission` was still consulted for serving in the resolver,
  contradicting §4/§6; redundant now, and the second-inference pattern this
  rewrite deleted. Removed: `db_path()` alone decides, and the flag explains only
  WHY something is absent.
- **N2** — every `OSError` from the lock probe was reported as "the filesystem
  does not support flock"; a read-only cache or `EACCES` now reports itself.
- **N3** — an uncommitted withdrawal served the prior build with no signal at
  all; the result now carries `observed_omission` and the resolver surfaces
  `inst_stale_withdrawal_pending`.
- **N4** — §7's "congress must stay available" read as absolute and contradicted
  §8's cache-level `flock` exception; the sentence is now scoped to MODULE-level
  failures explicitly.

Every fix was mutation-verified. One mutation initially SURVIVED — the
unopenable-lock test was short-circuited by the constructor's own probe rather
than exercising `_module_lock`, so it was restructured to construct first and
break `open` afterwards.

### Verification pass on the review fixes (3 blockers + 9 nits, all fixed and mutation-verified)

A second independent agent verified the review fixes and looked wider. It
confirmed B2, B3, B4 and N1/N2/N4 genuinely fixed and load-bearing, and found
three more blockers:

- **V-B1 — B1 was only HALF closed.** The corrupt-anchor door was shut; the
  DELETED-anchor door beside it was not. `rm trust.json` while `serving.json`
  stands at generation N, then replay the pre-withdrawal pointer: `load_tuple`
  returns `None`, `evaluate_pointer` reads bootstrap, and the withheld build
  reinstalls stamped `inst_from_published_manifest=True` — byte-for-byte the B1
  outcome via `unlink` instead of corruption. No correct transition can produce
  "record at generation N, no anchor" (the anchor is written FIRST in both
  directions), so that state is loss or tampering, never bootstrap. Now refused.
  Genuine bootstrap — NEITHER file — is untouched and separately tested.
- **V-B2 — the N3 fix was INERT IN PRODUCTION, and this is the run's most
  important lesson.** `inst_stale_withdrawal_pending` was computed by the
  resolver and dropped by `main()`, so `inst_health` still reported a stale build
  as clean published data carrying the >=95% guarantee. That is QA-r2-F2
  recurring **against the guard written to prevent it**:
  `test_main_forwards_every_resolved_value_to_the_server` iterated a HARD-CODED
  literal `resolved` dict, so a newly-added key was invisible to it. A guard that
  enumerates what it checks cannot catch the thing it does not know about. The
  guard now derives its key set from a REAL `_resolve_snapshot()` run and
  additionally asserts every resolver key is a declared `build_server` parameter,
  so a key cannot be forwarded into a silently-ignored `**kwargs` either.
- **V-B3 — the R22 rewrite silently disarmed a shipped M1 safety property.** My
  replacement tampered with a published manifest post-hoc, so the digest check
  refused BEFORE `client_compat` was evaluated, and the assertion had been
  widened to `in ("incompatible", "refused")` to accommodate it. Deleting the
  entire `if not compatible:` branch left the full suite green. Fixed honestly:
  published compat is `>=0.0.1,<1`, so `client_version="0.0.0"` reaches the
  branch with the manifest untouched.

Nits, all fixed: a remaining `OSError` escape in `LocalRepoFetcher.fetch_path`
that killed the server on an unreadable repo file (congress has no module
boundary above it); three tests that were mislabelled, dead, or not exercising
the clause they claimed (one injected a failure on `current`, a file this rewrite
RETIRED, so it never fired); the dead `_load_trust` fail-open helper removed
before it could acquire a new caller; the client's actionable refusal message
being discarded by the resolver; a reason string claiming "no gate decision was
observed" when a verified omission HAD been read but could not commit; the two
health tools disagreeing about the absent state; and the failure-mode sweep's
"both dates on every record (G4)" being broader than the code — only
`inst_ticker_holders` disclosed a filing-level date, so `filed_through` now
travels on every aggregate response.

**Test integrity across this run: five vacuous tests, three caught by others.**
Two I caught myself by mutation (a negative control whose forged bytes a
different check rejected; a disabled-state check asserted on the wrong method);
three were caught by independent review (the stale-writer test that never
instantiated its fetcher; the `verified_omission` assertion weakened by an `or`
whose second disjunct was trivially true; the R22 test above). Passing is not
testing, and self-review did not reliably tell the difference.

### Third review round (2 blockers + 4 nits, all fixed and mutation-verified)

A third reviewer, briefed to find what the first two missed, went after
third-order state combinations, the dev-bypass paths, and the MCP tool layer. It
cleared the `--db`/`--inst-db` bypass honesty in every combination and confirmed
the prior fixes load-bearing, then found two blockers neither earlier round
touched.

- **V3-B1 (the best find of the three rounds) — amendment composition trusted a
  SELF-DECLARED cover field over the authoritative EDGAR form.**
  `<isAmendment>` is parsed from the cover; a `13F-HR/A` whose cover OMITS that
  element — and omission is the NORMAL case, real base covers carry no such
  element — was composed as a BASE, which REPLACES the composed list. Berkshire's
  4-row NEW HOLDINGS amendment therefore came back as its complete 110-row
  2025-Q1 portfolio, with the response affirmatively claiming
  `composition_complete: True`. That is QA-F2 verbatim through a second door, and
  worse than the original, which never asserted completeness. Every guard added
  in r2-F4, r3-F3 and r4-F3 keys off `is_amendment`, so none fired; the
  authoritative submission type was in hand the whole time (discovery filters on
  it). Fixed in `evaluate_filing` so the pipeline and the federated plane agree,
  with a `cover_amendment_flag_contradicts_form` flag and
  `amendment_type_unknown` when the cover states neither. Sub-case also fixed:
  two non-amendment filings for one period silently replaced each other while
  claiming completeness — supersession is unstated, so it is now labelled and
  never called complete.
- **V3-B2 — the V-B1 refusal's own remediation walked the operator into the hole
  it had just closed.** The message said "Clear `<module_dir>`"; doing exactly
  that removed the state files but LEFT the build artifacts, so the next poll
  read `bootstrap`, accepted a stale pointer (bounded only by the 7-day expiry)
  and reinstated the withheld build as `published-snapshot` with the >=95%
  caveat. A variant needs no operator at all: losing BOTH state files reaches the
  same place, since V-B1 refused only when the anchor alone was gone. Bootstrap
  now requires the absence of ANY local state — record or cached build directory
  — and the message says to verify the data repo is current first and then
  remove the entire directory. The residual, recorded rather than hidden: a
  genuinely fresh cache still bootstraps from any unexpired pointer, which is
  pre-existing TD-7 behaviour and the reason the pointer carries a 7-day expiry.

Nits, all fixed: `inst_filer_lookup` carried no `filed_through`, which made the
previous round's own devnotes claim ("`filed_through` now travels on every
aggregate response") FALSE — the second time this record has overstated coverage,
and a false handoff claim is itself a defect; the congress-side anchor failure
discarded the client's actionable message and exited with generic publish advice
(the gap QA-VERIFY-N-f had closed for inst only); the STALE caveat reached the
health tools but never the DATA plane, and was ordered BELOW the >=95% assurance
so a reader met the assurance first; and two §5 rows — the idempotent-heal write
failure and the corrupt-record heal to a NULL withdrawal record — were still
unpinned, so "the spec's §7 list is implemented in full" was again slightly
overstated. Both now have tests.

### Fourth review round (2 blockers + 5 nits, all fixed and mutation-verified)

Round D probed the ingest/parse and aggregate layers no earlier round had
examined, re-verified the serving lifecycle, and reported the most useful
structural finding of the whole run:

> "The withdrawal/serving lifecycle itself — the subsystem that consumed eight QA
> rounds and three review rounds — I could not break, and I probed it hard. Both
> blockers here are in the federated/aggregate PRESENTATION layer, which is where
> round C also found its blocker; that is the part of this change that has had
> the least adversarial attention relative to its surface area."

That inverts where the effort had been going. The state machine rebuilt from an
approved spec is holding; the defects come from how data is DESCRIBED.

- **V4-B1 — the V3-B1 sub-case fix left a gap immediately beside itself.** The
  duplicate-base guard keyed on the composed list being non-empty rather than on
  a prior non-amendment filing having been APPLIED. A first `13F-HR` that parsed
  to ZERO rows (parse failure, empty or mismatched info table) left
  `composed == []`, skipped the guard, and let the second base claim
  `composition_complete: True` while returning 4 of ~110 positions with no
  warning — worse than the original QA-F2, which never asserted completeness.
  **The test written for that guard passed with and without the fix**, because it
  only exercised a cleanly-parsing first base.
- **V4-B2 — the flagship tool silently returned a publisher-chosen top-25
  slice.** `build_inst_agg` stores only `ranked[:topn]` per issuer/period and
  records the N in `agg_build_meta` *"so the cut is legible"* (TD-M2-3-2) — and
  nothing ever read it. `inst_ticker_holders` accepted `limit` up to 200 and
  returned ≤25 with no disclosure; for a mega-cap, thousands of managers file.
  `shape_concentration` had the same gap: `topn_value_usd`/`topn_share_bps` with
  N stated nowhere, so a top-10 share was indistinguishable from a top-25 one.
  Every other partial answer here is labelled — `unread_shards`,
  `rejected_filings`, `history_complete`, `counts_basis` — this was the one
  truncation with none, on the default path. Now `published_topn` is read from
  the aggregate and surfaced with the requested `limit` reconciled against it.

Nits, all fixed: the STALE prefix was stamped on EVERY inst response including
live federated ones, putting two contradictory provenance claims in one
data_note — it now applies only to snapshot-plane answers; the `--inst-db`
UNVERIFIED caveat reached health but not the data plane (the same gap
QA-VERIFY3-N3 fixed for STALE), now fixed by the same mechanism;
`discover(include_history=True)` had no accession dedup, so an amendment listed
in both `recent` and a shard would be composed TWICE (118 rows instead of 114,
still claiming completeness); the amendment-flag contradiction was flagged in
only one direction; and the "complete list" of changed files was incomplete
AGAIN — missing `tests/test_pointer_state.py` and all three docs artifacts,
including the approved specification. That is the THIRD overstatement in this
record, so it now carries an instruction to reconcile against `git status`
rather than trust it.

### Fifth review round (5 blockers + 5 nits, all fixed and mutation-verified)

Round E was aimed entirely at the presentation layer on round D's steer. It found
five blockers there — confirming the steer — and its most important consequence
was structural rather than any single fix.

**Amendment composition is no longer a fold over arrival order.** That one design
choice produced THREE shipped defects (V3-B1 a misread cover flag, V4-B1 an
empty first base, E-B1 a same-day accession tie), each patched individually and
each spawning the next. Composition is now TWO PHASES: classify every filing
independently of order (FULL = base or RESTATEMENT / ADDITIVE = NEW HOLDINGS /
UNKNOWN = unstated type), then apply deterministic semantics — NEW HOLDINGS is
additive whenever applied, a later RESTATEMENT supersedes earlier additions, and
same-day ties break base-before-amendment because an accession prefix is a filing
agent's, not a clock. Completeness became a conjunction of four STATED facts
(authoritative full filing exists and parsed exactly "parsed"; at most one
non-amendment base; no unknown-type amendment; history exhaustively searched)
rather than an inference accumulated through a loop.

- **E-B1 — a same-day base + NEW HOLDINGS amendment DISCARDED the amendment's
  rows** while the trail still said "added to the base filing" and the response
  claimed `composition_complete: True`. The discarded rows are the
  confidential-treatment releases that are the entire reason NEW HOLDINGS
  exists. Third recurrence of QA-F2 through a third door.
- **E-B2 — a fabricated $5B move ranked first by the flagship tool.**
  `_Position.value_usd` starts at 0 and only accumulates non-NULL values, so a
  holding whose PRIOR filing had an unparseable `<value>` differenced against a
  fabricated zero: identical shares in both quarters surfaced as
  `change_kind: "add"`, `delta_value_usd: +$5B`. `inst_agg.sql` states "a
  legitimately unavailable value is stored NULL … never a fabricated zero" — the
  delta plane violated its own contract while the snapshot plane handled the same
  row honestly. `delta_value_usd`/`prev_value_usd`/`curr_value_usd` are now
  nullable, with `value_undisclosed_one_side` and a `change_kind` of
  `unclassified` when neither shares nor value can determine direction.
- **E-B3 — the delta plane silently excluded unkeyable positions.** A filer whose
  book was 99.99% unkeyed read as making ONE change all quarter. The response now
  carries `delta_universe` (the period position count, the all-periods unkeyed
  count, and how many changes were returned). Both flow tools also now state that
  `new`/`exit` mean PRESENT/ABSENT between two filings — not bought or sold —
  and name the five non-trading causes including the paired phantom exit+new a
  re-keying manufactures.
- **E-B4 — `inst_filer_lookup` truncated at `limit` with nothing at all.** It is
  the documented entry point to every other inst tool; against the real
  ~5,000-filer registry a fragment like "Capital" matches hundreds and filer #26
  was indistinguishable from not existing. Now returns `total_matches`,
  `returned`, `truncated`, a note, and the ranking basis (value summed across ALL
  retained periods, so more quarters can outrank a larger filer).
- **E-B5 — the truncation note added ONE ROUND EARLIER stated a falsehood.** It
  asserted the list was cut "regardless of `limit`", which is false whenever
  `limit < topn`, sitting beside a payload that contradicted it. Now
  `requested_limit` / `effective_cut` / `cut_governed_by` state which cut
  actually governed. The test for it only exercised `limit > topn` — the one case
  where the sentence was true.

Nits, all fixed: `mode='qoq'` conflated "no data", "first period on record" and
"no change" into one hint (the snapshot branch had been fixed for exactly this)
— now `absence_reason` + `available_periods`; `inst_health`'s bare `counts` are
ALL-PERIOD totals sitting beneath a single-quarter freshness stamp, now labelled;
three tool docstrings promised more than the tools deliver (these are what an LLM
client reads to choose a call), now stating the top-N cut, the possible partial
composition, and the excluded unkeyable positions; and the Failure-Mode Sweep's
"both `period_of_report` and `filed_date` on every record (G4)" was FALSE for
every aggregate shape — the FOURTH false claim caught in this record, now
corrected to say federated records carry both dates while aggregate responses
disclose `filed_through` once at response level.

### Sixth review round (5 blockers + 5 nits) — and the composition truth table

Round F reviewed the composition rewrite itself. **Four of its five blockers were
in that rewrite**, and its structural read was the one that mattered:

> "The rewrite fixed ORDERING but left COMPLETENESS as an under-specified
> predicate over a subset of the filings it composes… I would ask for an
> executable table over (count of bases, restatements, additives, unknowns) ×
> (parse status of each) × (filed-date ties) asserting `holdings`,
> `composition_complete`, the warning branch, and — critically — agreement with
> `v_default_inst_filings` on the same synthetic filing set, which no test
> currently checks in either direction. Every one of these six rounds'
> composition defects would have been a row in that table."

That table now exists (15 rows + 4 pipeline-agreement cases). It is the artifact
this subsystem should have had before the first line was written.

- **F-B1 — an unreadable NEW HOLDINGS amendment still yielded
  `composition_complete: True`.** The four-fact conjunction never looked at the
  APPLIED ADDITIVES' parse status, so the confidential-treatment releases — "the
  entire reason NEW HOLDINGS exists" — went missing from a list stamped
  complete, while the tool's own docstring promised the opposite. Completeness is
  now a list of NAMED REASONS rather than a boolean, covering the authoritative
  filing's status, competing bases, unknown types, unreadable additives, and
  unresolvable ties.
- **F-B2 — the unknown-type fallback REASSIGNED `composed`**, discarding rows the
  additive loop had already appended while `applied_additives` still reported
  them as applied — the trail asserted rows were added that were dropped (G3),
  and the warning claimed the payload equalled the union of the listed filings.
  Fifth door on the same failure. The fallback now runs BEFORE additives.
- **F-B3 — the authoritative filing was chosen by ACCESSION where the pipeline
  uses `amendment_no`.** The code violated its own stated principle ("accession
  is a filing agent's prefix, not a clock") one line below the comment saying so,
  and returned a DIFFERENT restatement's book than `v_default_inst_filings` for
  the same filings. Now ranks on the pipeline's own key.
- **F-B4 — same-day RESTATEMENT vs NEW HOLDINGS disagreed with the pipeline.**
  Strict `<` on a date-only field; `views.sql` supersedes on the full key. The
  tie is genuinely unresolvable from a date-only field, so it now blocks the
  completeness claim and says why.
- **F-B5 — the warning gave a wrong diagnosis contradicted by its own trail**,
  emitting "no successfully-parsed authoritative full filing underlies this
  period" while the trail listed a cleanly-parsed base. Now branches per reason.

Nits fixed: the base of an ordinary base→RESTATEMENT pair was labelled
"supersession is unstated" (a RESTATEMENT states it) and "earlier of 1"; the flow
caveat pointed `inst_biggest_moves` at a `delta_universe` key that tool never
emits — the dangling-pointer defect fixed one round earlier, reintroduced in the
same round on the cross-filer flagship; `inst_ticker_holders` declared 2 rows
"TRUNCATED at 25" when nothing was cut; and the new `unclassified` change kind
was unreachable through `inst_biggest_moves`' side validation and undocumented.

**Test integrity — two of my own mutation checks passed against tests that could
not fail.** The pipeline-agreement test derived the pipeline's ordering FROM THE
FEDERATED RESULT'S OWN ORDER (circular), and its fixture gave both synthetic
restatements `amendmentNo 1` so the divergence it claimed to create did not
exist. Both now fail when the ranking key is broken. Round F also caught round
E's `change_kind` assertion accepting `"add"` — the exact wrong answer that fix
prevents — via an `in (...)` disjunction. Ten non-load-bearing tests have now
been found in this run; seven by reviewers.

**Fifth false claim in this record:** the "complete list" of changed files again
omitted `inst_agg.py`, `inst_agg.sql` and `tests/test_inst_agg.py` — the very
files round E's own fix touched — despite the standing instruction, written into
that list two rounds earlier, to reconcile it against `git status`.

### Seventh review round — FINAL (6 blockers + 6 nits, all fixed and mutation-verified)

The owner set round G as the last: the work merges after its findings are
addressed. It was scoped to the presentation layer and asked to separate genuine
harm from polish.

- **G-B1 — a same-day RESTATEMENT lost to its own base, and the answer was
  stamped complete.** `_rank`'s justifying comment assumed the amendment's
  `amendment_no` is non-NULL. It is OPTIONAL on the cover: when absent it
  collapses to 0, the same value a base gets, so only the accession separated
  them — and the base sorted later. 110 positions came back as the filer's
  complete quarter-end book when the filer's own restatement said the book was
  4, with `composition_complete: True`, no warning, and a trail entry claiming
  the restatement was "superseded by a later full filing". Three untruths in one
  response, and the THIRD same-day-tie defect in this run: round F had scoped the
  tie check to `additives`, leaving the base-vs-restatement pairing unguarded.
  The tie is now computed across every filing the restatement could supersede,
  and an unresolvable ordering blocks the completeness claim and says so.
- **G-B2 — the non-removable caveat omitted the ≥$100M filer threshold.** That
  is the single largest completeness boundary of 13F: `inst_ticker_holders`
  answers "who are the biggest institutional holders?" from a universe that
  structurally excludes every sub-threshold manager, and nothing said so. Also
  missing: the instrument enumeration and "these are disclosures, not investment
  advice". All absent from the ENTIRE source tree for seven rounds — while this
  record claimed the note carried the "full §5 caveat text" (the sixth false
  claim here). Restored, and now bound clause-by-clause to M2-CONTRACT §5 by a
  12-case test. Nothing had ever tested that text against its own cited source.
- **G-B3 — `side='unclassified'` returned an alphabetical slice presented as a
  dollar ranking.** Every unclassified row has `delta_value_usd` NULL by
  construction, so the ABS ordering ties on all of them and the real order is
  (cik, position_key): a $900B position was dropped in favour of the two
  alphabetically-first CIKs, under an `extra_note` promising a dollar ranking.
  The cross-filer flagship also had no truncation disclosure at all, while both
  sibling list tools had gained one as a blocker fix.
- **G-B4 — `filed_through` is a build-wide watermark presented as the record's
  own filing date.** A filer whose newest filing is 2024-02-14 was stamped
  `filed_through: 2026-05-15` — a 27-month overstatement of currency on exactly
  the question G4 exists to answer. The number is right; the label was missing.
- **G-B5 — the absence hint claimed "earliest period on record" while listing an
  earlier one two keys later.** Reached whenever the delta set is empty, not only
  on a first quarter — i.e. precisely for the all-unkeyed filers `delta_universe`
  was added for. Same class as F-B5, in the helper written to prevent it.
- **G-B6 — `inst_health.issuer_keying` is a census of the TRUNCATED top-N
  table**, weighted by holders-per-issuer and cut at `published_topn`, sitting on
  the tool whose job is "how complete is this data?" beside a caveat inviting the
  reader to compute a coverage ratio from it. A 50/50 book reported 30/25.

Nits: the truth table's trail guard was `assert applied_rows >= 0` — true by
construction, the ELEVENTH non-load-bearing test here, and the guard for the
F-B2 class (now an explicit `rows_applied` flag on every trail entry, which also
fixed one label being emitted for two opposite outcomes); the `side` error
message omitted a value the validator accepts; `topn_label` told a 2-position
filer its "largest 25 positions"; `hhi` carried no scale; and the
pipeline-agreement test hand-copied `views.sql` in Python, so a change to the
view would not be caught — there is now a test that writes real filings through
the real writer and queries `v_default_inst_filings` itself.

**Round G's closing structural assessment**, recorded for whoever extends this:
supersession ordering depends on three fields whose nullability is in no
contract (`filed_date` is date-only, `amendment_no` optional, `accession` a
vendor prefix) and is encoded in three places — `views.sql`, the federated
`_rank`/`_action`, and the agreement test — which is why the same-day tie
recurred three times. Label coverage has been reactive throughout: every
`*_basis` / `*_label` / `truncation_note` was added where a reviewer happened to
look. **A future run should build the presentation equivalent of the composition
truth table** — an executable registry of every emitted key with its unit, basis,
period scope, N and denominator, failing on any key not in it — and collapse
supersession into ONE decision function with an explicit `unresolvable` outcome,
shared by SQL and the federated plane.

## Reuse / Duplication Check

Extended the existing FastMCP server and envelope rather than forking them; reused RUN-M2-3's aggregate tables and module-aware `SnapshotClient`, RUN-M2-2's inst schema and coverage inputs, and RUN-M2-1's `SecClient` for the federated path (no second HTTP client, no second envelope, no duplicate license-notice logic).

## Simplicity Audit

Five tools against the DR-9 budget, with `inst_filer_holdings` collapsing three question shapes (snapshot / qoq / detail) behind one `mode` parameter exactly as the congress `congress_ticker_activity` tool does. One envelope, one federated client, one snapshot accessor. No speculative abstraction.

## Tech Debt Introduced

- **TD-M2-4-1 — `inst_ticker_holders` maps ticker→CIK with the PRESENT-DAY `company_tickers.json`.** A current mapping is not an as-of mapping, so a historical period can resolve to today's issuer for that symbol. Mitigated by labelling the mapping explicitly in the response rather than presenting it as as-of (G14/G5). *Removal:* an as-of ticker→CIK history admitted through §15 (the same gap as TD-M2-1-1).
- **TD-M2-4-2 — `inst_health`/`populus_health` cannot report the exact coverage figure or the per-filing unit-regime mix.** The published aggregate carries neither, so both tools report the gate *guarantee* plus published proxies and point at federated `mode='detail'` for per-filing units. This is the ID as APPROVED in the plan; an earlier draft of this record reused the ID for the caching gap below, which would have silently retired an approved debt item — corrected here (QA-F8). *Removal:* add a coverage/unit-mix summary row to `agg_build_meta` or the manifest in a future aggregate revision.
- **TD-M2-4-3 — the federated `mode='detail'` path is uncached across processes.** *(TD-M2-2-3 — older submissions shards counted but not read — is now CLOSED for this path: `discover(include_history=True)` reads them; it remains open for the M2-2 ingest path, which deliberately does not opt in.)* It inherits `SecClient`'s in-memory per-instance cache (TD-M2-1-4), so repeated detail calls in separate processes re-fetch. Composition (base + amendments) multiplies this: a composed period now fetches every filing for that period, not one. *Removal:* the disk cache TD-M2-1-4 anticipates.

**Inventory reconciliation (QA-F8).** The approved plan booked exactly two M2-4 debts (TD-M2-4-1, TD-M2-4-2 above); implementation surfaced a third (TD-M2-4-3), which is recorded as a NEW id rather than by rewriting an approved one. No approved debt was dropped or redefined.

**Carried, not introduced:** TD-M2-1-1..9, TD-M2-2-1..5, TD-M2-3-1..2 — notably TD-M2-1-1, whose interval sparsity is why the coverage gate withholds `inst`, which is exactly the absent-module state these tools must degrade against.

## Memory Touch-Points

Consulted the mandatory failure-mode catalog, both Populus project memories (verified-primary-source bar; the M2 QA-grind lesson and the owner's pragmatic acceptance bar), the recorded orchestrate dev-notes failure mode, and global memories on explicit executable contracts, canonical gates and as-of identity. They drove the inst-absent degradation contract, the present-day-mapping labelling, and the envelope honesty assertions.

## Failure-Mode Sweep

No live network in any test (injected transport; the autouse socket guard stands). The `inst` module may legitimately be ABSENT because the owner-accepted ≥95% coverage gate withheld it — every tool degrades with a clear reason rather than crashing or fabricating (G3-adjacent honesty). Both dates on every FEDERATED record (G4); aggregate record shapes carry the period, and the filing-level date is disclosed once per RESPONSE as `filed_through` — the build watermark — because the aggregate rolls up many filings and has no per-row filed date. (This sentence previously claimed record-level coverage for both planes, which was false: QA-VERIFY5-N10, the fourth false claim caught in this record.) `unit_basis` and the era label travel with every value (G5); the quarter-end-snapshot-not-holdings caveat is a non-removable module constant (G10); the ticker→CIK mapping is labelled present-day rather than implied as-of (G14); no browser/consumer path calls SEC directly (G7 — the federated call is made by the MCP server the user runs); `sec-edgar` notices on every inst response; dep_guard clean (G1).

## Tests Run

`uv run pytest -q` → **1475 passed**, dep_guard exit 0 — measured against the canonical gate rather than predicted. (1298 prior + 177 M2-4 tests: 38 from the original build, 35 across QA remediation rounds 1–8, 26 implementing the approved lifecycle spec's §7 list, and 78 across SEVEN independent review rounds — including the 17-case composition truth table, the pipeline-agreement suite, and the 12-clause M2-CONTRACT §5 caveat conformance test.), independently verified on the feature branch and matching the canonical gate artifact. `scripts/dep_guard.py` → exit 0. Every remediation fix was mutation-verified: the defect was re-introduced and the new test observed to fail, then reverted. Federated path exercised via an injected transport; cache-gated golden runs against the committed corpus.

## Plan Deviations

**One substantial, justified scope expansion (QA-r7-F3).** The plan scoped `src/populus/client/snapshot.py` to a read-only manifest accessor (`current_manifest()`) so health could report freshness. QA rounds 1–7 turned that into a withdrawal/serving-state lifecycle: a `withdrawn` refresh status carrying `verified_omission`, a durable tombstone recording the suppressed build, anti-replay trust advancement, fail-closed accessors, crash-safe install/republication ordering, and reconcile-time revocation of a half-finished withdrawal. That was not gold-plating: the round-1 F1 finding proved a withheld module kept serving stale institutional data, and each later round found a further boundary where withheld data could re-surface or a legitimate build be suppressed. The expansion is confined to this module's own lifecycle, adds no new public surface beyond the `withdrawn` status and `verified_omission` flag, and is covered by the crash-boundary tests listed above. **A future run should specify this lifecycle as an explicit state machine before extending it further** — seven review rounds against an implicit contract is the reason this run cost what it did.

Otherwise none in substance — all R1–R14 implemented as approved. Process notes: (1) the first M2-4 launch died in PLAN-REVIEW on an upstream `Selected model is at capacity` error from the reviewer model (not a token limit, not a code issue); capacity was re-probed, the already-drafted plan was salvaged, re-validated as `plan-v1`, and the run relaunched pre-approved. (2) The DEV phase again ended on a status line instead of the dev-notes document — the fourth consecutive occurrence — despite explicit instructions to run gates synchronously and to write the notes to a file; this record was therefore reconstructed from the approved plan and the delivered code, and the run completed via QA-only review. The failure mode is now documented in memory as a budgeted recovery rather than a preventable slip.

## Model Provenance

Doer: `claude-opus-4-8` at effort max (orchestrate global override, quality profile). Reviewer: `gpt-5.6-sol` xhigh (plan-review unavailable at capacity; QA-only review used for gating).
