-- Cross-filer 13F aggregates (ARCHITECTURE.md §10.2; M2-CONTRACT §5.6 — RUN M2-3).
--
-- Applied by populus.inst_agg.build_inst_agg into a FRESH inst_agg.db (all
-- IF NOT EXISTS — idempotent DDL), populated deterministically from
-- v_default_holdings / v_default_inst_filings joined to the §5.4 securities
-- registry. This schema is owned here; the aggregate DB is a derived Release
-- asset, never git-tracked.
--
-- Determinism / digest contract (§5.5 inst logical projection v1):
--   * every projected numeric column is INTEGER (dollar sums, share counts,
--     basis-point shares, integer HHI) — no floats ever enter the digest;
--   * a legitimately unavailable value is stored NULL (distinguishable from a
--     real 0 in the digest), never a fabricated zero;
--   * flags are a canonical sorted JSON-array TEXT column (opaque to the digest);
--   * the per-table `ingested_at` is volatile provenance, EXCLUDED from the
--     projection, and `agg_build_meta` is excluded entirely (the ingest_runs
--     analogue), so two independent builds of one source share one digest.

-- Filer registry: one row per default filer (a CIK with >=1 default filing),
-- including a notice-only filer (position_count 0). Counts retain every default
-- holding (G3); total_value_usd sums only the non-NULL values, with the NULL and
-- unkeyable populations surfaced beside it rather than folded away.
CREATE TABLE IF NOT EXISTS agg_filer_registry (
  cik                  TEXT PRIMARY KEY,
  filer_name           TEXT NOT NULL,
  latest_period        TEXT NOT NULL,             -- MAX(period_of_report) over default filings
  position_count       INTEGER NOT NULL,          -- ALL retained default holdings (incl. NULL-value)
  total_value_usd      INTEGER NOT NULL,          -- COALESCE(SUM(value_usd), 0) over non-NULL
  null_value_positions INTEGER NOT NULL,          -- holdings with a NULL value_usd
  unkeyed_positions    INTEGER NOT NULL,          -- holdings with neither security_id nor cusip (G3)
  ingested_at          TEXT NOT NULL              -- volatile; excluded from the projection
);

-- Quarter-over-quarter deltas per filer x position x put/call, matched on the
-- as-of security_id first (correct across a CUSIP change — the registry resolves
-- both CUSIPs to one security_id) then, for still-unmatched rows, an exact
-- reported-CUSIP reconciliation within the same filer's adjacent quarters
-- (flagged identity_reconciled_by_cusip; never a name match, never G14 chaining).
-- delta_value_usd is NULL when either side's value was undisclosed — a holding
-- whose prior filing had an unparseable <value> would otherwise difference
-- against a FABRICATED zero and surface as a multi-billion "add" that never
-- happened, ranked first by inst_biggest_moves (QA-VERIFY5-B2). delta_shares
-- only when ssh_prnamt_type is
-- equal in both quarters, else NULL + shares_unit_mismatch (never a fake 0).
CREATE TABLE IF NOT EXISTS agg_qoq_deltas (
  cik             TEXT NOT NULL,
  position_key    TEXT NOT NULL,                  -- 'sid:<security_id>' or 'cusip:<cusip>'
  put_call        TEXT NOT NULL,                  -- 'LONG' | 'PUT' | 'CALL'
  curr_period     TEXT NOT NULL,
  prev_period     TEXT NOT NULL,
  change_kind     TEXT NOT NULL                   -- new | add | trim | exit
      CHECK (change_kind IN ('new','add','trim','exit','unclassified')),
  prev_value_usd  INTEGER,                        -- NULL when that quarter's
  curr_value_usd  INTEGER,                        -- value was never disclosed
  delta_value_usd INTEGER,                        -- NULL when either side is
  prev_shares     INTEGER,                         -- NULL when the prior unit is unknown
  curr_shares     INTEGER,                         -- NULL when the current unit is unknown
  delta_shares    INTEGER,                         -- NULL when units are incompatible (F4)
  ssh_prnamt_type TEXT NOT NULL,                   -- 'SH' | 'PRN' | 'UNKNOWN' — part of the
                                                   -- GRAIN: SH and PRN subpositions are never
                                                   -- merged (QA-F2), so this is never 'mixed'
  flags           TEXT NOT NULL,                   -- canonical sorted JSON array
  ingested_at     TEXT NOT NULL,                   -- volatile; excluded from the projection
  PRIMARY KEY (cik, position_key, put_call, ssh_prnamt_type, curr_period)
);

-- Top holders per ISSUER: for each issuer x period, the top-N filers ranked by
-- the value they hold in that issuer, after summing a filer's value across ALL
-- its securities sharing the issuer_key (so share classes never split a holder).
-- issuer_key is entity_id (resolved link) first, else the CUSIP-6 issuer block,
-- else the normalized issuer name (each fallback flagged via issuer_key_source).
CREATE TABLE IF NOT EXISTS agg_issuer_top_holders (
  issuer_key        TEXT NOT NULL,                -- 'entity:<id>' | 'cusip6:<6>' | 'name:<norm>'
  period_of_report  TEXT NOT NULL,
  rank              INTEGER NOT NULL,             -- 1..N by value_usd DESC, cik ASC
  cik               TEXT NOT NULL,
  filer_name        TEXT NOT NULL,
  issuer_name       TEXT NOT NULL,                -- representative raw issuer name
  issuer_key_source TEXT NOT NULL                 -- entity | cusip6 | name
      CHECK (issuer_key_source IN ('entity','cusip6','name')),
  value_usd         INTEGER NOT NULL,             -- filer's summed value in this issuer
  security_count    INTEGER NOT NULL,             -- distinct securities the filer holds of it
  flags             TEXT NOT NULL,                -- canonical sorted JSON array
  ingested_at       TEXT NOT NULL,                -- volatile; excluded from the projection
  PRIMARY KEY (issuer_key, period_of_report, rank)
);

-- Per-filer portfolio concentration: top-N share (basis points) and an integer
-- HHI, computed ONLY when total_value_usd > 0; when the total is 0 (or every
-- value is NULL) both are stored NULL + concentration_unavailable — the digest
-- keeps that NULL distinct from a real 0, and the build never divides by zero.
CREATE TABLE IF NOT EXISTS agg_filer_concentration (
  cik                  TEXT NOT NULL,
  period_of_report     TEXT NOT NULL,
  position_count       INTEGER NOT NULL,          -- ALL default holdings for the (cik, period)
  total_value_usd      INTEGER NOT NULL,          -- COALESCE(SUM(value_usd), 0) over non-NULL
  null_value_positions INTEGER NOT NULL,
  topn_value_usd       INTEGER NOT NULL,          -- summed value of the top-N positions
  topn_share_bps       INTEGER,                   -- topn/total in bps; NULL when total <= 0 (F5)
  hhi                  INTEGER,                   -- integer HHI in bps; NULL when total <= 0 (F5)
  flags                TEXT NOT NULL,             -- canonical sorted JSON array
  ingested_at          TEXT NOT NULL,             -- volatile; excluded from the projection
  PRIMARY KEY (cik, period_of_report)
);

-- Build parameters + source versions (the ingest_runs analogue): excluded
-- ENTIRELY from the inst logical projection, so a changed topn or clock never
-- perturbs the digest while staying recorded for provenance.
CREATE TABLE IF NOT EXISTS agg_build_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
