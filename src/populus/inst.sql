-- Institutional 13F tables (ARCHITECTURE.md §10.2; M2-CONTRACT §5).
--
-- Applied by populus.load.ensure_inst_schema (all IF NOT EXISTS — idempotent),
-- NOT part of schema.sql, which must stay byte-identical to the §9.4 DDL block
-- (registry.sql / views.sql precedent). init_db composes it before the views,
-- and every M2 entrypoint applies it before ensure_views, so a pre-existing
-- M1/M2-1 database gains the inst tables (and, via ensure_views, both inst
-- views) on first M2 use with no M1 table touched.
--
-- Every fact row carries the complete applicable §5.1 provenance contract as
-- PHYSICAL columns (§5.1 field list; ARCHITECTURE.md:206). retrieved_at (the
-- SEC fetch time, from a committed sidecar) is DISTINCT from ingested_at (the
-- row write time, injected by the CLI). vintage/effective_date are omitted:
-- a 13F snapshot is a quarter-end fact that does not revise.

CREATE TABLE IF NOT EXISTS inst_filers (
  cik TEXT PRIMARY KEY,                     -- 10-digit, normalize_cik
  name_raw TEXT NOT NULL,                   -- submissions top-level filer name
  form13f_file_number TEXT,
  file_number_norm TEXT,                    -- canonical '028-4545' (normalize_file_number)
  entity_id TEXT REFERENCES entities(entity_id),   -- NULL until the CIK exists in entities
  raw JSON CHECK (raw IS NULL OR (json_valid(raw) AND json_type(raw) = 'object')),
  flags JSON NOT NULL DEFAULT '[]'          -- e.g. ['submissions_meta_missing']
      CHECK (json_valid(flags) AND json_type(flags) = 'array'),
  -- §5.1 provenance (from submissions.json + the per-CIK submissions-meta.json):
  source TEXT NOT NULL CHECK (source IN ('sec-edgar')),
  source_url TEXT NOT NULL,
  source_record_id TEXT NOT NULL,           -- CIK
  retrieved_at TEXT,                        -- submissions-meta.json fetch time; NULL + flag if absent
  response_hash TEXT,                       -- submissions.json sha256
  raw_path TEXT,                            -- archived submissions.json
  parser_version TEXT NOT NULL,
  normalization_version TEXT NOT NULL,
  license_id TEXT NOT NULL DEFAULT 'sec-edgar',
  ingested_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inst_filings (
  filing_id TEXT PRIMARY KEY,               -- 'inst:<dashed accession>'
  cik TEXT NOT NULL REFERENCES inst_filers(cik),
  accession TEXT NOT NULL UNIQUE,           -- source_record_id (dashed)
  submission_type TEXT NOT NULL
      CHECK (submission_type IN ('13F-HR','13F-HR/A','13F-NT','13F-NT/A')),
  period_of_report DATE NOT NULL,           -- G4; from cover, or index reportDate on cover failure
  filed_date       DATE NOT NULL,           -- G4; from index filingDate; drives unit_basis
  form_version TEXT,                         -- schemaVersion; audit-only (LD-5)
  unit_basis TEXT NOT NULL CHECK (unit_basis IN ('thousands','whole')),
  is_amendment INTEGER NOT NULL CHECK (is_amendment IN (0,1)),
  amendment_type TEXT CHECK (amendment_type IN ('RESTATEMENT','NEW_HOLDINGS')),
  amendment_no INTEGER,
  amends TEXT REFERENCES inst_filings(filing_id),   -- lineage only; LD-4 (no lifecycle mutation)
  is_confidential_omitted INTEGER CHECK (is_confidential_omitted IN (0,1)),
  conf_denied_expired     INTEGER CHECK (conf_denied_expired IN (0,1)),
  filing_manager_raw TEXT NOT NULL,         -- cover name, or submissions name on cover failure
  form13f_file_number TEXT,
  file_number_norm TEXT,                    -- canonical form (normalize_file_number)
  report_type TEXT,
  other_managers JSON NOT NULL DEFAULT '[]'
      CHECK (json_valid(other_managers) AND json_type(other_managers) = 'array'),
  table_entry_total INTEGER,
  table_value_total INTEGER,                -- as printed on the cover (era units)
  table_value_total_usd INTEGER,            -- x multiplier; NULL only on cover failure (value unknown)
  row_count INTEGER,
  sum_value_usd INTEGER,
  value_total_delta INTEGER,                -- sum_value_usd - table_value_total_usd (LD-7; reported, not fatal)
  resolved_rows INTEGER,
  resolved_value_usd INTEGER,
  parse_status TEXT NOT NULL CHECK (parse_status IN ('parsed','partial','failed')),
  failure_kind TEXT,                        -- infotable_missing|infotable_ambiguous|cover_malformed|cover_missing_field|...
  lifecycle TEXT NOT NULL DEFAULT 'active'
      CHECK (lifecycle IN ('active','superseded','retired','withdrawn')),
  flags JSON NOT NULL DEFAULT '[]'
      CHECK (json_valid(flags) AND json_type(flags) = 'array'),
  doc_url TEXT NOT NULL,                     -- primary_doc.xml URL
  table_url TEXT,
  table_filename TEXT,                       -- discovered from index.json, never hardcoded
  -- §5.1 provenance (filing level, from the per-accession fetch-meta.json):
  source TEXT NOT NULL CHECK (source IN ('sec-edgar')),
  source_url TEXT NOT NULL,
  source_record_id TEXT NOT NULL,           -- accession
  retrieved_at TEXT,                        -- max(index,cover,table) fetch time
  raw_path TEXT,                            -- archived accession dir
  index_response_hash TEXT,
  response_hash TEXT,                       -- cover sha256
  table_response_hash TEXT,
  parser_version TEXT NOT NULL,
  normalization_version TEXT NOT NULL,
  license_id TEXT NOT NULL DEFAULT 'sec-edgar',
  ingested_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inst_holdings (
  holding_id TEXT PRIMARY KEY,              -- '<filing_id>:<fp32>[#<dup_seq>]' (assign_identity)
  filing_id TEXT NOT NULL REFERENCES inst_filings(filing_id),
  raw_row TEXT NOT NULL                     -- the exact extracted raw field object; identity input
      CHECK (json_valid(raw_row) AND json_type(raw_row) = 'object'),
  row_fingerprint TEXT NOT NULL,
  dup_seq INTEGER NOT NULL DEFAULT 1,
  row_ordinal INTEGER NOT NULL,             -- source order (presentation)
  cik TEXT NOT NULL,                        -- denormalized from the filing
  accession TEXT NOT NULL,
  period_of_report DATE NOT NULL,           -- G4 / G14 as-of key
  filed_date DATE NOT NULL,                 -- G4
  security_id TEXT REFERENCES securities(security_id),   -- NULL = unmapped + flag (LD-3)
  cusip_raw TEXT,
  cusip TEXT,
  issuer_name_raw TEXT NOT NULL,
  title_of_class TEXT,
  value_raw INTEGER,                        -- nullable on purpose: retained row + flag, never a drop
  unit_basis TEXT NOT NULL,
  value_usd INTEGER,
  ssh_prnamt INTEGER,
  ssh_prnamt_type TEXT,
  put_call TEXT CHECK (put_call IS NULL OR put_call IN ('PUT','CALL')),
  investment_discretion TEXT,
  other_manager TEXT,                       -- raw 'otherManager' cell, e.g. '2,4,11'
  other_manager_seqs JSON NOT NULL DEFAULT '[]'
      CHECK (json_valid(other_manager_seqs) AND json_type(other_manager_seqs) = 'array'),
  voting_sole INTEGER,
  voting_shared INTEGER,
  voting_none INTEGER,
  flags JSON NOT NULL DEFAULT '[]'
      CHECK (json_valid(flags) AND json_type(flags) = 'array'),
  -- §5.1 provenance (holding level, from the info-table fetch):
  source TEXT NOT NULL CHECK (source IN ('sec-edgar')),
  source_url TEXT NOT NULL,
  source_record_id TEXT NOT NULL,           -- '<accession>:<row_ordinal>'
  retrieved_at TEXT,
  response_hash TEXT,                       -- info-table sha256
  raw_path TEXT,                            -- archived info-table path
  parser_version TEXT NOT NULL,
  normalization_version TEXT NOT NULL,
  license_id TEXT NOT NULL DEFAULT 'sec-edgar',
  ingested_at TEXT NOT NULL,
  UNIQUE (filing_id, row_fingerprint, dup_seq)   -- matches the identity, exactly
);
CREATE INDEX IF NOT EXISTS inst_holdings_by_filing ON inst_holdings (filing_id);
CREATE INDEX IF NOT EXISTS inst_holdings_by_security ON inst_holdings (security_id, period_of_report);
CREATE INDEX IF NOT EXISTS inst_filings_by_period ON inst_filings (period_of_report, cik);
