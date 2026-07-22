# RUN 4 — members, backfill, amendments, stats

**Source of truth:** `ARCHITECTURE.md` §5.2, §5.4 (members slice), §9.5–§9.8, §15 (license ids). Builds on RUNs 1–3.

## Scope (owns)

`src/populus/members.py`, `src/populus/backfill.py`, `src/populus/amendments.py`, `src/populus/stats.py`, `src/populus/licenses.py` (+ `licenses.json` seed per §15.2 register entries), `tests/test_members.py`, `tests/test_backfill.py`, `tests/test_amendments.py`, `tests/test_stats.py`. Wire `populus ingest congress-backfill`, `populus stats`.

## Requirements

1. **Members** (§9.7): ingest `data-cache/legislators/legislators-current.yaml` + `-historical.yaml` → `members` (bioguide PK, dated `terms` JSON, party/state/district from the latest term). Join: normalized filer name (case, punctuation, suffixes, nicknames from the source's alternate names) constrained by chamber + state (+district House) + **term overlap with filed_date**; exactly-one ⇒ join; else `bioguide_id=NULL`, counted. `member_aliases` resolution honors validity windows + disambiguators (§9.4 DDL exists); alias edits are file-based (`aliases.yaml` → table) so they're version-controlled. Overlapping alias candidates for one (alias, date) ⇒ CI-tested defect.
2. **Backfill** (§9.6): import `data-cache/kadoa/trades.json` — **congressional rows only, OGE excluded** (branch/chamber fields), `filing_id='kadoa:<id>'`, `source='kadoa'`, `license_id='mit-kadoa-seed'`, `kadoa_id` per row; `raw_row` = the kadoa record's raw fields mapped into our shape (documented mapping). Crosswalk: when a primary filing exists for the same doc (match `doc_url`/DocID), kadoa filing → `lifecycle='retired'` + `primary_filing_id` (tombstone, never delete). **Audit sampler** (`populus backfill-audit`): SRS n=150 uniform + per-stratum ≥5 quotas (chamber × year-band × equity/non-equity), emits a reviewable worksheet (JSON+MD) with doc_urls — the human gate artifact, not auto-passed.
3. **Amendments** (§9.5 conservative default ONLY — OQ-13 open): detect pair candidates (same filer + explicit reference/lineage), set `supersedes` on the later, both flagged `amendment_unresolved`; **default views** (a SQL view `v_default_transactions`) = `lifecycle='active'` AND pair rule: only the later filing of an unresolved pair; uncertainty view `v_amendment_pairs` exposes both. No supersede automation.
4. **Stats** (§5.2): `populus stats` emits `stats.json`: freshness (house index last-modified vs DB watermark, senate max filed_date), parse coverage by chamber×year, join coverage %, needs_ocr count, source mix (% primary vs kadoa), late-filing stats, file counts. Deterministic ordering (stable JSON for diffing).
5. **License register** (§15.2): `licenses.json` with the table's entries (us-congress-disclosures incl. §13107 notice text, us-govworks-*, bls-tos placeholder, cc0-legislators, mit-kadoa-seed, capitol-api reference-only marker) + `DATA-LICENSE.md` + `NOTICE` generated from it.

## Acceptance

`uv run pytest -q` green. End-to-end on cache: house+senate+backfill ingest into one DB → **join coverage ≥98%** on primary-source transactions (P1 gate; unresolved names listed in stats, alias file may be extended with justified entries — document each) → `populus stats` output validates against a JSON schema in tests. OGE exclusion proven by test (a synthetic OGE row is not imported).
