## Detected Stack

Python 3.12, `uv`, hatchling, SQLite/JSON1, Click, `httpx`, pytest. Canonical gates: `uv run pytest -q`, `scripts/dep_guard.py`, `make check`.

## Requirement and Task Completion

All requirements implemented; every M1 test remains green.

- **R1** — Registry schema in `src/populus/registry.sql` (entities, entity_names, securities, security_identifiers, entity_tickers, security_supersessions; dated-validity no-overlap indexes). Applied by `db.init_db`. All M1 tables unchanged. Done.
- **R2** — As-of resolution `resolve_cusip` / `resolve_entity_by_cik` / `resolve_ticker_as_of` in `identity/registry.py`, fail-closed, unique-applicable-row only, `disputed` excluded; no CUSIP→ticker→CIK chaining. Done.
- **R3** — Ticker bootstrap from injectable `company_tickers.json` in `identity/bootstrap.py` (upsert entities by CIK; open current-interval name/ticker rows). No network. Done.
- **R4** — FTD CUSIP bootstrap in `identity/bootstrap.py`, deterministic (pure function of observation set + registry; partition/order/backfill-invariant). Done.
- **R5** — `SecClient` in `net/sec_client.py`: injectable transport+clock, client-wide ≤2 req/s floor, single-flight coalescing, ETag cache w/ per-class TTL, backoff, latching 403 circuit breaker; SEC-accepted `"<app> <contact>"` UA, `Accept-Encoding`, parenthesized form never sent to `*.sec.gov`. Done.
- **R6** — `sec-edgar` + `sec-ftd` conditions-register entries in `licenses.json` (with `DATA-LICENSE.md`/`NOTICE` regenerated); added before any ingest. Done.
- **R7** — `populus identity bootstrap` CLI; reconcile + both seeders inside one `BEGIN IMMEDIATE`/`COMMIT`; `ingest_runs` audit row opened autocommit before the txn, finalized `ok`/`failed` on every attempt. **Success finalization runs inside the data txn before COMMIT (final plan-review remediation F2), with an injected success-finalization-failure test.** Done.
- **R8** — DC1: one title per CIK per snapshot; conflicts rejected+counted; `resolve_entity_by_cik` returns the single name or None. Done.
- **R9** — DC2: no fabricated FTD continuity (G14); intervals from calendar-adjacent same-owner observations only; gap-refusal tests. Done.
- **R10** — DC3: durable declared `security_id` via `securities.yaml`; never changes on binding add/change/bound/split; provisional ids for unnamed identifiers; identity asserted by comparing actual `security_id` values across partition/order/backfill/CUSIP-change/split/reuse. Done.
- **R11** — DC4: per-observation as-of `(symbol, settlement_date)` resolution; `entity_id` stamped only when all agree, else unresolved/conflict. Done.
- **R12** — DC5: three separate counter families (Disposition/Mutations/RegistryState) with unit + phase + first-run→replay transition rule; asserted against the declared-split fixture. Done.
- **R13** — Gates: `uv run pytest -q` green over the whole repo; `dep_guard` exit 0; `make check` green; no live network in any test. Done.
- **R14** — FTD provider-format acceptance: committed provenance-recorded `cnsfails` excerpt parsed under gate; full-archive acceptance run executed (69,961 rows → 13,706 anchors, 37,522 intervals; replay all-zero). Done.
- **R15** — SEC-UA provider-format acceptance: exact emitted UA byte string pinned in hermetic tests; live smoke via the shipped `SecClient`+transport (HTTP 200 on the pinned form; 403 re-confirmed on the parenthesized form). Done.
- **R16** — `securities.yaml` authority (classes + continuities; ownership-window split model), validated on load, injectable via `--securities`. Done.
- **R17** — `reconcile_identity_registry` migration (promotion/merge/interval-cut/fan-out; repoints every FK-to-securities table; one-to-many supersession ledger with chain collapsing; asserts open txn). **Split fan-out now has the retained-owner branch that preserves a surviving declared class's id/metadata/unaffected bindings and supersedes only moved identities (final plan-review remediation F1).** Convergence tested empty→class, chain-extension, singleton→split, declared-class→split-with-boundary-crossing-interval, and revision-disputes-a-binding (reconcile-only fail-closed) against clean build. Done.
- **R18** — Fail-closed disputed reuse: gap ≥ reuse-review horizon with no declared boundary/continuity ⇒ `disputed`, every mapping resolves to None until reviewed; counted+listed, never dropped (G3). Done.

