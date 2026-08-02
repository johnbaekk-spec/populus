CREATE TABLE members (
  bioguide_id   TEXT PRIMARY KEY,
  full_name     TEXT NOT NULL,
  chamber       TEXT NOT NULL CHECK (chamber IN ('house','senate')),
  party TEXT, state TEXT, district TEXT,
  terms         JSON NOT NULL,              -- dated; joins are as-of
  raw           JSON NOT NULL
);

CREATE TABLE member_aliases (               -- every fuzzy-match decision is a reviewed commit
  alias_id    INTEGER PRIMARY KEY,
  alias       TEXT NOT NULL,                -- normalized filer-name string
  chamber     TEXT NOT NULL,
  state       TEXT,                         -- disambiguators; NULL = matches any
  district    TEXT,
  valid_from  DATE NOT NULL,                -- temporal: the same alias may map to
  valid_to    DATE,                         -- different members across eras
  bioguide_id TEXT NOT NULL REFERENCES members(bioguide_id),
  note        TEXT NOT NULL                 -- why this mapping exists
);
CREATE UNIQUE INDEX alias_no_overlap
  ON member_aliases (alias, chamber, state, district, valid_from);
-- resolution (§9.7): an alias row applies only if the filing's filed_date falls in
-- [valid_from, valid_to) AND the member has a term overlapping that date; overlapping
-- candidate rows for one (alias, date) are a defect caught by a CI invariant test.

CREATE TABLE filings (
  filing_id     TEXT PRIMARY KEY,           -- 'house:<DocID>' | 'senate:<uuid>' | 'kadoa:<id>'
  chamber       TEXT NOT NULL CHECK (chamber IN ('house','senate')),
  bioguide_id   TEXT REFERENCES members(bioguide_id),      -- NULL = unresolved (visible, flagged)
  filer_name_raw TEXT NOT NULL,
  filing_kind   TEXT NOT NULL,              -- 'ptr' | 'ptr_amendment' | … (map: OQ-2)
  filed_date    DATE NOT NULL,
  doc_url       TEXT NOT NULL,
  raw_path      TEXT,
  response_hash TEXT,                       -- sha256 of archived document
  parse_status  TEXT NOT NULL CHECK (parse_status IN
                  ('parsed','partial','needs_ocr','failed')),   -- OUTCOME only
  lifecycle     TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN
                  ('active','superseded','retired','withdrawn')), -- LIFECYCLE, separate
  supersedes    TEXT REFERENCES filings(filing_id),  -- amendment lineage
  primary_filing_id TEXT REFERENCES filings(filing_id), -- kadoa→primary crosswalk (§9.6)
  parser_version TEXT, normalization_version TEXT,
  row_count     INTEGER,
  source        TEXT NOT NULL CHECK (source IN ('house-clerk','senate-efd','kadoa')),
  license_id    TEXT NOT NULL DEFAULT 'us-congress-disclosures',
  ingested_at   TEXT NOT NULL
);

CREATE TABLE transactions (
  txn_id        TEXT PRIMARY KEY,           -- '<filing_id>:<fingerprint32>[#<dup_seq>]' (§ below)
  filing_id     TEXT NOT NULL REFERENCES filings(filing_id),
  raw_row       TEXT NOT NULL               -- JSON: the exact extracted raw field object —
                                            -- the fingerprint's input, stored so identity is
                                            -- reproducible and auditable from the row itself
                CHECK (json_valid(raw_row) AND json_type(raw_row) = 'object'),
  row_fingerprint TEXT NOT NULL,            -- full sha256 hex of canonical raw_row (§ below)
  dup_seq       INTEGER NOT NULL DEFAULT 1, -- 1..n among identical raw_rows in one filing
  row_ordinal   INTEGER NOT NULL,           -- display order as printed (presentation only)
  source_row_no INTEGER,                    -- the source's own row number where printed
                                            -- (Senate '#' column; House table position)
  bioguide_id   TEXT REFERENCES members(bioguide_id),  -- denormalized from filing; CI
                                            -- invariant: equals its filing's bioguide_id
  chamber       TEXT NOT NULL,
  owner         TEXT,                       -- canonical: self|spouse|child|joint|NULL
  ticker        TEXT,                       -- normalized; NULL for bonds/funds/'--'
  asset_name    TEXT NOT NULL,              -- normalized (raw lives in raw_row)
  asset_type    TEXT,
  side          TEXT NOT NULL CHECK (side IN
                  ('purchase','sale','sale_partial','exchange','other')),
  transaction_date DATE,                    -- NULL only with flag date_missing
  filed_date    DATE NOT NULL,
  days_to_file  INTEGER,
  is_late       INTEGER CHECK (is_late IN (0,1)),
  amount_low INTEGER, amount_high INTEGER,  -- statutory buckets, Appendix C
  amount_label  TEXT,                       -- as printed
  cap_gains_over_200 INTEGER CHECK (cap_gains_over_200 IN (0,1)),
  comment       TEXT,
  -- M1-E per-row sub-lines printed beneath a House transaction row. Captured
  -- as their own columns and DELIBERATELY NOT in raw_row: raw_row is the
  -- identity fingerprint's input, so adding fields there would change every
  -- existing txn_id. Before these existed the parser had nowhere to put a
  -- wrapped sub-line tail, so the tail became a flagged orphan "transaction".
  filing_status TEXT,                       -- "FILING STATUS:" as printed
  subholding_of TEXT,                       -- "SUBHOLDING OF:" as printed
  location      TEXT,                       -- "LOCATION:" as printed
  flags         TEXT NOT NULL DEFAULT '[]'  -- JSON array: ["missing_ticker","date_anomaly",…]
                CHECK (json_valid(flags) AND json_type(flags) = 'array'),
  source        TEXT NOT NULL,
  license_id    TEXT NOT NULL,              -- record-level (sources mix in this table, §5.1)
  kadoa_id      TEXT,                       -- original seed id where source='kadoa'
  UNIQUE (filing_id, row_fingerprint, dup_seq)   -- matches the identity, exactly
);

CREATE TABLE ingest_runs (
  run_id TEXT PRIMARY KEY, job TEXT, started_at TEXT, finished_at TEXT,
  new_filings INTEGER, rows_loaded INTEGER, parse_failures INTEGER,
  status TEXT, host TEXT, log_ref TEXT
);
