-- Temporal identity registries (ARCHITECTURE.md §5.4; M2-CONTRACT §4 — RUN M2-1).
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