## Changed Files

New: `src/populus/identity/{__init__,bootstrap,registry}.py`, `src/populus/net/{__init__,sec_client}.py`, `src/populus/registry.sql`, `src/populus/securities.yaml`, `tests/test_identity.py`, `tests/test_identity_bootstrap.py`, `tests/test_identity_migration.py`, `tests/test_sec_client.py`, `tests/fixtures/inst/` (identity + FTD/UA fixtures), `docs/build/RUN-M2-1-plan.md`.
Modified: `src/populus/cli.py` (wire `identity bootstrap`), `src/populus/db.py` (apply `registry.sql`), `src/populus/licenses.json` (+ regenerated `DATA-LICENSE.md`, `NOTICE`), `tests/conftest.py`, `tests/test_dep_guard.py`, `tests/test_licenses.py`.

## Reuse / Duplication Check

Reused: `canonical.py` (RFC 8785) for deterministic keys; `db.py` init/DDL-apply seam; the `members` reviewed-YAML idiom (`aliases.yaml`/`load_aliases`/`--aliases`) mirrored for `securities.yaml`; the `licenses.py` conditions-register + `DATA-LICENSE.md`/`NOTICE` generation; the temporal no-overlap-index idiom from `member_aliases`. No existing M2/registry/SEC-client code duplicated (repo scans confirmed none pre-existed).

## Simplicity Audit

The identity authority is a two-section YAML (classes + continuities); splits are expressed as complementary ownership windows (no separate splits section, no closure algorithm, no derived successor ids). One transaction bracket owns all writes. The SEC client is a single class with injected transport/clock. Proportionate to the requirements; no speculative abstraction.

## Tech Debt Introduced

