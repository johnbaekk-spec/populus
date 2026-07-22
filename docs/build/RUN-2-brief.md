# RUN 2 — house-pipeline

**Source of truth:** `ARCHITECTURE.md` §9.1–§9.4, §7.4-adjacent normalization rules in §9, Appendix C. Builds on RUN 1 (schema/canonical/load are done — import, don't reimplement).

## Scope (owns)

`src/populus/ingest/__init__.py`, `src/populus/ingest/house.py`, `src/populus/parse/__init__.py`, `src/populus/parse/house_ptr.py`, `src/populus/normalize.py`, `tests/test_house_parse.py`, `tests/test_normalize.py`, expected-output JSON beside fixtures in `tests/fixtures/house/`. Wire `populus ingest congress-house` in `cli.py`.

## Requirements

1. **Discover/fetch** (§9.2): conditional-GET `<YEAR>FD.zip` (ETag/Last-Modified cache file), parse index XML (`FilingType=P`), diff DocIDs vs `filings`, fetch new PDFs with identifying UA `PopulusBot/<ver> (+https://github.com/johnbaekk-spec/populus; contact: johnbaekk@gmail.com)`, sequential with ≥0.25 s spacing, retry w/ backoff, archive raw to a `raw_root` dir (path recorded in `filings.raw_path`, `response_hash` = sha256 of bytes). **Offline-friendly:** the fetch layer takes an injectable transport so tests never hit the network; a `--from-cache DIR` mode ingests from `data-cache/house/` (the real 312-file 2026 corpus already on disk).
2. **Classifier** (OQ-3, empirically confirmed in this repo's corpus): primary = extraction yield (< 200 chars of text across first 3 pages ⇒ paper), cross-checked against DocID shape (7-digit 8/9-prefix = paper, 2003xxxx = e-file); disagreement ⇒ flag `classifier_conflict`, treat as paper (conservative). Paper ⇒ `parse_status='needs_ocr'`, filing retained with metadata + doc_url (§9.3, G3).
3. **Parser** (`house_ptr.py`): pdfplumber layout extraction with pypdf text fallback; produce per-row `raw_row` objects `{owner, asset_name, ticker, side, transaction_date, amount_label, comment}` **exactly as printed** (NFC only); multi-page tables; the filing header fields (name, state/district, filed date via index). Parse-or-flag: partial rows ⇒ `parse_status='partial'` + row flags; never silently drop (G3).
4. **Normalize** (`normalize.py`, §9 + App. C): side map (P/S/S(partial)/E → purchase/sale/sale_partial/exchange/other), owner map (SP/DC/JT/self → spouse/child/joint/self), ticker (uppercase, `--`/blank→NULL+`missing_ticker`), statutory amount buckets (App. C incl. the >$1M spouse cap form and `amount_unparsed` fallback preserving the raw label), dates (`days_to_file`, `is_late` = >45, `date_anomaly` when filed<transacted — keep + flag). Raw always preserved in `raw_row`.
5. **Golden corpus**: for **every e-file fixture PDF** in `tests/fixtures/house/` produce `<name>.expected.json` (filing meta + full normalized rows + flags) — hand-verify at least 3 against the PDFs visually (note which in the test docstring); paper fixtures assert `needs_ocr` + zero rows. The 2015 fixtures prove older-layout tolerance (OQ-6): if a 2015 layout genuinely differs, the parser must still produce correct rows or flag `partial` — never wrong values silently.
6. **Completeness reconciliation** (G3): after ingest, every index PTR DocID accounted for in exactly one `parse_status`; test asserts counts reconcile on a synthetic index + on the cached 2026 corpus.

## Acceptance

`uv run pytest -q` green including all fixture round-trips; `uv run populus ingest congress-house --from-cache data-cache/house --db /tmp/h.db` ingests the full cached 2026 corpus with a printed reconciliation summary (parsed/partial/needs_ocr counts summing to the index PTR count) and **≥97% of e-filed rows parsed clean** (P1 gate §17). No live network in tests.
