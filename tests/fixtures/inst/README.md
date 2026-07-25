# Institutional 13F fixtures (RUN M2-2)

Two corpora feed `tests/test_inst_parse.py`, `tests/test_inst_normalize.py`, and
`tests/test_inst_ingest.py`. Regenerate the golden `<key>.expected.json` files
with `UPDATE_GOLDENS=1 uv run pytest tests/test_inst_ingest.py`.

Both sidecar kinds are committed so provenance is deterministic and offline
(R10/R15/R19): a per-CIK `submissions-meta.json` (`retrieved_at` / `source_url`
/ `response_hash` for `submissions.json`) and a per-accession `fetch-meta.json`
(`retrieved_at` + per-document `response_hash`). `retrieved_at` is a fixed date,
never the wall clock; hashes are computed from the committed bytes.

## `real/CIK0001067983/` — Berkshire Hathaway (public record; SEC EDGAR)

Real filings fetched **2026-07-24** through the RUN-M2-1 `SecClient` (the
`retrieved_at` the sidecars record; license `sec-edgar`, §15). The
information-table filename varies per accession and is **discovered from
`index.json`, never hardcoded** — note `form13fInfoTable.xml` (named) vs the
numeric `53405.xml` / `50240.xml` / `43981.xml`.

| Accession | Form | Period | Filed | Info table | Rows | tableValueTotal |
|---|---|---|---|---|---|---|
| `0001193125-26-226661` | 13F-HR | 2026-03-31 | 2026-05-15 | `53405.xml` | 90 | 263,095,703,570 |
| `0001193125-26-054580` | 13F-HR | 2025-12-31 | 2026-02-17 | `50240.xml` | 110 | 274,160,086,701 |
| `0000950123-25-005701` | 13F-HR (base) | 2025-03-31 | 2025-05-15 | `form13fInfoTable.xml` | 110 | 258,701,144,516 |
| `0000950123-25-008361` | 13F-HR/A NEW HOLDINGS, `confDeniedExpired` | 2025-03-31 | 2025-08-14 | `43981.xml` | 4 | 1,106,550,356 |

The 2025-Q1 base `…005701` and its amendment `…008361` are a **real
NEW-HOLDINGS merge** (F8): the amendment `amends` the base and both jointly
populate `v_default_holdings` for 2025-03-31. Hand-verified goldens (R11):
(a) the 2026-Q1 ALLY row — value 498,992,850 / 12,719,675 sh = **$39.23/share**;
(b) the 2025-Q1 merge pair (amendment: 4 entries, tableValueTotal 1,106,550,356).

## `crafted/` — small deterministic trees (behaviors the real corpus can't show)

| CIK | Behavior it proves |
|---|---|
| `0009000001` | Q4-2022 report **filed 2023-02-14 → whole dollars** (the discriminator is the filed date, not the period; F7) |
| `0009000009` | pre-cutover filing (filed 2020-02-14) → **thousands ×1000** (R4) |
| `0009000002` | options — `putCall` Put/Call + a `PRN` share/principal type (G5) |
| `0009000003` | multi-restatement lineage: base + RESTATEMENT×2 + NEW HOLDINGS, all linking to the base; survivors = latest restatement ∪ new-holdings (V5). Its base lists other-manager `28-6001`, which the restatement **drops** → the affiliate `0009000006` is not suppressed for 2024-06-30 (F6) |
| `0009000004` | confidential pair — `isConfidentialOmitted` base + `confDeniedExpired` NEW-HOLDINGS amendment (crafted counterpart to Berkshire; R6) |
| `0009000005` | covering filer; the coverage of `0009000006` **lives in the surviving restatement** (2024-03-31), and a mutual pair with it (2024-09-30) |
| `0009000006` | covered filer — file number `028-06001` ≡ canonical `028-6001`; covered in 2024-03-31, **not** suppressed in 2024-06-30 (F6), mutually covered in 2024-09-30 (F12) |
| `0009000007` | a `13F-NT` notice (no info table) + a `13F-HR` with a malformed row retained under `partial` (never-drop, G3) |
| `0009000008` | failed zero-row `13F-HR` — cover total 5,000,000,000 known, index names no info table → `infotable_missing`; drags coverage **down** (F3) |
| `0009000010` | cover-failed — a malformed `primary_doc.xml` (`cover_malformed`) and a missing-required-field cover (`cover_missing_field`); each persisted `failed`/`cover_failed` from the submissions-index metadata, run continues, coverage non-certifiable (R18/F7) |
