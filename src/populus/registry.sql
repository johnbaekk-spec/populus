-- Temporal identity registries (ARCHITECTURE.md §5.4; M2-CONTRACT §4).
--
-- Applied by populus.identity.registry.ensure_registry (idempotent), NOT part
-- of schema.sql, which must stay byte-identical to the §9.4 DDL block. Shared
-- substrate: M2 (13F) and M3 (company financials) both resolve through these
-- tables; no M1 read path touches them.
--
-- Temporal model, everywhere: [valid_from, valid_to) half-open, valid_to NULL
-- = open-ended, mirroring member_aliases (§9.4/§9.7). G14: a mapping applies
-- only inside its own interval — there is no "current" mapping usable at an
-- arbitrary date, and no identifier->entity path that does not take an as-of
-- date.

CREATE TABLE IF NOT EXISTS entities (
  entity_id TEXT PRIMARY KEY,               -- 'cik:0000320193' — a CIK never changes
  cik       TEXT NOT NULL UNIQUE,           -- 10-digit zero-padded
  raw       JSON CHECK (raw IS NULL OR (json_valid(raw) AND json_type(raw) = 'object'))
);

CREATE TABLE IF NOT EXISTS entity_names (
  entity_id  TEXT NOT NULL REFERENCES entities(entity_id),
  name       TEXT NOT NULL,                 -- NFC + collapsed whitespace, case preserved
  valid_from DATE NOT NULL,
  valid_to   DATE,
  source     TEXT NOT NULL,                 -- 'company_tickers'
  license_id TEXT NOT NULL,                 -- §5.1 record-level (sources mix here)
  raw        JSON CHECK (raw IS NULL OR (json_valid(raw) AND json_type(raw) = 'object')),
  PRIMARY KEY (entity_id, valid_from)       -- DC1: the no-overlap key IS the natural key
);

CREATE TABLE IF NOT EXISTS securities (
  security_id       TEXT PRIMARY KEY,       -- declared literal, or 'sec:prov:<32 hex>'
  -- Two identity tiers with explicitly different guarantees: a 'declared' id is
  -- written once in securities.yaml by reviewed commit and never changes; a
  -- 'provisional' id is derived from the identifier anchor, deterministic across
  -- clean rebuilds, and carries NO durability claim (see security_supersessions).
  id_state          TEXT NOT NULL CHECK (id_state IN ('declared','provisional')),
  class             TEXT,                   -- instrument class; NULL = source is silent
  entity_id         TEXT REFERENCES entities(entity_id),
  entity_candidates TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(entity_candidates) AND json_type(entity_candidates) = 'array'),
  entity_link_state TEXT NOT NULL DEFAULT 'unresolved'
        CHECK (entity_link_state IN ('unresolved','resolved','conflict')),
  review_state      TEXT NOT NULL DEFAULT 'auto'
        CHECK (review_state IN ('auto','reviewed','disputed')),
  -- A NULL entity_id is always paired with an EXPLICIT reason (G3): never a
  -- silent absence, and never a stamped link without the 'resolved' state.
  CHECK ((entity_id IS NULL     AND entity_link_state IN ('unresolved','conflict'))
      OR (entity_id IS NOT NULL AND entity_link_state = 'resolved'))
);

-- One-to-many and append-only: a provisional id promoted into a declared class
-- has one successor; an id fanned out by a declared split has several, and
-- resolution is then fail-closed (see registry.resolve_security_successor).
CREATE TABLE IF NOT EXISTS security_supersessions (
  old_security_id TEXT NOT NULL,
  security_id     TEXT NOT NULL REFERENCES securities(security_id),
  reason          TEXT NOT NULL CHECK (reason IN ('promotion','merge','split')),
  source          TEXT NOT NULL,            -- 'securities.yaml'
  PRIMARY KEY (old_security_id, security_id)
);

CREATE TABLE IF NOT EXISTS security_identifiers (
  security_id TEXT NOT NULL REFERENCES securities(security_id),
  id_type     TEXT NOT NULL CHECK (id_type IN ('cusip')),
  value       TEXT NOT NULL,
  valid_from  DATE NOT NULL,                -- half-open VALIDITY, built only from
  valid_to    DATE,                         -- calendar-adjacent observations (DC2/G14)
  provenance  TEXT NOT NULL,                -- 'sec-ftd'
  confidence  TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  review_state TEXT NOT NULL CHECK (review_state IN ('auto','reviewed','disputed')),
  license_id  TEXT NOT NULL,
  raw         JSON CHECK (raw IS NULL OR (json_valid(raw) AND json_type(raw) = 'object')),
  PRIMARY KEY (security_id, id_type, value, valid_from)
);
-- The alias_no_overlap role, keyed on the LOOKUP side: two securities can never
-- hold one (id_type, value) from the same day, which is what makes registry
-- merges and ownership-boundary cuts collision-free.
CREATE UNIQUE INDEX IF NOT EXISTS security_identifier_no_overlap
  ON security_identifiers (id_type, value, valid_from);

