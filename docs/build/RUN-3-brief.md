# RUN 3 — senate-pipeline

**Source of truth:** `ARCHITECTURE.md` §9.1–§9.4 (Senate), §9.2 politeness contract (hard floors), G6. Builds on RUN 1+2 (schema/canonical/load/normalize exist — reuse `normalize.py`; extend maps only if Senate variants require, e.g. `Sale (Full)`/`Sale (Partial)`/`Exchange`).

## Scope (owns)

`src/populus/ingest/senate.py`, `src/populus/parse/senate_ptr.py`, `tests/test_senate_parse.py`, expected JSON beside `tests/fixtures/senate/`. Wire `populus ingest congress-senate`.

## Requirements

1. **Session handshake** (§9.1, verified protocol): GET `/search/home/` → `csrfmiddlewaretoken` → POST `prohibition_agreement=1` → session; POST `/search/report/data/` (`report_types=[11]`, `submitted_start_date = watermark − 90 days` §9.2 re-scan, paginate `start/length`); detail pages `/search/view/ptr/<uuid>/` vs `/search/view/paper/<uuid>/`.
2. **Politeness floors in code, not config** (G6): ≥2.0 s + jitter between requests, strictly sequential, identifying UA (same as RUN 2), exponential backoff on 429/5xx, **circuit breaker**: on persistent 403 (≥3 consecutive) stop the job, mark run failed with a `circuit_open` status in `ingest_runs`, never retry harder. Injectable transport; `--from-cache data-cache/senate` mode reads `ptr-index.json` + `pages/`.
3. **Parser** (`senate_ptr.py`): the 9-column e-file table (`#, Transaction Date, Owner, Ticker, Asset Name, Asset Type, Type, Amount, Comment`) via lxml; `source_row_no` from the `#` column (§9.4 dup_seq coordinates); asset-name whitespace normalized to single spaces *inside raw extraction is NOT allowed* — `raw_row` keeps printed text NFC-only (normalization happens downstream); ticker `--` → NULL + flag; `filer_name_raw` + filed_date from the index row (the detail page lacks filed date). Paper pages ⇒ `parse_status='needs_ocr'`, zero rows, retained (G3).
4. **Filing identity**: `filing_id = f"senate:{uuid}"`; amendments: if the index title marks an amendment, link per §9.5 conservative default (pair + `amendment_unresolved` flag; **no supersede automation** — OQ-13 still open; leave a documented seam).
5. **Golden corpus**: expected JSON for every e-file fixture (incl. the 851 KB multi-row filing — assert exact row count and spot-verify first/last rows in the test); paper fixtures assert `needs_ocr`. Hand-verify the `ptr_a5fdbba4…` bond filing (child-owned corporate bonds, ticker `--`) — its expected values are already documented in `docs/REVIEW-RESPONSE… `— derive from the HTML itself.
6. **Reconciliation** (G3): every index row lands in exactly one status; counts reconcile on cache ingest.

## Acceptance

`uv run pytest -q` green; `uv run populus ingest congress-senate --from-cache data-cache/senate --db /tmp/s.db` ingests all 53 cached filings (49 e-file parsed / 4 needs_ocr expected — assert actual split from the data, don't hardcode blindly) with reconciliation summary. No live network in tests or acceptance.
