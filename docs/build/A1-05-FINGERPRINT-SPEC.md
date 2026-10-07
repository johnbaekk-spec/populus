# A1-05 — scrubbed rows must not publish a fingerprint of their original text

Status: SPECIFICATION (owner decision 2026-10-06: "fix it, spec first"). Not implemented.
Source finding: audit 2026-10-02, A1-05. Related: `WITHHOLDING-SURFACES-SPEC.md` (W1–W4, merged).

## Problem

`scrub_disclosure_text` (src/populus/inst_redaction.py) replaces a withheld CUSIP that a member
typed into `transactions.comment` / `transactions.raw_row` with `[CUSIP withheld]`. The row's
identity is left untouched, by design (see that function's docstring):

- `row_fingerprint = sha256(JCS(raw_row))` over the ORIGINAL `raw_row` (src/populus/canonical.py:48)
- `txn_id = <filing_id>:<fingerprint[:32]>[#<dup_seq>]` (canonical.py:53)

Every other byte of the original `raw_row` is still published. Substituting each candidate CUSIP
(the public SEC 13(f) list) for the marker and hashing reproduces the published fingerprint, and the
32-hex prefix inside `txn_id` alone is enough to recover the value, so the "withheld" CUSIP is
recoverable from published bytes. Audit repro: `/private/tmp/populus-audit-area1/repro_hash.py`
recovered `88579Y101` uniquely from both the full fingerprint and the `txn_id`. `txn_id` travels
further than the database: feed JSON, member/ticker slices, the dashboard's columnar feed,
note ids, signal lifecycle records and MCP responses.

The owner's standing rule ([[security-ids-are-reversible-cusip-hashes]]) is that a hash of an
identifier IS the identifier. Scope today: about 5 rows (the rows the C1 probe found when the
disclosure scrub shipped). Measure exactly before implementing (§ Prevalence).

## Property

For every published row whose source text was altered by withholding, no published identifier
(`row_fingerprint`, `txn_id`, any id derived from them) is a function of the removed text.
Equivalently: each published identity is computable from published bytes alone.

## Options

| | Mechanism | Verdict |
|---|---|---|
| **A** | **At publish, on the staged copy only, recompute identity from the PUBLISHED (scrubbed) `raw_row`**: `row_fingerprint' = sha256(JCS(scrubbed raw_row))`, `dup_seq'` re-derived per filing over the new fingerprints with `assign_identity`'s existing ordering, `txn_id' = txn_id(filing_id, fingerprint', dup_seq')`. | **Recommended.** Deterministic, no secret, reproducible by any reader, stable across publishes while the withheld set is stable. It also restores the integrity property the scrub gave up: published `raw_row` recomputes to its published fingerprint again. |
| B | Keyed HMAC of the original text with a publisher secret | Rejected: introduces secret management into an open, reproducible pipeline; readers can no longer recompute any identity. |
| C | NULL or drop the fingerprint for scrubbed rows | Rejected: `txn_id` is the PRIMARY KEY and `row_fingerprint` is NOT NULL (schema.sql:51,57); consumers key on `txn_id`. |
| D | Keep and document (the receipt link shows the original filing anyway) | Rejected by the owner decision; it contradicts the standing rule above. |

## Mechanism (option A) — constraints the implementation must meet

1. **Where:** inside the publish-time withholding pass, after `scrub_disclosure_text` and before
   slices, stats, digests and the journal (the W1 order). It applies to the staged copy only; the
   build's own store keeps original text and ids, exactly as the scrub does today.
2. **Which rows:** exactly the rows whose `raw_row` the scrub changed. Their count must equal the
   scrub's reported `transactions.raw_row` count, and an unchanged row's identity must be byte-identical.
3. **Uniqueness:** two rows of one filing that differed ONLY in the withheld text can collide after
   scrubbing. Re-derive `dup_seq` per filing over the new fingerprints, using `assign_identity`'s
   ordering (`source_row_no`, then `row_ordinal`, then position), so
   `UNIQUE (filing_id, row_fingerprint, dup_seq)` and the `txn_id` PRIMARY KEY hold. Refuse the
   build rather than overwrite on any residual collision.
4. **References:** every table and column in the published `congress.db` that stores a `txn_id`
   (or a fingerprint) of an affected row must be rewritten through ONE old→new map in the same
   transaction. `foreign_key_check` must be empty and `integrity_check` ok, using the W2 preflight
   pattern: apply on a scratch copy first, then for real.
5. **Determinism:** the same inputs give the same new ids on every publish, with no clock and no
   randomness.

## Nightly seed round trip (must be tested, not argued)

The published `congress.db` seeds the next build (`populus seed-corpus`). Affected rows therefore
arrive in the next working store already scrubbed, with their NEW ids.

- **Settled filings are not re-ingested**, so the rows persist with the new ids. The next publish's
  scrub finds no CUSIP to remove, so identity is untouched and the ids are stable.
- **Re-ingested filing** (reparse, amendment): `load.py` replaces the filing's rows with original
  text and ORIGINAL ids. The next publish scrubs again and recomputes the SAME new ids (step 5). The
  published ids are stable even though the working store briefly holds the originals.
- **The withheld set grows:** a newly withheld CUSIP changes its rows' ids once. That is the same
  one-time change as any newly scrubbed text.
- **The withheld set shrinks:** rows already seeded scrubbed cannot be restored without re-ingest.
  This is a pre-existing property of the scrub; record it, don't fix it here.

Acceptance test: build A → publish → seed → build B, with an affected row, a settled row, and a
re-ingested filing. The published `txn_id`s for affected rows must be equal in A and B, and every
reference must resolve.

## Consumers to verify (each gets a line in the implementation report)

| Consumer | Expected effect |
|---|---|
| `dashboard/src/lib/signals.ts`, `signal-thresholds.ts` (lifecycle replays prior `signals.v1.json` keyed by txn id) | Affected rows read as one lifecycle end plus one start, once. Confirm the replay validator accepts that, rather than refusing the build. |
| `dashboard/src/lib/format.ts`, `data.ts`, `feed-parts.ts`, `derive.ts`, `scripts/feed-client.ts` | Note ids and row keys are page-local or derived per build: no persistence. Verify. |
| `src/populus/backfill.py` (kadoa crosswalk, `ids_digest` over sorted txn_ids) | **Highest risk.** Determine whether the backfill matches seeded rows to kadoa rows by `txn_id`/fingerprint. If it does, the crosswalk must use the store's original identity, or the digest's population changes. Measure it on the real seed; do not assume. |
| `src/populus/mcp_server/queries.py`, `envelope.py` | They return `txn_id` from the installed DB, so they inherit the new ids automatically. |
| Watchlists (client localStorage) | Confirm they key on ticker or member, not `txn_id`. |
| `src/populus/inst.sql` `holding_id` / `row_fingerprint` (institutional) | **Same oracle class.** If any published institutional table carries `holding_id` or `row_fingerprint` for a row whose source text held a withheld CUSIP, apply the same rule there. Check `inst_agg.db` and `inst_serving.db` schemas first; in scope only if published. |

## Prevalence (measure first)

On the latest release seed (`populus seed-corpus`, read-only), count:

- `transactions` rows whose `raw_row` contains `[CUSIP withheld]`;
- for each, whether its published fingerprint is recoverable: run the audit repro over every withheld CUSIP;
- the same for institutional ids, if published.

Report the counts before implementing. If both counts are 0 and the scrub cannot currently change a
row, the implementation still ships, since the guard holds for future filings, but its urgency drops.

## Tests (red without the fix)

1. **Oracle test:** for each scrubbed row in a fixture, `published row_fingerprint ==
   sha256(JCS(published raw_row))`, and no withheld CUSIP substituted for the marker reproduces the
   published fingerprint or `txn_id` prefix. Pin the audit repro as a test.
2. **Collision:** two rows in one filing differing only by the withheld CUSIP publish distinct
   `txn_id`s with consistent `dup_seq`.
3. **References:** every stored `txn_id` reference resolves after the rewrite; integrity and FK checks are clean.
4. **Unaffected rows:** byte-identical identity (no collateral renumbering).
5. **Round trip** as above.
6. **W4 integration:** extend the existing publication-bytes property to assert the oracle test
   over the staged artifacts and the decoded journal.

## Out of scope

A1-07 (SEC-list row ordinals) stays rejected. Restoring text for a shrinking withheld set is a
pre-existing scrub property. The federated live MCP plane (A1-04) is not covered.
