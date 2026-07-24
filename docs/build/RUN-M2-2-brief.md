# RUN M2-2 — 13F ingest, parse, normalize (with golden fixtures)

**Source of truth:** `ARCHITECTURE.md` §10.2 (M2 outline — units, amendments, confidential
treatment, identity), §9.2–§9.4 (ingest/parse/load idioms to mirror), §5.1 (provenance),
guardrails G3/G4/G5/G10/G14. Contract: `docs/build/M2-CONTRACT.md` (§1 verified fields + real
fixtures, §4 schema, §5 caveat, §8 gates). Builds on **RUN M2-1** (identity registries + `SecClient`
+ register — import them) and M1 substrate (load.py atomic-load, canonical.py, normalize idioms).

## Scope (owns)

`inst_filers`/`inst_filings`/`inst_holdings` DDL appended to `src/populus/schema.sql` +
`v_default_holdings` in `src/populus/views.sql`; `src/populus/ingest/inst13f.py`,
`src/populus/parse/inst13f.py`, `src/populus/normalize_inst.py`; inst load path (extend
`load.py` or `ingest/inst13f.py` — atomic per-filing, reuse `canonical.py`); `tests/test_inst_parse.py`,
`test_inst_normalize.py`, `test_inst_ingest.py`; fixtures + expected JSON under `tests/fixtures/inst/`.
Wire `populus ingest inst-13f` in `cli.py`.

## Requirements

1. **Discover/fetch** (§9.2 idiom): for a CIK (or list), `submissions/CIK<n>.json` → `13F-HR`/`13F-HR/A`
   accessions → `Archives/.../index.json` → **discover the info-table XML filename from the index**
   (variable/numeric, e.g. `53405.xml`; never hardcode) → fetch `primary_doc.xml` + info-table via
   the RUN-M2-1 `SecClient`. `--from-cache data-cache/inst`. Archive raw + `response_hash` (sha256).
   Injectable transport; **no network in tests**.
2. **Parse cover** (`inst13f.py`, namespaces stripped): `submission_type, period_of_report`
   (MM-DD-YYYY → ISO), `is_amendment, amendment_type ∈ {RESTATEMENT,NEW HOLDINGS}, amendment_no,
   filing_manager name, form13f_file_number, report_type, table_entry_total, table_value_total,
   is_confidential_omitted, conf_denied_expired, otherIncludedManagersCount + otherManagers[]`.
3. **Parse info table** (`inst13f.py`): each `<infoTable>` → raw row exactly as printed (NFC only):
   `nameOfIssuer, titleOfClass, cusip, value, shrsOrPrnAmt{sshPrnamt, sshPrnamtType}, putCall?
   (absent on equities), investmentDiscretion, otherManager*, votingAuthority{Sole,Shared,None}`.
   Row count reconciles to `table_entry_total` (G3); never silently drop — partial ⇒ `parse_status`.
4. **Unit basis** (`normalize_inst.py`, §10.2): `unit_basis ∈ {thousands, whole}` keyed on **form
   version / filed date** (cutover **2023-01-03**), **not** report period. Compute `value_usd`
   (whole dollars). Cross-check: `Σ value × unit ≈ table_value_total`. The crafted pre-2023
   fixture proves the ×1000 path; mixing regimes unnormalized is a defect.
5. **Amendments + confidential treatment** (§10.2, mirror M1 supersede): `RESTATEMENT` ⇒ supersede
   the original in full; `NEW HOLDINGS` ⇒ **merge** with the original; `is_confidential_omitted` /
   `conf_denied_expired` disclosures route through the **NEW HOLDINGS merge** path. `otherManager`/
   affiliated-filer structures modeled so the **same position is not double-counted** across
   affiliated filers. `v_default_holdings` encodes supersede + merge + affiliated de-dup (analogous
   to `v_default_transactions`).
6. **Identity resolution** (RUN-M2-1, G14): `cusip` → `resolve_cusip(as_of=period_of_report)` →
   `security_id`; unmapped ⇒ keep `issuer_name_raw` + `missing_security` flag (never dropped/guessed).
   Report **value-coverage %** (share of `table_value_total` with a resolved identity).
7. **Golden fixtures** (contract §8; all four behaviors): real Berkshire 2026-Q1 `13F-HR`
   (whole-dollar primary, cached), real 2025-Q1 `13F-HR/A` `NEW HOLDINGS`/`confDeniedExpired`
   (cached, merge path), plus **crafted deterministic** fixtures for the thousands regime (pre-2023
   filed date) and an options/`putCall` row. `<name>.expected.json` per fixture (filing meta + full
   normalized rows + flags + `value_usd` + `unit_basis`); hand-verify ≥2 against source (note which
   in the test docstring).

## Acceptance

`uv run pytest -q` green including every fixture round-trip and all four behaviors (units, restatement,
new-holdings merge, affiliated de-dup). `populus ingest inst-13f --from-cache data-cache/inst --db /tmp/i.db`
(after `db init` + `identity bootstrap`) ingests the cached Berkshire filings and prints a reconciliation
summary: rows vs `table_entry_total`, `Σ value_usd` vs `table_value_total`, `unit_basis`, amendment
handling, and value-coverage %. **No live network in tests.**