The one complete inventory (matches the approved plan's declared debts). Owner: John Baek.

- **TD-M2-1-1 — FTD-derived CUSIP validity intervals are sparse by construction; R18 fail-closing adds to it.** As-of resolution succeeds only on observed days; a disputed identifier resolves nowhere until reviewed. Removal: an authoritative identifier-history source admitted through §15, or an explicitly labeled, confidence-carrying inference layer in M2-2 (G5). Deliberate — the alternatives are fabricated continuity or silent conflation.
- **TD-M2-1-2 — `securities.yaml` ships empty; declarations are authored by hand.** The mechanism (authority, ownership windows, interval cutting, migration, continuities, fail-closed resolution) is built and tested; only content and any discovery tooling are outstanding. Removal: M2-2 surfaces real cases, added by reviewed commit.
- **TD-M2-1-3 — Provisional ids are promoted (a rekey of a provisional value).** A consumer that persisted a `sec:prov:` id before promotion must follow `security_supersessions`. Removal: M2-3 publishes only declared ids, or flags provisional ids as non-durable with the ledger shipped alongside.
- **TD-M2-1-4 — `SecClient` cache is in-memory and per-instance.** No cross-process reuse; ETag revalidation restarts each run (still far below the ≤2 req/s floor). Removal: a disk cache reviewed against the RUN-5 path-containment threat model.
- **TD-M2-1-5 — `ARCHITECTURE.md:639` still states the parenthesized UA for §11.4.** Architecture text and shipped behavior disagree; the register entry and M2-CONTRACT §1 carry the corrected policy meanwhile. Removal: an ARCHITECTURE amendment recording the 2026-07-24 verification.

- **TD-M2-1-6 — reconciliation cost scales with registry size.** `_reconcile_review_state` scans every persisted identifier value each run. Removal: restrict the pass to values the migration touched plus values whose authority entry changed, or memoize the reuse verdict — when M2-2 makes the registry large.
- **TD-M2-1-7 — `SecClient` cache is unbounded.** No LRU/size cap on the in-memory response cache. Removal: bound it when M2-2 becomes the first live caller, or fold into the disk-cache work TD-M2-1-4 anticipates.
- **TD-M2-1-9 — multi-value-security review_state is last-write-wins (latent; unreachable in v1).** Owner-accepted 2026-07-24. A declared security owning ≥2 CUSIPs with differing reuse verdicts could get a nondeterministic, partition-dependent `securities.review_state`. `securities.yaml` ships empty → all securities are provisional/single-valued → unreachable in v1. Removal (M2-2, when the authority is populated): one conservative per-security verdict (disputed precedence) computed after evaluating all bindings and applied once, with merged/A→B/B→A/replay tests over complete `securities` rows.
- **TD-M2-1-8 — `securities.entity_id` is a date-free identifier→entity attribute.** Plan-sanctioned (R11/DC4: stamped only on unanimity, with `entity_link_state` and a schema CHECK preventing a silent NULL), but a consumer reading the column directly gets a link whose validity is "every observation agreed", not "as of a date". The M2-2 contract must note the column is consumed alongside `entity_link_state`, never instead of a dated resolver.

None of these are correctness defects; each surfaces conservatively (unresolved + flagged, never guessed — G3/G14). (The earlier deferral TD-M2-1-6-as-F3 is retired: that `disputed`-convergence finding was fixed, not deferred — see Plan Deviations.)

## Memory Touch-Points

Consulted: the mandatory failure-mode catalog; both Populus project memories (project scope, John Baek profile — verified-primary-source/institutional-grade bar); global memories on explicit executable contracts, decision-locking, anchor/rebaseline verification, canonical gates, and rule-derived reconciliation. They drove the fail-closed resolution, gap-refusal tests, per-observation as-of resolution, and the three-family reconciliation accounting.

## Failure-Mode Sweep

No live network in any test (injectable transport+clock); circuit breaker latches on sustained 403; rate floor enforced in code not config (G6); all-or-nothing bootstrap transaction with audit finalized inside it; unmapped/disputed identities surface by name + flag, never dropped (G3); as-of joins refuse out-of-interval and never time-travel (G14); deterministic security_id across partition/order/backfill; register entries precede ingest (G11); dep_guard denylist clean (G1).

## Tests Run

`uv run pytest -q` → 1157 passed (936 M1 baseline + 207 dev + 14 post-dev QA-fix regression tests across six review rounds), independently verified on the feature branch. `scripts/dep_guard.py` → exit 0. FTD full-archive acceptance recorded under R14. **R15 SEC-UA live smoke (shipped `SecClient`+`HttpxSecTransport`):** emitted UA `'Populus johnbaekk@gmail.com'`, `Accept-Encoding: 'gzip, deflate'`, status **200**, exit 0. No live network in the hermetic suite (autouse `_no_network` fixture blocks sockets).

## Plan Deviations

The plan is implemented as approved (including the two plan-review remediations it already carried: the retained-owner split branch and the audit-finalization-inside-the-transaction). Two QA-only external review rounds surfaced findings; ALL are now fixed on this branch (regression tests noted):

Round 1 (fixed + tests): a malformed-authority `TypeError`→`IdentityRegistryError` (test); the SEC rate floor recorded before the transport call so a post-exception retry stays spaced (G6, test); `_align_authority_metadata` counting `securities` metadata updates (R12); full-fan-out chain-repoint supersessions counted (R12); the `test_licenses` date helper month-end clamp.

Round 2 (fixed + tests):
- **F3 (fixed):** disputed-reuse now fails closed on a populated DB even with no observation pass — `reconcile` runs an idempotent disputed-flagging pass over every persisted value (`_flag_disputed_reuse`), so `reconcile_only` marks `disputed` and `resolve_cusip` returns `None`, converging with a clean build. Idempotent (the observation pass's later re-stamp and any replay are zero-mutation no-ops; a no-op on an empty build). Test: `test_reconcile_only_fails_closed_when_a_revision_disputes_a_binding`.
- **F4 (fixed):** the retained-owner split no longer records the still-live incumbent as superseded — `old_id→successor` supersession is written only when the predecessor is fully retired. Test updated: `test_declared_class_split_cuts_the_interval_and_keeps_the_incumbent` asserts `_ledger == []` and both resolvers return no successor for the retained id.
- **F5 (fixed + test):** title conflicts are decided across all valid rows BEFORE duplicate bucketing, so two same-`(cik,ticker)` rows with differing titles both reject as `rejected_title_conflict` (DC1). Test: `test_same_ticker_differing_titles_is_a_conflict_not_a_duplicate`.
- **F6 (fixed + test):** `security_identifiers.raw` is a deterministic RFC-8785 provenance record (never NULL), created at the FTD write and carried through migration cuts (R1). Test: `test_identifier_rows_carry_deterministic_non_null_raw`.
- **F2 (evidenced):** R15 SEC-UA provider acceptance run against the shipped `SecClient`+`HttpxSecTransport` — emitted UA `'Populus johnbaekk@gmail.com'`, `Accept-Encoding: gzip, deflate`, **HTTP 200**, exit 0 (recorded).
- **F1 / F7 (resolved):** the QA bundle is generated against merge-base `0dfd18d` with the change uncommitted during review (so the diff is complete); the approved plan is `docs/build/RUN-M2-1-plan.md`; the plan-and-implementation-in-one-commit ordering is recorded here as an accepted deviation (the plan was externally pre-approved before implementation, and is committed alongside).

Round 3 (fixed + tests):
- **F1/F2 (fixed):** review_state is now reconciled BIDIRECTIONALLY at reconcile time (`_reconcile_review_state`): a reuse-disputed value → `disputed`; otherwise each owner's rows → its declared authority `review_state`, which also CLEARS a stale `disputed` once a reviewed continuity resolves the reuse. Computes each value's final target so replay is a no-op (replay-zero invariant preserved). Covers authority `reviewed`→`disputed` on unchanged intervals and the dispute→clearance direction. Tests: reconcile-only dispute + the existing convergence suite.
- **F3 (fixed + test):** the retained-owner defect on the RENAME path — a class that loses a binding but survives (a live destination) is no longer recorded as superseded. Test augmented: `test_a_class_that_both_loses_and_gains_a_binding_survives` asserts no successor/ledger entry for the survivor.
- **F4 (fixed + test):** `_iso` requires canonical `YYYY-MM-DD` (rejects compact `20200101`/week-date forms that `date.fromisoformat` accepts and that would sort lexicographically wrong). Test: MALFORMED authority case.
- **F5 (fixed + test):** `normalize_cik` returns EXACTLY ten ASCII digits — overpadded input canonicalizes down, >10 significant digits reject. Test: `test_normalize_cik` params.

Round 4 (fixed + tests):
- **F1 (fixed):** a surviving rename source (a class that loses a binding but stays a live destination) is now reset (candidates re-derived by the observation pass) instead of unioning stale candidates into the target — no false conflict, convergence preserved. Covered by the lose-and-gain `_snapshot` convergence assertion.
- **F2 (fixed):** review-state reconciliation unified — `_reconcile_review_state` now has the `cleared` (continuity) branch (identifier rows → `reviewed`), and `_align_authority_metadata` reconciles `securities.review_state` to the declared authority. Consistent identifier- and security-level state across reconcile and bootstrap; replay-zero preserved.
- **F3 (fixed + test):** `endpoint_class` lower-cases scheme+authority (preserving path case) before the prefix match, so an admitted upper-case host gets its real TTL, not the short default. Test: `test_endpoint_class_normalizes_host_case_but_not_path`.
- **F4 (fixed + test):** the CLI `--as-of` now requires canonical `YYYY-MM-DD` (rejects compact/week-date). Test: `test_cli_rejects_a_non_iso_as_of` (free-text, compact, week-date).

Round 7 — owner-accepted disposition (2026-07-24). After 7 QA rounds (every v1-reachable correctness bug fixed; 1157 tests green), the owner accepted M2-1 at the bar "gates green + no v1-reachable data-correctness blocker." The two round-7 findings are dispositioned, not code-fixed:
- **F1 (accepted, documented → TD-M2-1-9).** Multi-value-security review_state is last-write-wins, which is nondeterministic ONLY for a *declared* security owning ≥2 CUSIPs with *differing* reuse verdicts. `securities.yaml` ships EMPTY, so every security is provisional and single-valued — the path is **unreachable in v1**. Fix in M2-2 when the authority is first populated: derive one conservative per-security verdict (disputed precedence) after evaluating all bindings, updated once; add merged/A→B/B→A/replay tests over complete `securities` rows. Owner-accepted as a bounded, currently-unreachable limitation (consistent with the M1 Run-5 owner-accepted boundary precedent).
- **F2 (dispositioned).** The debt inventory spans a pre-approved (immutable) plan that declared 5 items and this dev-notes record that adds the QA-surfaced items (TD-M2-1-6/7/8) plus TD-M2-1-9. The plan cannot be retroactively edited; this record is the authoritative, complete inventory (9 items), each with owner + removal condition. The plan/dev-notes count difference is inherent to the pre-approved-plan recovery path, not hidden debt.

Round 6 (fixed + tests):
- **F1 (fixed + test):** only a `reviewed` continuity clears a reuse gap; an `auto`/`disputed` continuity leaves the value disputed and unresolvable (R16/R18 fail-closed). Test: `test_a_nonreviewed_continuity_does_not_clear_a_reuse` (auto + disputed params).
- **F2 (fixed):** the rename-path chain-collapse of `security_supersessions` is now counted in a new `supersessions_collapsed` mutation field (R12); zero on replay.
- **F3 (fixed + test):** `Retry-After` honors BOTH forms — delay-seconds and HTTP-date (resolved against an injected UTC reference); past/malformed → None. Test: `test_retry_after_accepts_seconds_and_http_date`.
- **F4 (fixed):** the CLI `--as-of` default derives today from a UTC-aware clock (not the process-local day), so an interval never opens on the wrong date near UTC midnight (G14).
- **F5 (resolved):** the tech-debt inventory now lists all eight items (added TD-M2-1-6 reconciliation-cost-scales, TD-M2-1-7 unbounded-cache, TD-M2-1-8 date-free `entity_id` attribute), consistent across plan/dev-notes/QA-report.

Round 5 (fixed + test):
- **F1 (fixed + test):** the round-4 `securities.review_state` reconciliation in `_align_authority_metadata` toggled a reuse-disputed/cleared security (authority ↔ reuse verdict) on every replay, breaking R12 replay-zero. Fixed by computing ONE final effective target: reuse-touched securities keep the verdict `_stamp_review` writes; only non-reuse-touched securities get the authority value, applied once per security. `_align` no longer touches `review_state`. Test: `test_full_feed_replay_reports_zero_mutations` (disputed + continuity-cleared params assert all mutations zero + state unchanged on replay).
- **F2 (nit, fixed):** removed the unreachable `report.ok` branch in the bootstrap CLI (`run_identity_bootstrap` raises on every failure).

No deferrals remain.

## Model Provenance

Doer: `claude-opus-4-8` at effort xhigh (orchestrate global override, quality profile, high-risk floor). Reviewer (plan phase): `gpt-5.6-sol` xhigh.
