# House archive durability: the provenance boundary — specification

**Status:** normative for `_ingest_year`'s settled pre-pass, `_obtain_document`,
and every future caller that asks "may this archived document be reused without
transport?" (`src/populus/ingest/house.py`), and for the checkpoint primitives
they read through (`src/populus/ingest/checkpoint.py`).
**Owner decision (2026-07-31):** spec-first, after a third consecutive residual
finding in this one boundary. This document states the rule precisely; the code
implements this document.

**Why this exists.** Three external review rounds each found a *different*
boundary enforcing a *weaker* version of the same rule. No round found a new
requirement — R2 and LD3 have said the same thing since the plan was approved.
What each round found was another place that had hand-rolled its own answer to
"is this document durable?":

| Round | Boundary | The weaker rule it enforced | What that permitted |
|---|---|---|---|
| 1 | `_obtain_document` | *bytes present* ⇒ durable (self-heal a sidecar from them) | Legacy/partial/corrupt bytes promoted to durable provenance with a null `retrieved_at`, zero transport, never checked against the source |
| 2 | `_ingest_year` settled pre-pass | *bytes re-hash to the DB's `response_hash`* ⇒ durable | Deleting a sidecar while leaving matching bytes destroyed `source_url` + `retrieved_at` permanently; no later run would ever fetch |
| 3 | `_obtain_document` | *a checkpoint exists whose hash matches the bytes* ⇒ durable | A hash-only checkpoint — no `retrieved_at`, no/wrong `source_url` — reads as durable forever; a fresh-DB resume never fetches, so provenance is never restored |

**The diagnostic is not "three bugs". It is one rule, multiple boundaries, each
hand-rolled.** Every fix so far repaired the boundary the reviewer happened to
stand on, which is why each round produced a residual: the rule lived in nobody's
custody, so hardening one call site said nothing about the others. Round 2's own
resolution notes named the shape ("two competing resume boundaries") and still
fixed only one of them.

This document exists so the rule has one statement and one implementation, and
so a fourth boundary — a future reparse path, a verifier, a repair tool — is
written against the rule instead of re-deriving it.

## Domain

For one House PTR document identified by a validated `DocID` and a `year`:

- **archive** — `<raw_root>/pdfs/<year>/<DocID>.pdf`, the bytes on disk. May be
  absent, stale, truncated, or same-length corrupt.
- **checkpoint** — the §5.1 provenance sidecar beside it,
  `<archive>.fetch-meta.json`, written by `commit_checkpoint` **before** the
  bytes. Its complete payload is exactly three fields:
  `{source_url, response_hash, retrieved_at}`. May be absent, unparseable, or
  present-but-incomplete.
- **canonical URL** — `DOC_URL_TEMPLATE.format(year=year, doc_id=doc_id)`. The
  one URL these bytes may have come from; derived, never read from the sidecar.
- **DB row** — `filings.raw_path` and `filings.response_hash`. A *second,
  independent* record of the same fact. Its agreement is a consistency check,
  **not** the durability rule (round 2 mistook it for the rule).

Cache mode (`--from-cache`) is **out of scope**: it reads committed bytes,
writes no sidecar by contract, and has no transport with which to make one.
Requiring provenance there would make every cached corpus permanently
unsettleable. This exemption is deliberate and is pinned by its own test.

## The rule

> **A document is durable if and only if its checkpoint carries the complete
> §5.1 provenance set — `response_hash`, `retrieved_at`, `source_url` — with
> `source_url` equal to the canonical URL, AND its archived bytes re-hash to
> that `response_hash`. Anything less is fetch-required.**

Stated once, here. Every boundary below evaluates *this* sentence, through one
function, and adds nothing of its own.

"Anything less" is exhaustive and each case is fetch-required, not an error:
archive absent; checkpoint absent; checkpoint unparseable; `response_hash`
absent; `retrieved_at` absent, null, or empty; `source_url` absent, null, or
disagreeing with the canonical URL; bytes present but re-hashing to something
else.

**Fetch-required is a repair, not a failure.** The document is fetched exactly
once and the checkpoint is rewritten complete, so a corpus with damaged
provenance converges to a correct one after a single pass — and then costs zero
transport forever after. A rule that instead *raised* on incomplete provenance
would strand the operator with no path forward; a rule that *tolerated* it
(every round before this one) would strand the corpus with provenance that can
never be restored, because nothing would ever fetch again.

## Boundaries

Three call sites answer the durability question. All three must reach the same
verdict on the same inputs, because they run over the same archive in the same
run — the pre-pass decides whether to skip, `_obtain_document` decides whether to
transport, and a fresh-DB resume exercises the second without the first.

