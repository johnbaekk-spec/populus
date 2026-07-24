# RUN M2-1 — identity registries + SEC federated client + conditions register

**Source of truth:** `ARCHITECTURE.md` §5.4 (temporal identity registries), §11.4
(federated Pattern-F client), §11.5 (key policy), §15 (conditions register), §2.2
(admission test), guardrails G6/G11/G14. Phase-entry contract: `docs/build/M2-CONTRACT.md`
(§1 verified sources incl. the **UA correction**, §2 register, §4 registry schema).
Builds on M1 substrate (schema.sql, db.py, canonical.py, licenses.py, cli.py) — **import,
don't reimplement**. **No 13F data in this run** — this is shared substrate M3 also reuses.

## Scope (owns)

`src/populus/identity/__init__.py`, `identity/registry.py` (DDL loader + as-of resolution),
`identity/bootstrap.py` (company_tickers + FTD seeding); `src/populus/net/__init__.py`,
`net/sec_client.py` (conservative federated client); registry DDL appended to
`src/populus/schema.sql`; new conditions-register entries in `src/populus/licenses.py`
(+ any `licenses.json`); `tests/test_identity.py`, `tests/test_identity_bootstrap.py`,
`tests/test_sec_client.py`. Wire `populus identity bootstrap` in `cli.py`.

## Requirements

1. **Registry schema** (§5.4, contract §4): `entities(entity_id PK, cik UNIQUE NOT NULL)`,
   `entity_names(entity_id, name, valid_from, valid_to, source)`, `securities(security_id PK, class)`,
   `security_identifiers(security_id, id_type CHECK IN ('cusip'), value, valid_from, valid_to,
   provenance, confidence, review_state)`, `entity_tickers(entity_id, ticker, valid_from,
   valid_to, provenance, confidence, review_state)`. Dated-validity, no-overlap unique indexes
   analogous to `member_aliases.alias_no_overlap`. `raw` JSON where a source row is stored.
   Loaded by `populus db init` (append to schema.sql; all M1 tables unchanged).
2. **As-of resolution** (`registry.py`, G14): `resolve_cusip(conn, cusip, as_of_date) -> security_id|None`,
   `resolve_entity_by_cik`, `resolve_ticker_as_of` — every historical lookup **requires an
   as-of date**; a mapping row applies only if the date is within `[valid_from, valid_to)`.
   **Prohibited (defect): chaining CUSIP→current-ticker→CIK, or using a mapping outside its
   interval.** Unresolved ⇒ return None (caller surfaces name-only + flag); never guess.
3. **Bootstrap: tickers** (`bootstrap.py`): ingest `company_tickers.json` (cached at
   `data-cache/inst/registry/company_tickers.json`) → upsert `entities` by CIK + `entity_tickers`
   current-interval rows (`valid_from`=injected date, `valid_to`=NULL open, provenance
   `company_tickers`, confidence high, review_state `auto`). Injectable source path; **no network**.
4. **Bootstrap: CUSIPs** (`bootstrap.py`, OQ-8): parse SEC fails-to-deliver rows (CUSIP, symbol,
   issuer name) → seed `security_identifiers` (+ `securities`, + link to `entities` via symbol→ticker
   where resolvable), provenance `sec-ftd`, review_state recorded. Injectable file input; partial
   coverage is acceptable (unmapped CUSIPs surface by name downstream — G3). Deterministic.
5. **Federated SEC client** (`net/sec_client.py`, §11.4 + contract §1 correction): a `SecClient`
   with an **injectable transport + clock** (hermetic tests). Enforced **in code, not config** (G6):
   **≤2 req/s** floor (min-interval sleep via injected clock), single-flight request coalescing,
   ETag-aware response cache with per-endpoint-class TTL, exponential backoff on 429/5xx, **circuit
   breaker** that stops + raises on sustained 403 (no retry storm, no IP/UA rotation). **UA policy:**
   send SEC-accepted `"<app> <contact>"` (app+version+`$POPULUS_CONTACT`), warn at startup when
   `POPULUS_CONTACT` unset (explain why per §11.4); send `Accept-Encoding: gzip, deflate`; **never**
   send the parenthesized `PopulusBot/x (+url; …)` form to `*.sec.gov` (it 403s — contract §1).
6. **Conditions register** (§15, G11): add `sec-edgar` and `sec-ftd` entries (legal instrument =
   US-government work/public domain; permitted uses; required notices; determination basis + date +
   review-by) **before** any ingest. A test asserts both entries exist, are well-formed, and that
   `scripts/dep_guard.py` stays clean (G1). CLI `populus identity bootstrap --from-cache DIR
   [--ftd PATH] --db PATH` seeds both registries with a printed reconciliation summary.

## Acceptance

`uv run pytest -q` green (whole repo — all 936 M1 tests unchanged). `populus db init` creates the
registry tables; `populus identity bootstrap --from-cache data-cache/inst/registry --db /tmp/i.db`
seeds `entities`/`entity_tickers` from the real cached `company_tickers.json` with a printed count.
As-of resolution unit-tested including the **G14 refusal** (out-of-interval lookup, no chaining).
`SecClient` unit-tested for rate floor, coalescing, cache hit/revalidate, backoff, circuit-breaker,
and **UA correctness** — all via injected transport/clock, **no live network anywhere in tests**.