-- The DEFINITIONAL identity source: the SEC Official List of Section
-- 13(f) Securities registers each quarter's CUSIP universe with the interval
-- EXACTLY that quarter, [quarter_start, next_quarter_start) half-open (G14 — no
-- extrapolation beyond the observed list). A SEPARATE table from
-- security_identifiers on purpose: the two sources have different precedence
-- (registry.resolve_cusip decides via this table first and only consults the
-- FTD security_identifiers when NO definitional interval covers the date), and
-- keeping them apart leaves the FTD write path byte-for-byte untouched. Full
-- §5.1 provenance lives ON the fact row: every seeded identity traces to its
-- retrieval event (retrieved_at, source_url, list_sha256, raw_path), its source
-- line (row_ordinal AND the verbatim source_row), and its transformation
-- (parser/normalization versions).
CREATE TABLE IF NOT EXISTS security_list_intervals (
  security_id  TEXT NOT NULL REFERENCES securities(security_id),
  id_type      TEXT NOT NULL CHECK (id_type IN ('cusip')),
  value        TEXT NOT NULL,
  valid_from   DATE NOT NULL,                -- [quarter_start, next_quarter_start),
  valid_to     DATE,                         -- intersected with securities.yaml windows
  quarter      TEXT NOT NULL,                -- 'YYYYqN' — the replacement/superseding key
  issuer_name  TEXT,                         -- the SEC canonical name (the sole persisted name source)
  security_class TEXT,                       -- the issuer-description column as printed
  is_option    INTEGER NOT NULL CHECK (is_option IN (0, 1)),
  status_flag  TEXT NOT NULL,                -- '' (continuing) | 'ADDED' (DELETED never seeds)
  provenance   TEXT NOT NULL,                -- 'sec-13f-list'
  confidence   TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  review_state TEXT NOT NULL CHECK (review_state IN ('auto','reviewed','disputed')),
  license_id   TEXT NOT NULL,
  source_url   TEXT NOT NULL,
  list_sha256  TEXT NOT NULL,
  retrieved_at TEXT,
  raw_path     TEXT,
  row_ordinal  INTEGER,
  parser_version TEXT NOT NULL,
  normalization_version TEXT NOT NULL,
  -- The VERBATIM source row this identity was read from: the original 80-char
  -- fixed-width text line, or the reconstructed PDF data row (its positioned
  -- words re-joined in reading order). With row_ordinal and raw_path it makes a
  -- published or migrated fact auditable against its exact source line WITHOUT
  -- retaining the external gitignored cache (§5.1). Carried verbatim
  -- through an authority-revision recut, so every cut piece keeps its origin line
  -- and the recut stays byte-deterministic.
  source_row   TEXT,
  raw          JSON CHECK (raw IS NULL OR (json_valid(raw) AND json_type(raw) = 'object')),
  -- One definitional row per (value, valid_from): the replay-zero idempotency
  -- key and the ownership-boundary-cut key, mirroring security_identifiers'
  -- no-overlap discipline on the lookup side.
  PRIMARY KEY (value, valid_from)
);
CREATE INDEX IF NOT EXISTS security_list_interval_value
  ON security_list_intervals (value);
CREATE INDEX IF NOT EXISTS security_list_interval_security
  ON security_list_intervals (security_id);

-- The quarter-level SEED LEDGER: one row per
-- (quarter, provenance) recording the source hash and retrieval provenance of
-- the list that seeded it — written EVEN WHEN THE QUARTER SEEDS ZERO RECORDS
-- (a DELETED-only list). The replay/replacement decision is driven from HERE,
-- not from security_list_intervals: a valid zero-record quarter leaves no
-- interval rows, so a hash history that lived only on interval rows was blind to
-- it and a different-sha reseed slipped through without the mandated hard error.
-- A later securities.yaml revision recuts the intervals but NOT this ledger — the
-- source (quarter + sha) is unchanged by a re-owner, so a post-migration same-sha
-- reseed stays replay-zero.
CREATE TABLE IF NOT EXISTS security_list_seed_ledger (
  quarter      TEXT NOT NULL,
  provenance   TEXT NOT NULL,                -- 'sec-13f-list'
  list_sha256  TEXT NOT NULL,                -- the retrieval sha of the seeding file
  source_url   TEXT NOT NULL,
  retrieved_at TEXT,
  raw_path     TEXT,
  records_seeded INTEGER NOT NULL,           -- 0 for a DELETED-only quarter
  parser_version TEXT NOT NULL,
  normalization_version TEXT NOT NULL,
  PRIMARY KEY (quarter, provenance)          -- the replay/replacement key
);

CREATE TABLE IF NOT EXISTS entity_tickers (
  entity_id  TEXT NOT NULL REFERENCES entities(entity_id),
  ticker     TEXT NOT NULL,
  valid_from DATE NOT NULL,
  valid_to   DATE,
  provenance TEXT NOT NULL,                 -- 'company_tickers'
  confidence TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  review_state TEXT NOT NULL CHECK (review_state IN ('auto','reviewed','disputed')),
  license_id TEXT NOT NULL,
  raw        JSON CHECK (raw IS NULL OR (json_valid(raw) AND json_type(raw) = 'object')),
  PRIMARY KEY (entity_id, ticker, valid_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS entity_ticker_no_overlap
  ON entity_tickers (ticker, valid_from);