| # | Boundary | When it runs | How it evaluates the rule | Guarding test |
|---|---|---|---|---|
| 1 | `_ingest_year` settled pre-pass | Once per discovered DocID, before any obtain, live mode only | `archive_verified(archive, db_hash)` **and** `_checkpoint_is_complete(...)`. The DB-hash agreement is the extra consistency check; the shared predicate is the rule | `test_settled_skip_on_the_same_db_requires_the_sidecar_too` (absent/unreadable), `test_a_sidecar_disagreeing_with_the_stored_hash_is_not_settled`, `test_settled_skip_requires_complete_provenance_not_just_a_hash` |
| 2 | `_obtain_document` | Per document not skipped by (1) — and for **every** document on a fresh DB, where (1) has no rows and cannot fire | `_checkpoint_is_complete(...)` **and** bytes re-hash to the checkpoint's `response_hash` | `test_archived_bytes_without_a_checkpoint_are_refetched_never_self_healed`, `test_an_unreadable_checkpoint_is_fetch_required_not_trusted`, `test_a_hash_only_checkpoint_is_not_durable` |
| 3 | Fresh-DB resume | A brand-new database over an existing archive | Not a separate boundary — it is (2) with (1) structurally inert. Called out because it is the only path that proves (2) alone is correct: with no rows to skip, every document must be decided by the checkpoint | `test_fresh_database_over_a_verified_archive_makes_zero_ptr_transport` (positive), `test_a_fresh_database_refetches_an_incomplete_checkpoint` (negative) |

Boundary 3 is why "fix the pre-pass" was never sufficient: on a fresh database
the pre-pass sees no rows at all, so `_obtain_document` is the *only* thing
standing between an incomplete sidecar and a zero-transport reuse. Round 2
hardened boundary 1 and left boundary 2 accepting a hash-only checkpoint —
which is precisely round 3's finding.

## Invariants

Each holds for every archive and every run. The guarding test is named.

**I1 — One predicate, no second opinion.**
`_checkpoint_is_complete` is the only place the rule is evaluated. Boundaries 1
and 2 call it; neither re-derives "complete" from field reads of its own. A
boundary that needs the rule imports it — the failure mode this whole document
exists to end is a call site quietly answering the question itself.
*Test: `test_both_resume_boundaries_share_one_completeness_predicate`*

**I2 — Every field of the §5.1 set is load-bearing.**
Dropping any one of `response_hash`, `retrieved_at`, `source_url` from an
otherwise valid checkpoint makes the document fetch-required, at both
boundaries. None is decorative, and none may be inferred from the others: a
hash proves the bytes, a timestamp proves *when* the source said so, and a URL
proves *which* source. Provenance missing any one of the three is not
provenance.
*Tests: `test_a_hash_only_checkpoint_is_not_durable`,
`test_a_checkpoint_missing_any_provenance_field_is_fetch_required`
(parametrized over all three fields, both boundaries)*

**I3 — `source_url` is verified against the canonical URL, never merely
present.**
A sidecar naming a *different* document's URL is worse than one naming none: it
is confident and wrong, and it would survive any presence-only check. The
expected URL is threaded into the predicate from the caller, which derives it
from the same `DocID`/`year` that built the archive path — so the sidecar can
never be the authority on its own provenance.
*Test: `test_a_checkpoint_naming_a_different_source_url_is_fetch_required`*

**I4 — `retrieved_at` must be non-empty, not merely present.**
`null`, `""`, and whitespace are absence wearing a key. This is the exact
residue round 1 created and round 3 caught: the removed self-heal branch wrote
`retrieved_at=None` into otherwise well-formed sidecars, so real archives may
carry hash-only checkpoints that a presence check would wave through.
*Test: `test_a_checkpoint_missing_any_provenance_field_is_fetch_required[retrieved_at]`*

**I5 — Repair is exactly one fetch, and it converges.**
A document failing the rule is fetched once, its checkpoint rewritten complete
(checkpoint before bytes, unchanged), and it is durable from the next run
onward at zero transport. No path retries in a loop, and no path leaves the
archive in a state that fails the rule again.
*Tests: `test_settled_skip_on_the_same_db_requires_the_sidecar_too` (asserts the
follow-up run is settled at zero transport),
`test_a_fresh_database_refetches_an_incomplete_checkpoint`*

**I6 — Cache mode is exempt, deliberately and visibly.**
Boundary 1 applies the rule only when `cache_dir is None`; boundary 2 returns
cached bytes before reaching it. Cache mode writes no sidecar by contract, so
applying the rule there would make every cached corpus permanently
unsettleable — an exemption, not an oversight, and therefore tested rather than
implied.
*Tests: `test_cache_mode_writes_no_sidecar`,
`test_cache_mode_settles_without_a_sidecar`*

**I7 — A non-200 is never checkpointed and never archived.**
Unchanged from R2, restated because it is the other half of "fetch-required":
repair must not be able to manufacture a durable empty file. `raw_path` stays
NULL and the filing stays re-fetch-eligible.
*Test: `test_a_non_200_ptr_is_never_checkpointed_or_archived`*

## What this specification does not change

- The checkpoint-**before**-bytes ordering, and the crash-resume behaviour that
  follows from it (R2/LD3). Untouched.
- `filings.response_hash` as an independent second record, and the settled
  counters `settled_verified` / `settled_reobtained`. Untouched.
- Cache mode, in any respect.
- The politeness floors, retry policy, and transport instrumentation (R20).

## Consequences accepted

- **A one-time refetch cost on archives with incomplete provenance.** The live
  `ops/m1-b/raw/house/` archive was written by the current code and carries
  complete sidecars, so the measured cost there is zero. An archive predating
  R2, or one damaged by hand, pays one fetch per affected document — once.
- **A sidecar read and parse per settled candidate**, alongside the rehash that
  boundary 1 already performs. Negligible beside the rehash; it is what makes a
  settled skip mean "provenance intact" rather than "bytes intact".
