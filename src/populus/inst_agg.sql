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
-- Schema 1.1 keeps the public relation byte-for-byte readable while storing its
-- high-cardinality repeated strings once.  The private dictionaries/backing
-- table are not projected.  The view is deliberately read-only: aggregate
-- artifacts are produced from scratch, and no consumer is allowed to mutate a
-- published derived relation.
CREATE TABLE IF NOT EXISTS _agg_qoq_filers (
  filer_id INTEGER PRIMARY KEY,
  cik      TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS _agg_qoq_periods (
  period_id INTEGER PRIMARY KEY,
  period    TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS _agg_qoq_deltas (
  filer_id          INTEGER NOT NULL,
  position_key      TEXT NOT NULL,                -- 'sid:<security_id>' or 'cusip:<cusip>'
  put_call_code     INTEGER NOT NULL CHECK (put_call_code BETWEEN 0 AND 2),
  curr_period_id    INTEGER NOT NULL,
  prev_period_id    INTEGER NOT NULL,
  change_kind_code  INTEGER NOT NULL CHECK (change_kind_code BETWEEN 0 AND 4),
  prev_value_usd    INTEGER,
  curr_value_usd    INTEGER,
  delta_value_usd   INTEGER,
  prev_shares       INTEGER,
  curr_shares       INTEGER,
  delta_shares      INTEGER,
  unit_code         INTEGER NOT NULL CHECK (unit_code BETWEEN 0 AND 2),
  flags_mask        INTEGER NOT NULL CHECK (flags_mask BETWEEN 0 AND 31),
  PRIMARY KEY (
    filer_id, position_key, put_call_code, unit_code, curr_period_id
  )
) WITHOUT ROWID;

CREATE VIEW IF NOT EXISTS agg_qoq_deltas AS
SELECT
  f.cik,
  q.position_key,
  CASE q.put_call_code
    WHEN 0 THEN 'LONG' WHEN 1 THEN 'PUT' ELSE 'CALL'
  END AS put_call,
  cp.period AS curr_period,
  pp.period AS prev_period,
  CASE q.change_kind_code
    WHEN 0 THEN 'new'
    WHEN 1 THEN 'add'
    WHEN 2 THEN 'trim'
    WHEN 3 THEN 'exit'
    ELSE 'unclassified'
  END AS change_kind,
  q.prev_value_usd,
  q.curr_value_usd,
  q.delta_value_usd,
  q.prev_shares,
  q.curr_shares,
  q.delta_shares,
  CASE q.unit_code
    WHEN 0 THEN 'SH' WHEN 1 THEN 'PRN' ELSE 'UNKNOWN'
  END AS ssh_prnamt_type,
  '[' || rtrim(
    CASE WHEN q.flags_mask & 1
      THEN '"change_kind_undeterminable",' ELSE '' END ||
    CASE WHEN q.flags_mask & 2
      THEN '"classified_by_value",' ELSE '' END ||
    CASE WHEN q.flags_mask & 4
      THEN '"identity_reconciled_by_cusip",' ELSE '' END ||
    CASE WHEN q.flags_mask & 8
      THEN '"shares_unit_mismatch",' ELSE '' END ||
    CASE WHEN q.flags_mask & 16
      THEN '"value_undisclosed_one_side",' ELSE '' END,
    ','
  ) || ']' AS flags,
  (SELECT value FROM agg_build_meta WHERE key = 'ingested_at') AS ingested_at
FROM _agg_qoq_deltas q
JOIN _agg_qoq_filers f ON f.filer_id = q.filer_id
JOIN _agg_qoq_periods cp ON cp.period_id = q.curr_period_id
JOIN _agg_qoq_periods pp ON pp.period_id = q.prev_period_id;

-- R8 — the security directory. One row per (period, position_key): the name a
-- reader sees where the raw key would otherwise be printed.
--
-- PERIOD-KEYED, and that is the whole point. A single row per position_key
-- would stamp one present-day identity onto every historical row — a G14
-- identity time-travel violation — because an issuer's reported name and class
-- can differ between quarters. Deltas join on their reporting period; EXIT rows
-- have no current-period holding and join on the PRIOR period instead.
--
-- Not a new resolution path: issuer_name is already denormalized onto the rows
-- this is grouped from, so the directory is a projection over landed data, and
-- `resolution_source` carries how the issuer was keyed rather than implying a
-- lookup that did not happen.
--
-- Representative choice where one key has several name or class variants in one
-- period: highest reported value, then lexicographic identity as the tiebreak,
-- so the result is deterministic across rebuilds rather than
-- insertion-ordered. `ticker` is non-null only for entity-keyed identities;
-- everything weaker leaves it NULL rather than guessing.
CREATE TABLE IF NOT EXISTS agg_security_directory (
  period_of_report  TEXT NOT NULL,
  position_key      TEXT NOT NULL,              -- 'sid:<security_id>' | 'cusip:<cusip>'
  issuer_key        TEXT NOT NULL,              -- 'entity:<id>' | 'cusip6:<6>' | 'name:<norm>'
  issuer_name       TEXT NOT NULL,              -- representative reported name; NEVER empty
  class_title       TEXT,                       -- NULL = every report was silent
  ticker            TEXT,                       -- non-null ONLY for entity-keyed identities
  cusip             TEXT,                       -- NULL when the key is security-id-only
  resolution_source TEXT NOT NULL
      CHECK (resolution_source IN ('entity','cusip6','name')),
  ingested_at       TEXT NOT NULL,              -- volatile; excluded from the projection
  PRIMARY KEY (period_of_report, position_key)
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

-- Per-filer portfolio concentration.
--
-- GRAIN NOTE (RUN M2-8 T6, QA-2/QA-3): these rows are computed from
-- v_filer_reported_holdings, NOT v_default_holdings. Two consequences that are
-- intended but must not be discovered later:
--   1. The row population WIDENS — every filer-period in the filer-reported set
--      gets a row, including affiliation-suppressed filers that previously had
--      none (filer-reported is a superset of default). Published row counts and
--      the inst logical digest change accordingly.
--   2. topn_value_usd / topn_share_bps / hhi now describe the filer's OWN
--      reported book, so their VALUES change for any affiliated filer. That is
--      the point (review F5: the flag baseline must not inherit a truncated
--      book), but it is a change to an already-published number.
-- Cross-entity issuer totals keep reading v_default_holdings so an affiliate
-- relationship is still counted exactly once.
--
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
  -- RUN M2-8 (T6, plan R14): the LARGEST SINGLE position's share, which is what
  -- the outsized-position flag compares against. topn_share_bps is a COMBINED
  -- top-N share and is a different statistic entirely — a book of five 10%
  -- positions has topn_share_bps 5000 and max_position_share_bps 1000 (external
  -- review round 2, F11). NULL on the same condition as the other two.
  max_position_share_bps INTEGER,
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
